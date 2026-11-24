/* Canonical network state is never interpolated or stepped by the browser. */
(function(){'use strict';
const $=id=>document.getElementById(id),url='wss://dust-turbo.anton-samsonovs.workers.dev/ws';
const fields=['x','lane','targetLane','speed','z','vz','angle','angular','heat','crash','crashes','finishTime','bump'],flags=['airborne','boosting','finished','overheat'];
const snapshot=p=>Object.fromEntries([...fields.map(k=>[k,Number(p[k])||0]),...flags.map(k=>[k,!!p[k]])]);
const M=window.DustMultiplayer={active:false,host:false,connected:false,running:false,remote:null,remotes:[],players:[],results:null,round:0,slot:0,snapshot,validState:s=>s&&fields.every(k=>Number.isFinite(s[k]))};
const histories=new Map(),renderedX=new Map(),colors=['#83ecdf','#ffa6dd','#f7cf68','#a7b9ff'];
let ws,api,id='',timer,retryTimer,attempt=0,seq=0,offset=0,best=Infinity,startAt=0,generation=0,phase='waiting',countdownAt=0,lastMessage=0;
const now=()=>performance.timeOrigin+performance.now(),status=s=>{if($('mp-status'))$('mp-status').textContent=s;};
function send(d){if(ws?.readyState===1)ws.send(JSON.stringify({v:2,...d}));}
function controls(){const me=M.players.find(p=>p.id===id);$('mp-start').disabled=!me||!M.connected||phase==='racing';$('mp-start').textContent=me?.ready?'НЕ ГОТОВ':'ГОТОВ';$('mp-start').setAttribute('aria-pressed',String(!!me?.ready));}
function statusLine(){if(!M.connected)return;const me=M.players.some(p=>p.id===id);status(phase==='racing'?(me?'Заезд идёт':'Заезд идёт. Вы ждёте следующий старт.'):!me?'Лобби заполнено. Вы в очереди на следующий заезд.':phase==='countdown'?'Все готовы! Старт через '+Math.max(0,Math.ceil((countdownAt-offset-now())/1000))+' с.':M.players.length<2?'Ждём игроков. Для старта нужно хотя бы двое.':'Нажмите «Готов». Когда готовы все — старт через 3 секунды.');}
const arrivals=new Map();let peakGap=0;M.takeGap=()=>{const gap=peakGap;peakGap=0;return Math.round(gap);};
function clearStates(){arrivals.clear();peakGap=0;histories.clear();renderedX.clear();M.remotes=[];M.remote=null;}
function clean(){generation++;clearInterval(timer);clearTimeout(retryTimer);if(ws){ws.onclose=null;ws.close();ws=null;}M.connected=false;M.running=false;clearStates();M.players=[];M.results=null;best=Infinity;phase='waiting';}
function disconnected(g){if(g!==generation||!M.active)return;clean();api.interrupt();$('mp-panel').classList.remove('hidden');status('Связь потеряна. Переподключаемся автоматически…');controls();const delay=Math.min(10000,600*2**Math.min(attempt++,5));retryTimer=setTimeout(()=>{if(M.active)connect(true);},delay);}
function receive(d){
 const person=d.bot?{name:'БОТ',slot:d.slot}:M.players.find(p=>p.id===d.id);if(!person)return;
 const p={...d.p,id:d.id,name:person.name,color:colors[person.slot]||colors[0],ai:false,remote:true,bot:!!d.bot};
 let h=histories.get(d.id);if(!h){h=[];histories.set(d.id,h);}if(h.length&&d.seq<=h[h.length-1].seq)return;
 // Server receive time, never the sender's wall clock. Old servers use local receive time.
 if(!d.bot){const time=performance.now(),last=arrivals.get(d.id);if(last!==undefined)peakGap=Math.max(peakGap,time-last);arrivals.set(d.id,time);}
 const arrived=now()+offset,stamp=Number.isFinite(d.at)?d.at:arrived;
 const prev=h[h.length-1];if(prev&&stamp<prev.stamp)return;
 let at=stamp;
 if(prev&&!d.bot){
  // Humans are stamped on receipt by the relay. Reconstruct short moving
  // intervals from integrated distance so bunched uploads do not create sprints.
  const speed=(p.speed+prev.p.speed)/2;
  const motionMs=speed>1?(p.x-prev.p.x)*1000/speed:0;
  if(motionMs>0&&motionMs<=350&&stamp-prev.stamp<=500){
   at=Math.max(stamp-250,Math.min(stamp+250,prev.at+motionMs));
  }
  at=Math.max(prev.at,at);
 }
 // Budget for the age of the previous sample at the moment its successor
 // arrives. Grow promptly under jitter; relax only gradually on a clean link.
 const required=prev?arrived-prev.at+17:125;
 h.delay=Math.max(125,Math.min(450,required),(h.delay||125)-1);
 h.push({at,stamp,seq:d.seq,p});while(h.length>40)h.shift();
 const i=M.remotes.findIndex(r=>r.id===d.id);if(i<0)M.remotes.push(p);else M.remotes[i]=p;
 M.remote=M.remotes[0]||null;api.remote?.(p);
}
M.renderRemotes=()=>{
 const clock=now(),serverNow=clock+offset;
 return M.remotes.map(p=>{const h=histories.get(p.id);if(!h?.length)return {...p};let target=serverNow-h.delay;
 // Slew the playback clock rather than jumping when network delay changes.
 const elapsed=clock-h.lastFrame;
 if(elapsed>=0&&elapsed<250)target=Math.max(h.cursor+elapsed*.93,Math.min(h.cursor+elapsed*1.07,target));
 h.cursor=target;h.lastFrame=clock;
 let a=h[0],b;
 for(let i=1;i<h.length;i++){if(h[i].at>target){b=h[i];break;}a=h[i];}
 const out={...a.p};if(target<a.at)return out;
 if(b){const t=Math.max(0,Math.min(1,(target-a.at)/Math.max(1,b.at-a.at)));
 // State flags belong to the left endpoint: never announce a future crash or landing.
 for(const k of ['x','lane','z','angle','speed','heat','vz'])out[k]=a.p[k]+(b.p[k]-a.p[k])*t;
 }else{
 const dt=Math.min(.08,Math.max(0,(target-a.at)/1000));
 // Speed already uses world units/sec (core's x5 scale). Freeze vertical/contact states.
 if(!out.finished&&out.crash<=0&&!out.airborne)out.x+=out.speed*dt;
 }
 // A delayed packet after a gap must not pull the rider backwards from extrapolation.
 // All authoritative race motion is forward; new rounds clear this render-only floor.
 const length=window.DustCore?.COURSES?.[0]?.length||1000000;
 out.x=Math.min(length,Math.max(renderedX.get(p.id)||0,out.x));renderedX.set(p.id,out.x);
 return out;});
};
function connect(retry=false){clean();M.active=true;M.round=0;if(!retry)attempt=0;api.interrupt();$('mp-panel').classList.remove('hidden');$('mp-roster').replaceChildren();status('Подключаемся к общему лобби…');controls();const g=generation;lastMessage=now();
 try{ws=new WebSocket(url);}catch{disconnected(g);return;}
 timer=setInterval(()=>{if(g!==generation)return;if(now()-lastMessage>12000){disconnected(g);return;}statusLine();send({t:'ping',at:now()});},2000);
 ws.onopen=()=>{if(g!==generation)return;send({t:'ping',at:now()});send({t:'join',name:$('mp-name').value});};
 ws.onclose=()=>disconnected(g);ws.onerror=()=>{if(g===generation)ws?.close();};
 ws.onmessage=e=>{if(g!==generation)return;let d;try{d=JSON.parse(e.data);}catch{return;}if(d.v!==2)return;lastMessage=now();
 if(d.t==='chat' && typeof d.name==='string' && typeof d.text==='string') {const log=$('chat-log');if(log){const stick=log.scrollHeight-log.scrollTop-log.clientHeight<28;const line=document.createElement('p'),nick=document.createElement('b');nick.textContent=d.name+': ';line.append(nick,document.createTextNode(d.text));log.append(line);while(log.children.length>64)log.firstElementChild.remove();if(stick)log.scrollTop=log.scrollHeight;}}
 if(d.t==='chatError'&&typeof d.message==='string')$('chat-note').textContent=d.message;
 if(d.t==='welcome'){id=d.id;if(Number.isFinite(d.now))offset=d.now-now();}
 if(d.t==='pong'){const rtt=now()-d.at;if(rtt>=0&&rtt<best){best=rtt;offset=d.now-(d.at+now())/2;}}
 if(d.t==='error'){status(d.message);controls();}
 if(d.t==='room'){M.connected=true;attempt=0;M.players=d.players;M.slot=d.players.find(p=>p.id===id)?.slot||0;phase=d.phase;countdownAt=d.at;M.remotes=M.remotes.filter(p=>p.bot||d.players.some(q=>q.id===p.id));M.remote=M.remotes[0]||null;
 $('mp-presence').textContent='Онлайн: '+d.online+' · игроков: '+d.players.length+'/4';
 $('mp-roster').replaceChildren(...[...d.players,...(d.waiting||[]).map(p=>({...p,queued:true}))].map(p=>{const li=document.createElement('li'),name=document.createElement('span'),ready=document.createElement('strong');name.textContent=p.name+(p.id===id?' (вы)':'');ready.textContent=p.queued?'Ожидает':phase==='racing'?'Играет':p.ready?'Готов':'Не готов';li.append(name,ready);return li;}));statusLine();controls();}
 if(d.t==='start'&&d.ids.includes(id)){M.running=true;M.round=d.round;M.results=null;clearStates();seq=0;startAt=d.at-offset;api.start(d.course);$('mp-panel').classList.add('hidden');}
 if(d.t==='state'&&M.running&&d.id!==id&&d.round===M.round&&M.validState(d.p))receive(d);
 if(d.t==='results'&&d.round===M.round){M.results=d.results;M.running=false;api.results?.();}
 if(d.t==='interrupted'){M.running=false;clearStates();api.interrupt();$('mp-panel').classList.remove('hidden');status(d.message);}
 };
}
M.tick=()=>{const p=api.player();if(M.running&&M.connected&&p)send({t:'state',round:M.round,seq:++seq,p:snapshot(p)});};
M.remaining=()=>Math.max(0,(startAt-now())/1000);M.elapsed=()=>Math.max(0,(now()-startAt)/1000);
M.leave=()=>{send({t:'leave'});M.active=false;clean();$('mp-panel').classList.add('hidden');};M.hidden=()=>{if(M.running)send({t:'hidden'});};
M.init=bridge=>{api=bridge;try{$('mp-name').value=localStorage.getItem('dust-turbo-nickname')||'Гонщик';}catch{}let renameTimer;
$('mp-name').addEventListener('input',()=>{try{localStorage.setItem('dust-turbo-nickname',$('mp-name').value);}catch{}clearTimeout(renameTimer);renameTimer=setTimeout(()=>send({t:'rename',name:$('mp-name').value}),250);});
const form=$('chat-form');if(form)form.onsubmit=e=>{e.preventDefault();const box=$('chat-input'),text=box.value.trim();if(!text)return;if(!M.connected||ws?.readyState!==1){$('chat-note').textContent='Нет связи. Дождись подключения.';return;}send({t:'chat',text});box.value='';$('chat-note').textContent='Сообщения видны всем в лобби.';};
$('friend').onclick=()=>{if(form){$('chat-log').replaceChildren();$('chat-input').value='';$('chat-note').textContent='Сообщения видны всем в лобби.';}api.wake();connect();};$('mp-start').onclick=()=>{api.wake();send({t:'ready',ready:!M.players.find(p=>p.id===id)?.ready});};$('mp-exit').onclick=()=>{M.leave();api.home();};};
})();

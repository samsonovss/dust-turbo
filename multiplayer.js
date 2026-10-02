/* PeerJS 1.5.5: public signaling, real WebRTC data channel; no simulated peers. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const validRoom = s => typeof s === 'string' && /^[a-f0-9]{24}$/.test(s);
  const fields = ['x','lane','targetLane','speed','z','vz','angle','angular','heat','crash','crashes','finishTime','bump'];
  function snapshot(p) { const s = {}; fields.forEach(k => s[k] = Number(p[k]) || 0); ['airborne','boosting','finished','overheat'].forEach(k => s[k] = !!p[k]); return s; }
  function validState(s) { return s && fields.every(k => Number.isFinite(s[k])) && s.x >= 0 && s.x <= 1000000 && s.lane >= 0 && s.lane <= 3 && Math.abs(s.z) < 10000 && s.finishTime >= 0; }
  const M = window.DustMultiplayer = { active:false, host:false, connected:false, running:false, remote:null, startAt:0, offset:0, round:0, validRoom, snapshot, validState };
  let peer, conn, timer, timeout, api, room, course = 0, lastSeen = 0, sequence = 0, received = -1, bestRTT = Infinity, generation = 0, peerReady = false, startAck = null;
  const now = () => performance.timeOrigin + performance.now();
  function status(s) { $('mp-status').textContent = s; }
  function send(data) { if(conn && conn.open) { try { conn.send({v:1,...data}); } catch (_) { fail('Соединение потеряно. Подключитесь заново.'); } } }
  function controls() { $('mp-start').disabled = !M.host || !M.connected || bestRTT === Infinity || !peerReady; $('mp-start').textContent = M.running ? 'НОВЫЙ ЗАЕЗД' : 'СТАРТ ВДВОЁМ'; }
  function fail(text) { clearTimeout(timeout); clearTimeout(startAck); M.connected = false; M.running = false; controls(); status(text); if(M.active) { api.interrupt(); $('mp-panel').classList.remove('hidden'); } }
  function cleanup() { generation++; peerReady=false; clearTimeout(startAck); clearInterval(timer); clearTimeout(timeout); const p=peer; peer=null; conn=null; if(p)p.destroy(); M.connected=false; M.running=false; M.remote=null; bestRTT=Infinity; }
  function begin(at, id, round) { M.startAt=at; M.round=round; M.running=true; M.remote=null; sequence=0; received=-1; api.start(id); $('mp-panel').classList.add('hidden'); controls(); }
  function receive(d) {
    if(!d || d.v !== 1 || typeof d.t !== 'string')return;
    lastSeen=now();
    if(d.t==='ping' && Number.isFinite(d.at))send({t:'pong',at:d.at,there:now()});
    if(d.t==='pong' && Number.isFinite(d.at) && Number.isFinite(d.there)) {
      const rtt=now()-d.at; if(rtt>=0 && rtt<bestRTT) {bestRTT=rtt; M.offset=d.there-(d.at+now())/2;}
      send({t:'ready'}); controls();
    }
    if(d.t==='ready') { peerReady=true; if(M.host && bestRTT!==Infinity)status('Друг подключён. Можно стартовать!'); controls(); }
    if(d.t==='hello' && !M.host && Number.isInteger(d.course) && d.course>=0 && d.course<30) { course=d.course; status('Вы подключены. Ведущий выбирает момент старта.'); }
    if(d.t==='start' && !M.host && Number.isFinite(d.at) && Number.isInteger(d.round) && Number.isInteger(d.course) && d.course>=0 && d.course<30 && d.round>M.round) { begin(d.at-M.offset,d.course,d.round); send({t:'started',round:d.round}); }
    if(d.t==='started' && M.host && d.round===M.round)clearTimeout(startAck);
    if(d.t==='state' && M.running && d.round===M.round && Number.isInteger(d.seq) && d.seq>received && validState(d.p)) {received=d.seq; M.remote={...d.p,name:'ДРУГ',color:'#83ecdf',ai:false,remote:true}; api.remote(M.remote);}
    if(d.t==='leave')fail('Друг вышел. Вернитесь в меню или подключитесь заново.');
    if(d.t==='hidden')fail('Друг свернул игру. Заезд остановлен — подключитесь заново.');
  }
  function attach(c) {
    if(conn) {c.on('open',()=>c.close());return;} conn=c;
    c.on('data',d=>{if(conn===c)receive(d);});
    c.on('open',()=>{if(conn!==c)return;M.connected=true;lastSeen=now();clearTimeout(timeout);status('Связь установлена. Синхронизируем часы…');send({t:'hello',course});send({t:'ping',at:now()});controls();});
    c.on('close',()=>{if(conn===c)fail('Связь с другом потеряна. Нажмите «Подключиться заново».');});
    c.on('error',()=>{if(conn===c)fail('WebRTC-соединение не удалось. Попробуйте другой браузер или сеть.');});
  }
  function loadPeer() { if(window.Peer)return Promise.resolve();return new Promise((resolve,reject)=>{let s=document.getElementById('peerjs');if(s)s.remove();s=document.createElement('script');s.id='peerjs';s.src='https://cdn.jsdelivr.net/npm/peerjs@1.5.5/dist/peerjs.min.js';s.onload=resolve;s.onerror=reject;document.head.append(s);}); }
  async function connect(host, code) {
    cleanup(); const attempt=generation; M.active=true;M.host=host;M.round=0;M.offset=0;room=code;course=api.selected();api.interrupt();$('mp-panel').classList.remove('hidden');controls();status('Подключаемся к серверу комнат…');
    const url=new URL(location.href);url.searchParams.set('room',room);$('mp-link').value=url.href;$('mp-invite').hidden=!host;
    timeout=setTimeout(()=>fail('Не удалось соединиться за 25 секунд. Откройте ссылку в Chrome/Safari или смените сеть.'),25000);
    try { await loadPeer(); if(!M.active||attempt!==generation)return; peer=new Peer(host?'dust-turbo-'+room:undefined,{secure:true,debug:0});
      peer.on('open',()=>{if(attempt!==generation)return;if(host) {clearTimeout(timeout);status('Комната создана. Отправьте ссылку другу и дождитесь подключения.');} else attach(peer.connect('dust-turbo-'+room,{reliable:true,serialization:'json'}));});
      peer.on('connection',c=>{if(attempt!==generation){c.close();return;}if(M.host)attach(c);else c.close();});
      peer.on('error',e=>{if(attempt!==generation)return;fail(e.type==='peer-unavailable'?'Комната не найдена. Ведущий должен сначала открыть комнату.':'Сервер комнат или WebRTC недоступен. Попробуйте подключиться заново.');});
      peer.on('disconnected',()=>{if(attempt!==generation)return;if(!M.connected)fail('Сервер комнат отключился. Подключитесь заново.');});
      timer=setInterval(()=>{if(!M.connected)return;if(now()-lastSeen>12000){fail('Друг не отвечает. Заезд остановлен.');return;} send({t:'ping',at:now()});},1500);
    } catch (_) {if(attempt!==generation)return;fail('Не удалось загрузить сетевой модуль. Проверьте интернет. Одиночная игра доступна.');}
  }
  M.tick = () => { if(M.running && M.connected) {const p=api.player();if(p)send({t:'state',round:M.round,seq:++sequence,p:snapshot(p)});} };
  M.remaining = () => Math.max(0,(M.startAt-now())/1000);
  M.elapsed = () => Math.max(0,(now()-M.startAt)/1000);
  M.leave = () => {send({t:'leave'}); M.active=false;cleanup();$('mp-panel').classList.add('hidden');};
  M.hidden = () => {if(M.running){send({t:'hidden'});fail('Игра была свёрнута. Подключитесь заново для честного старта.');}};
  M.init = bridge => {
    api=bridge;
    $('friend').onclick=()=>{api.wake();const b=new Uint8Array(12);crypto.getRandomValues(b);connect(true,Array.from(b,n=>n.toString(16).padStart(2,'0')).join(''));};
    $('mp-start').onclick=()=>{if(!M.connected||!M.host||bestRTT===Infinity||!peerReady)return;api.wake();const at=now()+4000,round=M.round+1;send({t:'start',at,course,round});begin(at,course,round);startAck=setTimeout(()=>{send({t:'hidden'});fail('Друг не подтвердил старт. Подключитесь заново.');},2500);};
    $('mp-reconnect').onclick=()=>{api.wake();connect(M.host,room);};
    $('mp-exit').onclick=()=>{M.leave();api.home();};
    $('mp-copy').onclick=async()=>{try{await navigator.clipboard.writeText($('mp-link').value);status('Ссылка скопирована. Отправьте её другу.');}catch(_){$('mp-link').focus();$('mp-link').select();status('Скопируйте выделенную ссылку вручную.');}};
    $('mp-share').onclick=async()=>{try{if(navigator.share)await navigator.share({title:'Пыль и турбо — заезд с другом',url:$('mp-link').value});else $('mp-copy').click();}catch(_){}};
    const invite=new URL(location.href).searchParams.get('room');if(invite){$('mp-panel').classList.remove('hidden');status(validRoom(invite)?'Вас пригласили в заезд. Нажмите «Подключиться заново», чтобы войти.':'Некорректная ссылка комнаты. Создайте новую.');room=invite;M.host=false;$('mp-reconnect').disabled=!validRoom(invite);}
  };
})();

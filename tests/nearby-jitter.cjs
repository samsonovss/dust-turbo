// Drive the real WebSocket handler and renderer with two fixed-step riders.
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(process.env.CLIENT||path.join(__dirname,'../multiplayer.js'),'utf8');
function measure(bot){
 let clock=0,socket;
 const elements=new Map();
 function element(id){
  if(!elements.has(id))elements.set(id,{classList:{add(){},remove(){}},replaceChildren(){},setAttribute(){},addEventListener(){},append(){}});
  return elements.get(id);
 }
 class WS{constructor(){socket=this;this.readyState=1;}}
 const ctx={window:{},performance:{timeOrigin:0,now:()=>clock},WebSocket:WS,
  document:{getElementById:element,createElement:element},setInterval(){},clearInterval(){},clearTimeout(){}};
 vm.runInNewContext(source,ctx);
 const M=ctx.window.DustMultiplayer;
 M.init({interrupt(){},wake(){},start(){}});element('friend').onclick();
 const emit=data=>socket.onmessage({data:JSON.stringify({v:2,...data})});
 emit({t:'welcome',id:'me',now:0});
 emit({t:'room',players:[{id:'me'},{id:'other',slot:1}],phase:'racing'});
 emit({t:'start',ids:['me'],round:1,at:0});
 const packets=[];let relay=0,arrival=0;
 for(let step=0,i=0;step<1200;step+=bot?3:[3,4,3,5][i%4],i++){
  const sample=step*1000/60;
  relay=Math.max(relay,sample+(bot?0:[22,145,35,65,20,110,28][i%7]));
  arrival=Math.max(arrival,relay+[45,155,66,120,30,190][i%6]);
  packets.push({arrival,at:relay,seq:i+1,x:step*20});
 }
 let next=0,lastGap,sum=0,count=0,stalls=0;
 for(let frame=0;frame<1140;frame++){
  clock=frame*1000/60;
  while(next<packets.length&&packets[next].arrival<=clock){
   const {seq,at,x}=packets[next++];
   emit({t:'state',round:1,id:'other',bot,slot:1,seq,at,p:M.snapshot({x,speed:1200,lane:1})});
  }
  if(frame<180)continue;
  const before=M.remote.x,r=M.renderRemotes()[0];
  assert.equal(M.remote.x,before);
  const gap=r.x-frame*20;
  if(lastGap!==undefined){const delta=gap-lastGap;sum+=delta*delta;count++;if(Math.abs(delta+20)<1e-6)stalls++;}
  lastGap=gap;
 }
 return {rms:Math.sqrt(sum/count),stalls};
}
const results={human:measure(false),bot:measure(true)};
console.log(results);
for(const stats of Object.values(results)){assert(stats.rms<2);assert.equal(stats.stalls,0);}

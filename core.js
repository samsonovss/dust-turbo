/* Пыль и турбо — deterministic, dependency-free race simulation. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DustCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const BIOMES = [
    { name:'Рыжие каньоны', subtitle:'ПЕРВАЯ ИСКРА', sky:'#f7bd78', horizon:'#f88965', far:'#bf6558', near:'#713e52', ground:'#593d37', dirt:'#b96d48', edge:'#f6b66a', accent:'#ffb457', night:false },
    { name:'Хвойный перевал', subtitle:'ВЫШЕ ОБЛАКОВ', sky:'#a1d5cd', horizon:'#ecddaf', far:'#709d91', near:'#385f68', ground:'#304f43', dirt:'#8b9271', edge:'#d3d9a3', accent:'#a8e0aa', night:false },
    { name:'Неоновый порт', subtitle:'ПОСЛЕ ПОЛУНОЧИ', sky:'#111934', horizon:'#533f72', far:'#363253', near:'#25223f', ground:'#272637', dirt:'#626077', edge:'#a58db4', accent:'#ff73c1', night:true },
    { name:'Ледяной горизонт', subtitle:'ХОЛОДНЫЙ РАСЧЁТ', sky:'#7eaed3', horizon:'#dbe9ec', far:'#8dabc8', near:'#526d98', ground:'#465776', dirt:'#99bbc8', edge:'#e9faff', accent:'#8feaff', night:false },
    { name:'Вулканическая дуга', subtitle:'ПОСЛЕДНИЙ ФОРСАЖ', sky:'#362438', horizon:'#c36049', far:'#753e4d', near:'#412b39', ground:'#292935', dirt:'#69525a', edge:'#dd8763', accent:'#ff754c', night:true }
  ];
  const NAMES = [ ['Первый след','Прыжок веры','Пыльный зигзаг','Близнецы','Красная миля','Край каньона'], ['Хвойный спринт','По серпантину','Зелёная волна','Тропа медведя','Над туманом','Перевал ветров'], ['Ночная смена','Контейнерный бег','Радиоволна','После дождя','Электрошок','Не спит район'], ['Первый лёд','Снежная петля','Белый шум','За полярным','Ледяной пульс','Северное сияние'], ['Тёплый пепел','Линия разлома','Магма-ритм','Кольцо огня','На пределе','Пыль и турбо'] ];
  // Explicit authored section rhythms; seeded lane placement makes every track reproducible.
  const RHYTHMS = [
    ['ramp','cool','mud','ramp','cool'],
    ['ramp','ramp','mud','cool','ramp','mud'],
    ['mud','ramp','barrier','cool','mud','ramp'],
    ['ramp','ramp','cool','barrier','ramp','ramp','cool'],
    ['mud','barrier','ramp','cool','ramp','mud','barrier'],
    ['ramp','barrier','cool','ramp','mud','ramp','barrier','cool']
  ];
  function rng(seed) { let a=seed>>>0; return ()=>{a+=0x6D2B79F5;let t=a;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;}; }
  const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
  const PHYSICS = Object.freeze({ normal:1550, turbo:2175, acceleration:1400, gravity:180, overheat:1075 });
  // Heights are world heights used by both contact physics and Canvas rendering.
  const RAMP_SHAPES = Object.freeze({ kicker:{w:60,h:51,lip:60}, long:{w:100,h:105,lip:100}, tabletop:{w:75,h:78,lip:75}, high:{w:75,h:100,lip:75} });
  function rampHeight(f,x) {
    const d=x-f.x, lip=f.lip||f.w;
    if(d<0||d>f.w)return 0;
    if(d<=lip)return f.h*d/lip;
    if(d<=lip+(f.deck||0))return f.h;
    return f.h*(f.w-d)/(f.w-lip-(f.deck||0));
  }
  function rampSlope(f,x) {
    const d=x-f.x, lip=f.lip||f.w;
    if(d<0||d>f.w)return 0;
    if(d<lip||!f.deck)return f.h/lip;
    return d<lip+f.deck?0:-f.h/(f.w-lip-f.deck);
  }
  function surface(course,x,lane) {
    let result={height:0,slope:0,ramp:null};
    for(const f of course.features)if(f.type==='ramp'&&f.lanes.includes(lane)&&x>=f.x&&x<f.x+f.w){const height=rampHeight(f,x);if(height>=result.height)result={height,slope:rampSlope(f,x),ramp:f};}
    return result;
  }
  function course(id) {
    id=clamp(Math.floor(id)||0,0,29); const biome=Math.floor(id/6), local=id%6, rand=rng(1709+id*7919);
    const length=18000; // Roughly one minute at normal throttle, allowing for acceleration.
    const rhythm=RHYTHMS[local].flatMap(t=>t==='cool'?[t,'ramp']:t==='mud'?['ramp',t]:[t]); const features=[];
    let x=700; let n=0, rampCount=0;
    while(x<length-1700) {
      const type=rhythm[n%rhythm.length]; const lane=Math.floor(rand()*4);
      const lanes=type==='ramp' ? (n%2===0?[0,1,2,3]:[lane,(lane+1)%4,(lane+2)%4]) : type==='cool' ? [lane,(lane+1)%4] : [lane];
      const shape=['kicker','tabletop','high','long'][(rampCount+local+biome)%4];
      if(type==='ramp')rampCount++;
      const geometry=type==='ramp'?RAMP_SHAPES[shape]:{w:type==='cool'?310:type==='mud'?185:38,h:0};
      features.push({id:n,type,x,lanes,...geometry,...(type==='ramp'?{shape}: {})});
      // Linked doubles have a landing runway: no hidden barrier at the end of a jump.
      // Minimum launch-to-next-feature gap > longest boosted flight (~965 world units).
      if(type==='ramp'&&n%2===0)features.push({id:2000+n,type:'barrier',x:x+geometry.w+350,w:38,h:0,lanes:[lane]});
      x+=type==='ramp'?geometry.w+(shape==='high'?1400:1100)+rand()*90:380+rand()*130-biome*10;n++;
    }
    // Every track has an early, visible safe cooldown opportunity.
    features.push({id:9999,type:'cool',x:230,w:310,lanes:[0,1,2,3],h:0});
    features.sort((a,b)=>a.x-b.x);
    for(const f of features){f.x*=5;f.w*=5;if(f.lip)f.lip*=5;if(f.deck)f.deck*=5;}
    const gold=length/345+1.5, silver=length/300+3, bronze=length/252+6;
    return {id,biome,local,name:NAMES[biome][local],length:length*5,features,medals:{gold,silver,bronze}};
  }
  const COURSES=Array.from({length:30},(_,i)=>course(i));
  function rider(name,lane,color,ai=false) { return {name,lane,targetLane:lane,x:0,speed:0,z:0,vz:0,airborne:false,angle:0,angular:0,heat:0,overheat:false,crash:0,crashes:0,boosting:false,finished:false,finishTime:0,color,ai,seen:new Set(),bump:0}; }
  function createRace(id) {
    return {course:COURSES[clamp(id,0,29)],time:0,countdown:3.2,phase:'countdown',player:rider('ТЫ',1,'#ffe578'),opponents:[rider('ЛИС',0,'#ff7089',true),rider('ВОЛЬТ',2,'#83ecdf',true),rider('ЭХО',3,'#b7a1ff',true)],events:[],place:1};
  }
  function crash(r,sim,reason) { if(r.crash>0)return;r.crash=2.2;r.crashes++;r.speed*=0.08;r.z=surface(sim.course,r.x,Math.round(r.lane)).height;r.vz=0;r.airborne=false;r.angle=0;r.heat=Math.max(0,r.heat-25);if(!r.ai)sim.events.push({type:'crash',reason}); }
  function updateRider(r,sim,input,dt,index) {
    if(r.finished) return;
    if(r.crash>0){r.crash=Math.max(0,r.crash-dt);r.x+=r.speed*dt;r.speed*=Math.pow(0.2,dt);const ground=surface(sim.course,r.x,Math.round(r.lane));r.z=ground.height;r.angle=-Math.atan(ground.slope);return;}
    const wasAir=r.airborne; let gas=!!input.gas, boost=!!input.boost;
    if(r.ai){
      gas=true;boost=r.heat<77&&Math.sin(sim.time*0.9+index*2)>-0.1;
      const danger=sim.course.features.find(f=>f.x>r.x&&f.x-r.x<360&&(f.type==='barrier'||f.type==='mud')&&f.lanes.includes(Math.round(r.lane)));
      if(danger){const options=[0,1,2,3].filter(l=>!danger.lanes.includes(l));r.targetLane=options.reduce((best,l)=>Math.abs(l-r.lane)<Math.abs(best-r.lane)?l:best,options[0]);}
      r.angle*=Math.pow(0.003,dt);
    }
    const oldSurface=surface(sim.course,r.x,Math.round(r.lane));
    // Finish riding a slope before changing lanes; no sideways teleport onto a high deck.
    if(wasAir||!oldSurface.ramp) {
      const nextLane=r.lane+clamp(r.targetLane-r.lane,-dt*5,dt*5);
      if(wasAir||surface(sim.course,r.x,Math.round(nextLane)).height<=r.z+3)r.lane=nextLane;
    }
    const lane=Math.round(r.lane);
    const under=sim.course.features.filter(f=>r.x>=f.x&&r.x<=f.x+f.w&&f.lanes.includes(lane));
    const cool=!wasAir&&under.some(f=>f.type==='cool');
    r.cooling=cool;
    if(r.overheat&&r.heat<34)r.overheat=false;
    r.boosting=gas&&boost&&!r.overheat;
    r.heat=clamp(r.heat+(r.boosting?29:-19)*dt-(cool?75*dt:0),0,100);
    if(r.heat>=100){r.overheat=true;r.boosting=false;if(!r.ai)sim.events.push({type:'hot'});}
    let max=r.boosting?PHYSICS.turbo:PHYSICS.normal;
    if(r.ai)max*=0.91+index*0.018+sim.course.biome*0.006;
    if(r.overheat)max=PHYSICS.overheat;
    if(wasAir)max*=1.35;
    if(!wasAir&&under.some(f=>f.type==='mud'))max*=0.58;
    if(gas&&r.speed<max)r.speed=Math.min(max,r.speed+PHYSICS.acceleration*dt);else if(!gas)r.speed=Math.max(0,r.speed-450*dt);
    if(r.speed>max)r.speed=Math.max(max,r.speed-(wasAir?425:1200)*dt);
    const oldX=r.x;r.x+=r.speed*dt;
    const ground=surface(sim.course,r.x,lane);
    let airDt=wasAir?dt:0;
    if(!wasAir){
      const f=oldSurface.ramp;
      if(f&&oldX<f.x+(f.lip||f.w)&&r.x>=f.x+(f.lip||f.w)&&r.speed>95){
        const lip=f.x+(f.lip||f.w);
        // Launch from the physical crest with the uphill velocity, never from road level.
        r.z=f.h;r.vz=clamp(r.speed/PHYSICS.normal,0.35,1.5)*(f.shape==='high'?170:f.shape==='long'?135:105);r.airborne=true;
        r.speed*=1.35;
        r.angle=-0.55;
        airDt=(r.x-lip)/r.speed;
        if(!r.ai)sim.events.push({type:'jump',shape:f.shape});
      }else if(oldSurface.height>ground.height+12&&!ground.ramp){
        r.airborne=true;r.vz=0;airDt=dt;
      }else {r.z=ground.height;r.vz=0;r.angle=-Math.atan(ground.slope);}
    }
    if(r.airborne){
      const lean=r.ai?0:(input.lean||0);
      // No player auto-level: align the wheels before landing; AI corrects above.
      r.angle=clamp(r.angle+lean*2.3*airDt,-1.7,1.7);
      r.z+=r.vz*airDt-.5*PHYSICS.gravity*airDt*airDt;r.vz-=PHYSICS.gravity*airDt;
      if(r.z<=ground.height&&r.vz<=r.speed*ground.slope){
        const error=Math.abs(r.angle+Math.atan(ground.slope));
        r.z=ground.height;r.vz=0;r.airborne=false;
        if(error>.32)crash(r,sim,'НЕРОВНОЕ ПРИЗЕМЛЕНИЕ');
        else {if(!r.ai)sim.events.push({type:'land',perfect:error<.18});r.angle=-Math.atan(ground.slope);}
      }
    }
    for(const f of sim.course.features){
      if(!f.lanes.includes(lane))continue;
      if(f.type==='barrier'&&r.x>=f.x&&oldX<f.x+f.w&&r.z<20&&!r.seen.has(f.id)){r.seen.add(f.id);crash(r,sim,'ПРЕПЯТСТВИЕ');}
    }
    if(r.x>=sim.course.length){r.x=sim.course.length;r.finished=true;r.finishTime=sim.time;if(!r.ai)sim.events.push({type:'finish'});}
  }
  function step(sim,input={},dt=1/60) {
    dt=clamp(dt,0,0.05);sim.events=[];
    if(sim.phase==='finished')return sim;
    if(sim.phase==='countdown'){sim.countdown-=dt;if(sim.countdown<=0){sim.phase='racing';sim.events.push({type:'go'});}return sim;}
    sim.time+=dt;
    const riders=[sim.player,...sim.opponents];
    const previous=riders.map(r=>r.x);
    riders.forEach(r=>{r.collisionGrace=Math.max(0,(r.collisionGrace||0)-dt);});
    updateRider(sim.player,sim,input,dt,0);sim.opponents.forEach((r,i)=>updateRider(r,sim,{},dt,i));
    for(let i=0;i<riders.length;i++)for(let j=i+1;j<riders.length;j++){
      const a=riders[i],b=riders[j];
      if(a.finished||b.finished||a.crash>0||b.crash>0||a.collisionGrace>0||b.collisionGrace>0)continue;
      const before=previous[i]-previous[j],after=a.x-b.x;
      if(Math.abs(a.lane-b.lane)<0.42&&Math.abs(a.z-b.z)<26&&(Math.abs(after)<55||before*after<0)){
        crash(a,sim,'СТОЛКНОВЕНИЕ');crash(b,sim,'СТОЛКНОВЕНИЕ');
        a.collisionGrace=b.collisionGrace=3.7;
      }
    }
    sim.place=1+sim.opponents.filter(r=>r.finished?(!sim.player.finished||r.finishTime<sim.player.finishTime):r.x>sim.player.x).length;
    if(sim.player.finished)sim.phase='finished';
    return sim;
  }
  function lane(sim,delta){if(sim.player.crash<=0)sim.player.targetLane=clamp(sim.player.targetLane+delta,0,3);}
  function medal(c,time){return time<=c.medals.gold?'gold':time<=c.medals.silver?'silver':time<=c.medals.bronze?'bronze':'finish';}
  function freshSave(){return {version:2,unlocked:0,records:{},sound:true};}
  function parseSave(raw){try{const v=JSON.parse(raw);const s=freshSave();if(v&&(v.version===1||v.version===2)){s.unlocked=clamp(Number.isFinite(v.unlocked)?Math.floor(v.unlocked):0,0,29);s.sound=v.sound!==false;if(v.version===1)s.migrationNotice=true;if(v.version===2&&v.migrationNotice===true)s.migrationNotice=true;if(v.version===2&&v.records&&typeof v.records==='object'){for(let i=0;i<30;i++){const r=v.records[i];if(r&&Number.isFinite(r.time)&&r.time>0&&r.time<36000)s.records[i]={time:r.time,place:clamp(Math.floor(r.place)||4,1,4),medal:medal(COURSES[i],r.time)};}}}return s;}catch(_){return freshSave();}}
  function record(save,sim){const id=sim.course.id;const previous=save.records[id];const best=!previous||sim.time<previous.time;if(best)save.records[id]={time:sim.time,place:sim.place,medal:medal(sim.course,sim.time)};save.unlocked=Math.max(save.unlocked,Math.min(29,id+1));return best;}
  return {BIOMES,COURSES,PHYSICS,RAMP_SHAPES,rampHeight,rampSlope,surface,clamp,rng,createRace,step,lane,medal,freshSave,parseSave,record};
});

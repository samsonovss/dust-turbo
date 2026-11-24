const assert = require('node:assert/strict');
const C = require('../core.js');
const dt = 1/60;
function race(id=0) {
  const sim=C.createRace(id);
  sim.phase='racing';
  sim.opponents=[];
  return sim;
}
function traverse(f, correct) {
  const sim=race(), r=sim.player;
  Object.assign(r,{x:f.x-2300,speed:C.PHYSICS.normal,lane:f.lanes[0],targetLane:f.lanes[0]});
  let landed=false, jumps=0;
  while(r.x<f.x+f.w){
    const oldZ=r.z;
    C.step(sim,{gas:true,lean:correct&&r.angle<.03?1:0},dt);
    jumps+=sim.events.filter(e=>e.type==='jump').length;
    if(sim.events.some(e=>e.type==='crash')){
      assert(!correct && C.rampSlope(f,r.x)<0);
      return;
    }
    if(sim.events.some(e=>e.type==='land')){
      assert(correct && sim.events.some(e=>e.perfect));
      assert(r.x>f.x+f.lip && r.x<f.x+f.w && r.z>0);
      landed=true;
      console.log('touch',f.id,r.x.toFixed(1),r.z.toFixed(1));
    }
    if(landed) {
      assert(!r.airborne && r.z<=oldZ && oldZ-r.z<5);
      assert.equal(r.z,C.rampHeight(f,r.x));
    }
  }
  assert(correct && landed && jumps===1);
}
const sections=C.COURSES[0].features.filter(f=>f.type==='landing');
assert.equal(sections.length,3);
for(const f of sections){
  traverse(f,true); traverse(f,false);
  const sim=race(),r=sim.player;
  Object.assign(r,{x:f.x-1,speed:110,lane:f.lanes[0],targetLane:f.lanes[0]});
  while(r.x<f.x+f.w){
    C.step(sim,{gas:r.speed<110},dt);
    assert(!r.airborne && r.z===C.rampHeight(f,r.x));
  }
}
for(const course of C.COURSES){
  if(course.id)assert(!course.features.some(f=>f.type==='landing'));
  const sim=race(course.id),r=sim.player;
  while(!r.finished && sim.time<120)C.step(sim,{gas:true,lean:r.angle<0?1:0},dt);
  assert(r.finished);
  if(!course.id)console.log('course 0 normal',sim.time.toFixed(2));
}
const old={version:2,unlocked:12,sound:false,records:{0:{time:48,place:1},1:{time:55,place:2}}};
const migrated=C.parseSave(JSON.stringify(old));
assert.equal(migrated.migrationNotice,'course0');
assert.equal(migrated.records[0],undefined);
assert.equal(migrated.records[1].time,55);
assert.equal(migrated.unlocked,12);
assert.equal(migrated.sound,false);
delete migrated.migrationNotice;
assert.deepEqual(C.parseSave(JSON.stringify(migrated)),migrated);

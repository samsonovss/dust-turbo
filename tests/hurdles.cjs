const assert=require('node:assert/strict'),C=require('../core.js');
const barriers=C.COURSES.flatMap(c=>c.features.filter(f=>f.type==='barrier'));
assert(barriers.length);assert(barriers.every(f=>f.w===40&&f.h===32));
function crossing(z){const r=C.createRace(0);r.phase='racing';r.opponents=[];r.course={...r.course,features:[{id:1,type:'barrier',x:100,w:40,h:32,lanes:[1]}]};Object.assign(r.player,{x:90,speed:1000,z,airborne:z>0,vz:0,angle:0});C.step(r,{gas:true},1/60);return r.player;}
assert.equal(crossing(0).crashes,1);assert.equal(crossing(45).crashes,0);
const r=C.createRace(0);r.phase='racing';r.opponents=[];r.course={...r.course,features:[{id:1,type:'barrier',x:100,w:40,h:32,lanes:[1]}]};Object.assign(r.player,{x:145,speed:1000});C.step(r,{gas:true},1/60);assert.equal(r.player.crashes,0);
console.log('PASS all course hurdles: width40 height32, ground hit, airborne clearance, no collision beyond footprint');

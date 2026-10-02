/* Original Canvas2D artwork and browser shell. No external assets or dependencies. */
(function () {
  'use strict';
  const C = window.DustCore, $ = id => document.getElementById(id);
  const canvas = $('game'), ctx = canvas.getContext('2d');
  const KEY = 'dust-turbo-save-v1';
  let save;
  try { save = C.parseSave(localStorage.getItem(KEY)); } catch (_) { save = C.freshSave(); $('storage-warning').classList.remove('hidden'); }
  let selected = save.unlocked, biome = Math.floor(selected / 6), race = null, paused = false, camera = 0;
  let width = 1280, height = 720, clock = 0, last = 0, accumulator = 0, toastUntil = 0, goUntil = 0;
  let particles = [], audio = null, engine = null, engineGain = null, focusBeforeModal = null, worldClock = 0;
  const keys = new Set(), pointers = new Map();
  const pad = n => String(n).padStart(2, '0');
  const timeText = t => `${pad(Math.floor(t / 60))}:${pad(Math.floor(t % 60))}.${pad(Math.floor((t % 1) * 100))}`;
  const visible = (id, yes) => $(id).classList.toggle('hidden', !yes);
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch (_) { visible('storage-warning', true); } }
  function release() { keys.clear(); pointers.clear(); document.querySelectorAll('.pressed').forEach(el => el.classList.remove('pressed')); }
  function input() { const has = a => [...pointers.values()].includes(a); return { gas: keys.has('KeyZ') || keys.has('KeyW') || has('gas'), boost: keys.has('KeyX') || keys.has('Space') || has('boost'), lean: (keys.has('ArrowRight') || has('right') ? 1 : 0) - (keys.has('ArrowLeft') || has('left') ? 1 : 0) }; }
  function wakeAudio() {
    if (!save.sound) return;
    try {
      if (!audio) {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        audio = new AC(); engine = audio.createOscillator(); engineGain = audio.createGain();
        engine.type = 'sawtooth'; engine.frequency.value = 45; engineGain.gain.value = 0;
        engine.connect(engineGain).connect(audio.destination); engine.start();
      }
      if (audio.state === 'suspended') audio.resume().catch(() => {});
    } catch (_) { /* Sound is optional; the game remains playable. */ }
  }
  function beep(frequency, duration = .1, volume = .045) {
    if (!audio || audio.state !== 'running' || !save.sound) return;
    const o = audio.createOscillator(), g = audio.createGain(); o.type = 'square'; o.frequency.value = frequency;
    g.gain.setValueAtTime(volume, audio.currentTime); g.gain.exponentialRampToValueAtTime(.0001, audio.currentTime + duration);
    o.connect(g).connect(audio.destination); o.start(); o.stop(audio.currentTime + duration);
    o.onended = () => { o.disconnect(); g.disconnect(); };
  }
  function soundLabel() { $('sound').textContent = `ЗВУК: ${save.sound ? 'ВКЛ' : 'ВЫКЛ'}`; $('sound').setAttribute('aria-pressed', String(save.sound)); }
  function menuUI() {
    const b = C.BIOMES[biome]; document.documentElement.style.setProperty('--accent', b.accent);
    $('biome-kicker').textContent = b.subtitle; $('biome-title').textContent = b.name;
    $('progress-label').textContent = `${pad(save.unlocked + 1)} / 30`;
    $('continue-label').textContent = `${pad(selected + 1)} / ${C.COURSES[selected].name.toUpperCase()}`;
    $('medal-count').textContent = `${Object.values(save.records).filter(r => r.medal !== 'finish').length} МЕДАЛЕЙ`;
    $('biome-tabs').replaceChildren();
    C.BIOMES.forEach((b, i) => {
      const el = document.createElement('button'); el.textContent = pad(i + 1); el.title = b.name; el.setAttribute('role', 'tab'); el.setAttribute('aria-selected', String(i === biome)); el.setAttribute('aria-label', b.name); el.classList.toggle('active', i === biome);
      el.onclick = () => { biome = i; menuUI(); }; $('biome-tabs').append(el);
    });
    $('courses').replaceChildren();
    C.COURSES.slice(biome * 6, biome * 6 + 6).forEach(c => {
      const el = document.createElement('button'), rec = save.records[c.id], locked = c.id > save.unlocked;
      el.className = `course${selected === c.id ? ' selected' : ''}`; el.disabled = locked;
      el.innerHTML = `<span class="num">${pad(c.id + 1)}</span><span class="badge">${locked ? '⌑' : rec ? ({gold:'◆',silver:'◇',bronze:'◈',finish:'✓'}[rec.medal]) : '↗'}</span><strong>${c.name}</strong><small>${locked ? 'ОТКРОЙ ПРЕДЫДУЩУЮ' : rec ? timeText(rec.time) : `${(c.length / 1000).toFixed(2)} КМ · НОВАЯ`}</small>`;
      el.setAttribute('aria-label', `${c.name}${locked ? ', закрыта' : ''}`); el.setAttribute('aria-pressed', String(selected === c.id));
      el.onclick = () => { selected = c.id; menuUI(); beep(330, .05); }; $('courses').append(el);
    });
  }
  function closeModal() { visible('modal', false); if (focusBeforeModal && focusBeforeModal.isConnected) focusBeforeModal.focus(); focusBeforeModal = null; }
  function showModal(html) { focusBeforeModal = document.activeElement; $('modal-card').innerHTML = html; visible('modal', true); $('modal-card').querySelector('button').focus(); }
  function home() { release(); race = null; paused = false; particles = []; goUntil = 0; $('toast').classList.remove('show'); closeModal(); document.body.classList.remove('racing'); visible('menu', true); ['hud','pause','race-tip','touch-controls','countdown'].forEach(id => visible(id, false)); menuUI(); }
  function start(id = selected) {
    id = C.clamp(Math.floor(Number(id)) || 0, 0, 29); selected = id; biome = C.COURSES[id].biome;
    release(); closeModal(); race = C.createRace(id); paused = false; particles = []; camera = -cameraLead(); accumulator = 0; goUntil = 0;
    document.body.classList.add('racing'); document.documentElement.style.setProperty('--accent', C.BIOMES[biome].accent);
    visible('menu', false); ['hud','pause','race-tip','touch-controls'].forEach(id => visible(id, true));
    $('race-label').textContent = `${pad(id + 1)} / ${race.course.name.toUpperCase()}`;
    $('record-time').textContent = save.records[id] ? `РЕКОРД ${timeText(save.records[id].time)}` : 'РЕКОРД —';
    $('race-tip').textContent = 'Z / W — ГАЗ  ·  X / ПРОБЕЛ — ТУРБО  ·  ↑ ↓ — ПОЛОСА  ·  ← → — БАЛАНС В ПОЛЁТЕ';
    if (matchMedia('(pointer: coarse)').matches) $('race-tip').textContent = 'ДЕРЖИ ГАЗ · ↶ ↷ — БАЛАНС В ПОЛЁТЕ · ГОЛУБОЕ ОХЛАЖДАЕТ';
    updateHUD();
  }
  function pause(toggle = true) {
    if (!race || race.phase === 'finished') return;
    paused = toggle; release();
    if (!paused) { closeModal(); return; }
    showModal('<div class="eyebrow">МОТОР ПЕРЕВОДИТ ДУХ</div><h2 id="modal-title">ПИТ-СТОП.</h2><p>Поймай ритм. Следующий прыжок — твой.<br>Esc / P — продолжить · R — заново</p><button class="primary" id="resume">ПРОДОЛЖИТЬ ↗</button><div class="modal-actions"><button class="secondary" id="restart">ЗАНОВО</button><button class="secondary" id="back-menu">МАРШРУТЫ</button></div>');
    $('resume').onclick = () => { wakeAudio(); pause(false); }; $('restart').onclick = () => start(selected); $('back-menu').onclick = home;
  }
  function finish() {
    release(); const best = C.record(save, race); persist(); const m = C.medal(race.course, race.time);
    const label = {gold:'ЗОЛОТОЙ СЛЕД', silver:'СЕРЕБРЯНЫЙ РИТМ', bronze:'БРОНЗОВАЯ ИСКРА', finish:'МАРШРУТ ПРОЙДЕН'}[m];
    showModal(`<div class="eyebrow">${pad(selected + 1)} / ${race.course.name.toUpperCase()}</div><div class="result-emblem">${m === 'finish' ? '⚑' : '◆'}</div><h2 id="modal-title">${label}</h2><div class="result-time">${timeText(race.time)}</div>${best ? '<div class="new-best">НОВЫЙ ЛИЧНЫЙ РЕКОРД</div>' : ''}<div class="result-stats"><span>МЕСТО <b>${race.place} / 4</b></span><span>ПАДЕНИЯ <b>${race.player.crashes}</b></span></div><div class="medal-targets">ЗОЛОТО ${timeText(race.course.medals.gold)} · СЕРЕБРО ${timeText(race.course.medals.silver)}<br>БРОНЗА ${timeText(race.course.medals.bronze)}</div><button class="primary" id="next">${selected < 29 ? 'СЛЕДУЮЩАЯ ТРАССА ↗' : 'ВСЕ 30 ТРАСС ПРОЙДЕНЫ ↗'}</button><div class="modal-actions"><button class="secondary" id="restart">ЕЩЁ РАЗ</button><button class="secondary" id="back-menu">МАРШРУТЫ</button></div>`);
    $('next').onclick = () => selected < 29 ? start(selected + 1) : home(); $('restart').onclick = () => start(selected); $('back-menu').onclick = home;
    beep(660, .25); visible('countdown', false);
  }
  function toast(text) { $('toast').textContent = text; $('toast').classList.add('show'); toastUntil = clock + 1.6; }
  function advance(dt, controls) {
    if (!race || paused || race.phase === 'finished') return;
    const count = Math.ceil(race.countdown); C.step(race, controls, dt);
    if (race.phase === 'countdown' && count !== Math.ceil(race.countdown)) beep(220, .08);
    race.events.forEach(e => {
      if (e.type === 'go') { goUntil = clock + .8; beep(660, .16); }
      if (e.type === 'jump') { burst(race.player, 8, '#ffe3a0'); beep(440, .06, .018); }
      if (e.type === 'land') { burst(race.player, 13, C.BIOMES[biome].edge); if (e.perfect) toast('ЧИСТОЕ ПРИЗЕМЛЕНИЕ'); }
      if (e.type === 'crash') { burst(race.player, 22, '#ffac72'); toast(e.reason); beep(85, .25); }
      if (e.type === 'hot') { toast('ПЕРЕГРЕВ! ОТПУСТИ ТУРБО'); beep(120, .3); }
      if (e.type === 'finish') finish();
    });
  }
  function updateHUD() {
    if (!race) return;
    const r = race.player; $('position').textContent = race.place; $('timer').textContent = timeText(race.time); $('speed').textContent = Math.round(r.speed);
    $('race-progress-fill').style.width = `${100 * r.x / race.course.length}%`; $('heat-value').textContent = `${Math.round(r.heat)}%`;
    $('heat-fill').style.width = `${r.heat}%`; $('heat-fill').style.background = r.overheat ? '#ff6262' : r.heat > 75 ? '#ff9864' : 'var(--accent)';
    $('heat-label').textContent = r.cooling ? 'ОХЛАЖДЕНИЕ МОТОРА' : r.overheat ? 'ПЕРЕГРЕВ / ОСТЫВАЕМ' : 'ТЕМПЕРАТУРА';
    const counting = race.phase === 'countdown'; visible('countdown', counting || clock < goUntil);
    $('countdown').textContent = counting ? Math.min(3, Math.ceil(race.countdown)) : 'ГАЗ!';
  }
  // Pixel-art world is rendered in a fixed logical viewport, with DPR-backed output.
  let W = 1280, H = 720, unit = 1, roadTop = 380, laneH = 64, viewScale = 1;
  const cameraLead = () => Math.min(W*.23,260)/viewScale;
  function resize() {
    width = innerWidth; height = innerHeight; const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
    H = 720; W = width / height * H; unit = canvas.height / H;
    roadTop = 362; laneH = 65;
    // Wider physical view; even portrait gets > 1 second to spot hazards.
    viewScale = Math.max(.36, Math.min(.9, W / 1300));
    ctx.setTransform(unit, 0, 0, unit, 0, 0); ctx.imageSmoothingEnabled = false;
  }
  const rect = (x,y,w,h,color) => { ctx.fillStyle = color; ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h)); };
  function poly(points, color) { ctx.fillStyle = color; ctx.beginPath(); points.forEach((p,i) => i ? ctx.lineTo(p[0],p[1]) : ctx.moveTo(p[0],p[1])); ctx.closePath(); ctx.fill(); }
  const screenX = x => (x - camera)*viewScale;
  const laneY = l => roadTop + laneH * (l + .5);
  function mountainLayer(color, base, factor, span, amplitude, salt) {
    const offset = camera * factor * viewScale; const first = Math.floor(offset / span) - 1;
    for (let i = first; i < first + W / span + 3; i++) {
      const random = C.rng((i + 10000) * 71 + salt), x = i * span - offset, peak = base - amplitude * (.6 + random() * .6);
      const pts = [[x,base],[x+span*.15,base-25],[x+span*.29,base-25],[x+span*.45,peak+27],[x+span*.51,peak+27],[x+span*.57,peak],[x+span*.67,peak],[x+span*.84,base-38],[x+span,base],[x+span,H],[x,H]];
      poly(pts,color);
      if (biome === 3) poly([[x+span*.45,peak+27],[x+span*.57,peak],[x+span*.67,peak],[x+span*.77,peak+46],[x+span*.64,peak+33],[x+span*.56,peak+40]], '#d8e8ec');
      if (biome === 4 && factor > .1) { poly([[x+span*.57,peak],[x+span*.67,peak],[x+span*.72,peak+32],[x+span*.61,peak+23]],'#fb9760'); rect(x+span*.64,peak+24,5,33,'#da644b'); }
    }
  }
  function tree(x,y,size,color) { rect(x-3*size,y-45*size,6*size,47*size,'#38403f'); for(let i=0;i<3;i++) poly([[x,y-(83-i*18)*size],[x-(18+i*5)*size,y-(42-i*17)*size],[x+(18+i*5)*size,y-(42-i*17)*size]],color); }
  function backdrop(b) {
    const sky = ctx.createLinearGradient(0,0,0,roadTop); sky.addColorStop(0,b.sky); sky.addColorStop(1,b.horizon); ctx.fillStyle = sky; ctx.fillRect(0,0,W,H);
    if (b.night) { for(let i=0;i<52;i++) { const x = (i*137.7+29)%Math.max(W,1), y = 25+(i*43)%210; rect(x,y,i%7===0?3:2,2,'#c8b7b5'); } }
    const sunX = W*.72 - Math.sin(camera*.0001)*25; rect(sunX,112,67,67,b.night?'#ffe0b3':'#ffe6a6'); rect(sunX-8,123,83,43,b.night?'#ffe0b3':'#ffe6a6');
    if (biome === 2) {
      for(let layer=0;layer<2;layer++) {
        const shift = camera*viewScale*(layer ? .22 : .09), span = layer?84:113;
        for(let i=Math.floor(shift/span)-1;i<(shift+W)/span+1;i++) {
          const rnd=C.rng(i+4000+layer*88), x=i*span-shift, h=60+rnd()*155, y=340-h;
          rect(x,y,span-11,h,layer?b.near:b.far); rect(x+8,y-9,span-29,9,layer?b.near:b.far);
          for(let wx=10;wx<span-20;wx+=14)for(let wy=15;wy<h-8;wy+=18)if(rnd()>.42)rect(x+wx,y+wy,4,7,rnd()>.6?'#ec9f8e':'#8993c6');
          if(layer&&i%3===0){rect(x+10,y+23,37,19,'#ff73c1');rect(x+15,y+28,27,3,'#392844');}
        }
      }
    } else { mountainLayer(b.far,320,.08,310,160,54); mountainLayer(b.near,365,.19,380,145,92); }
    if (biome===1||biome===3) {
      const shift=camera*viewScale*.38; for(let i=Math.floor(shift/72)-1;i<(shift+W)/72+1;i++)tree(i*72-shift,360,.65+(i%3+3)%3*.15,biome===1?'#345a56':'#698b9f');
    }
    if (biome===0) { const shift=camera*viewScale*.36; for(let i=Math.floor(shift/230)-1;i<(shift+W)/230+1;i++) {const x=i*230-shift;rect(x,300,9,62,'#454c47');rect(x-15,321,15,7,'#454c47');rect(x-16,307,6,20,'#454c47');rect(x+9,312,14,7,'#454c47');rect(x+18,296,6,23,'#454c47');} }
    rect(0,345,W,H-345,b.ground); rect(0,355,W,7,b.edge); rect(0,362,W,260,b.dirt); rect(0,622,W,10,b.edge); rect(0,632,W,7,'#272c34');
    for(let lane=1;lane<4;lane++){rect(0,roadTop+lane*laneH,W,2,'#ffffff18'); const shift=(camera*viewScale)%90;for(let x=-shift;x<W;x+=90)rect(x,roadTop+lane*laneH,35,2,b.edge+'88');}
    const roadOffset=camera*viewScale;
    for(let i=Math.floor(roadOffset/53)-1;i<(roadOffset+W)/53+1;i++){const rnd=C.rng(i+15000);for(let j=0;j<3;j++)rect(i*53-roadOffset+rnd()*40,370+rnd()*244,3+rnd()*7,2,'#241d281a');}
    const shift=roadOffset*.95;for(let i=Math.floor(shift/110)-1;i<(shift+W)/110+1;i++){const x=i*110-shift;rect(x,666+(i%3)*12,18,5,b.near);rect(x+7,659+(i%3)*12,9,7,b.near);}
  }
  function feature(f,l,b) {
    const x=screenX(f.x), y=laneY(l), w=f.w*viewScale;
    if(x>W+100||x+w<-100)return;
    if(f.type==='cool') {
      rect(x,y-25,w,48,'#3b929e');rect(x+2,y-23,w-4,5,'#a6f1e3');rect(x,y+20,w,4,'#246875');
      ctx.save();ctx.fillStyle='#e3ffff';ctx.font='bold 13px monospace';ctx.textAlign='left';ctx.fillText('ОХЛАЖДЕНИЕ',Math.max(x+12,12),y-30);ctx.restore();
      for(let j=0;j<5;j++){const xx=x+8+j*(w-20)/5;rect(xx,y-8+Math.sin(clock*3+j)*3,13,3,'#a5eeeb');rect(xx-3,y+9,9,2,'#76c8cd');}
    } else if(f.type==='mud') {rect(x,y-21,w,42,'#594341');rect(x+7,y-25,w-18,7,'#594341');rect(x+12,y-10,22,5,'#806049');rect(x+52,y+7,27,5,'#372e36');rect(x+6,y+15,16,3,'#a07151');}
    else if(f.type==='ramp') {
      const lip=f.lip||f.w;
      const profile=[[0,0],[lip,f.h]];
      if(f.deck)profile.push([lip+f.deck,f.h],[f.w,0]);
      const top=profile.map(([dx,h])=>[x+dx*viewScale,y-23-h]);
      const bottom=profile.map(([dx,h])=>[x+dx*viewScale,y+25-h]);
      poly([[x,y+25],...bottom,[x+w,y+25]],'#65404a');
      poly([...top,...bottom.slice().reverse()],'#dca069');
      rect(x+lip*viewScale-4,y-23-f.h,4,48,'#ffe2a0');
      for(let j=18;j<f.w-8;j+=28){const h=C.rampHeight(f,f.x+j), next=C.rampHeight(f,f.x+j+6);poly([[x+j*viewScale,y-20-h],[x+(j+6)*viewScale,y-20-next],[x+(j+6)*viewScale,y+21-next],[x+j*viewScale,y+21-h]],'#8c6655');}
      const ax=x+lip*viewScale*.52, ay=y-f.h*.52;
      poly([[ax-10,ay-8],[ax+12,ay-4],[ax-10,ay+9]],'#fff0b3');
    } else {
      rect(x-3,y+13,w+7,10,'#392d38');rect(x,y-21,w,37,'#e6b566');
      for(let j=0;j<w;j+=12)poly([[x+j,y-21],[x+Math.min(j+7,w),y-21],[x+Math.min(j+14,w),y+16],[x+Math.min(j+7,w),y+16]],'#4b3a42');
      rect(x-3,y-25,w+6,6,'#ffe2a0');rect(x+4,y+16,5,8,'#3a3440');rect(x+w-8,y+16,5,8,'#3a3440');
    }
  }
  function burst(r,n,color) { for(let i=0;i<n;i++)particles.push({x:r.x-15,y:laneY(r.lane)-r.z,vx:-30-Math.random()*100,vy:-20-Math.random()*75,life:.3+Math.random()*.5,max:.8,color,size:2+Math.random()*5}); }
  function rider(r, isPlayer, demo=false) {
    const x=screenX(r.x), base=laneY(r.lane)+9; if(x<-100||x>W+120)return;
    const ground=race?C.surface(race.course,r.x,Math.round(r.lane)).height:0;
    ctx.globalAlpha=.24;ctx.fillStyle='#141421';ctx.beginPath();ctx.ellipse(x,base+5-ground,Math.max(15,38-(r.z-ground)*.04),8,0,0,Math.PI*2);ctx.fill();ctx.globalAlpha=1;
    const bob=r.airborne||r.z>0?0:Math.sin(worldClock*(r.speed>5?22:5))*(r.speed>5?1.1:.35);
    const y=base-r.z+bob;
    ctx.save();ctx.translate(Math.round(x),Math.round(y));ctx.rotate(r.crash>0 ? .9 : (r.airborne||demo?r.angle:Math.atan(Math.tan(r.angle)/viewScale)));
    if(r.crash>0)ctx.globalAlpha=.5+Math.sin(clock*30)*.3;
    if(r.boosting&&!r.crash){poly([[-28,-16],[-51-Math.sin(clock*43)*13,-11],[-32,-6]],'#ff8655');poly([[-28,-14],[-44,-11],[-29,-9]],'#ffe59c');}
    for(const wx of [-23,24]) {
      rect(wx-11,-11,22,20,'#222632');rect(wx-8,-14,16,26,'#222632');rect(wx-14,-8,28,14,'#222632');
      rect(wx-8,-8,16,15,'#aba8ad');rect(wx-5,-5,10,9,'#343c4b');
      const spin=r.x*.11;ctx.strokeStyle='#e8d6bd';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(wx-Math.cos(spin)*7,-1-Math.sin(spin)*7);ctx.lineTo(wx+Math.cos(spin)*7,-1+Math.sin(spin)*7);ctx.stroke();rect(wx-2,-3,4,4,'#ffe9be');
    }
    poly([[-24,-2],[-11,-25],[15,-25],[24,-2],[2,-8]],'#242733');
    ctx.strokeStyle='#d2c1b0';ctx.lineWidth=4;ctx.beginPath();ctx.moveTo(-23,-2);ctx.lineTo(-8,-19);ctx.lineTo(5,-4);ctx.lineTo(-23,-2);ctx.moveTo(24,-2);ctx.lineTo(17,-30);ctx.stroke();
    rect(-25,-24,20,5,r.color);rect(-15,-29,26,9,r.color);rect(-11,-33,18,5,'#fff0cf');rect(15,-24,20,5,r.color);rect(16,-34,4,14,'#d7c3ba');rect(10,-36,14,3,'#262b36');
    rect(-6,-19,13,11,'#696772');rect(-3,-16,9,2,'#d6c3b4');rect(-3,-12,9,2,'#d6c3b4');rect(-27,-17,17,4,'#c6a68e');
    // Articulated legs and forward racing posture.
    const tuck=r.boosting?5:0, bounce=Math.sin(worldClock*9)*1.5;
    poly([[-11,-36],[-3,-34],[6,-23],[0,-12],[-8,-12],[-3,-24],[-15,-29]],'#313748');rect(-8,-14,13,5,'#f1dbc0');
    poly([[-13,-35],[-14+tuck,-51+bounce],[-2+tuck,-57+bounce],[6+tuck,-47],[0,-33]],r.color);rect(-11+tuck,-49+bounce,6,13,'#fff1ca');
    poly([[3+tuck,-49],[9+tuck,-48],[13,-36],[19,-35],[18,-31],[8,-32]],'#e2ad8a');rect(14,-36,7,5,'#2d3040');
    rect(-6+tuck,-69+bounce,17,17,r.color);rect(-9+tuck,-65+bounce,22,11,r.color);rect(2+tuck,-63+bounce,14,7,'#252e43');rect(4+tuck,-63+bounce,9,2,'#a9e9e3');rect(-5+tuck,-71+bounce,13,3,'#ffefd2');rect(9+tuck,-57+bounce,6,4,'#fff0d0');
    ctx.restore();
    if(isPlayer&&!demo) {rect(x-3,y-94,6,5,'#fff1c4');poly([[x-6,y-90],[x+6,y-90],[x,y-84]],'#fff1c4');}
    if(!demo){ctx.font='bold 9px monospace';ctx.textAlign='center';ctx.fillStyle=isPlayer?'#fff2c8':r.color;ctx.fillText(r.name,x,y-103);}
  }
  function render(dt) {
    ctx.setTransform(unit,0,0,unit,0,0);
    if(race)camera = race.player.x-cameraLead();
    else camera=clock*45;
    const b=C.BIOMES[biome];backdrop(b);
    const course=race?race.course:C.COURSES[biome*6];
    if(race){const fx=screenX(course.length);if(fx>-100&&fx<W+100){rect(fx-7,roadTop-94,7,94,'#ede0c3');rect(fx-7,roadTop-95,107,27,'#292b37');ctx.fillStyle='#fff0cc';ctx.font='bold 16px monospace';ctx.textAlign='left';ctx.fillText('ФИНИШ',fx+10,roadTop-75);}}
    const fs=race?course.features:[{x:camera+W*.57/viewScale,...C.RAMP_SHAPES.kicker,lanes:[0,1,2,3],type:'ramp'},{x:camera+W*.82/viewScale,w:180,h:0,lanes:[2,3],type:'cool'}];
    for(let lane=0;lane<4;lane++) {
      fs.forEach(f=>{if(f.lanes.includes(lane))feature(f,lane,b);});
      if(race) {
        if(screenX(0)>-30&&screenX(0)<W)for(let j=0;j<8;j++)rect(screenX(0),roadTop+lane*laneH+j*8,10,8,j%2?'#e4d9bb':'#34303c');
        const finishX=screenX(course.length);if(finishX>-40&&finishX<W+40)for(let row=0;row<8;row++)for(let col=0;col<3;col++)rect(finishX+col*9,roadTop+lane*laneH+row*8,9,8,(row+col)%2?'#fff0d7':'#34303c');
        [...race.opponents,race.player].filter(r=>Math.round(r.lane)===lane).sort((a,b)=>a.lane-b.lane).forEach(r=>rider(r,r===race.player));
      }else if(lane===2){rider({x:camera+W*.43/viewScale,lane:2,z:5+Math.max(0,Math.sin(clock*.9))*36,angle:-.12,speed:110,color:'#ffe578',name:'ТЫ',boosting:true,crash:0},true,true);}
    }
    if(race&&race.player.speed>30&&!race.player.airborne&&!paused&&race.phase==='racing'&&Math.random()<.7)burst(race.player,1,b.edge);
    particles=particles.filter(p=>p.life>0);for(const p of particles){if(!paused){p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=130*dt;}ctx.globalAlpha=Math.max(0,p.life/p.max)*.65;rect(screenX(p.x),p.y,p.size,p.size,p.color);}ctx.globalAlpha=1;
    if(race&&race.player.speed>280&&!paused){const speed=race.player.speed;for(let i=0;i<(race.player.boosting?8:4);i++)rect((W-(worldClock*speed*1.6+i*173)%W),330+(i*61)%330,12+speed*.035+i*3,2,race.player.boosting?'#fff6d832':'#fff6d817');}
  }
  function frame(now) {
    const dt=Math.min((now-last)/1000||0,.1);last=now;clock+=dt;if(!paused)worldClock+=dt;
    if(race&&!paused){accumulator+=dt;while(accumulator>=1/60){advance(1/60,input());accumulator-=1/60;}}else accumulator=0;
    render(dt);updateHUD();if(clock>toastUntil)$('toast').classList.remove('show');
    if(engineGain&&audio){const active=save.sound&&race&&!paused&&race.phase==='racing'&&!document.hidden;engineGain.gain.setTargetAtTime(active?.013:0,audio.currentTime,.06);engine.frequency.setTargetAtTime(active?42+race.player.speed*.63:42,audio.currentTime,.07);}
    requestAnimationFrame(frame);
  }
  $('play').onclick=()=>{wakeAudio();start();};$('home').onclick=e=>{e.preventDefault();home();};$('pause').onclick=()=>pause(!paused);
  $('sound').onclick=()=>{save.sound=!save.sound;soundLabel();persist();wakeAudio();};$('rotate-dismiss').onclick=()=>$('rotate-hint').classList.add('dismissed');
  const gameKeys=['KeyZ','KeyW','KeyX','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape','KeyP','KeyR'];
  addEventListener('keydown',e=>{
    if(e.code==='Tab'&&!$('modal').classList.contains('hidden')){const buttons=[...$('modal').querySelectorAll('button')];if(e.shiftKey&&document.activeElement===buttons[0]){e.preventDefault();buttons.at(-1).focus();}else if(!e.shiftKey&&document.activeElement===buttons.at(-1)){e.preventDefault();buttons[0].focus();}return;}
    if(!race||!gameKeys.includes(e.code))return;
    if(e.code==='Space'&&document.activeElement?.tagName==='BUTTON'&&!$('modal').classList.contains('hidden'))return;
    e.preventDefault();wakeAudio();if(e.repeat)return;
    if(e.code==='Escape'||e.code==='KeyP'){pause(!paused);return;}if(e.code==='KeyR'){start(selected);return;}
    if(paused||race.phase==='finished')return;keys.add(e.code);if(e.code==='ArrowUp')C.lane(race,-1);if(e.code==='ArrowDown')C.lane(race,1);
  });
  addEventListener('keyup',e=>keys.delete(e.code));
  document.querySelectorAll('[data-action]').forEach(button=>{
    button.addEventListener('pointerdown',e=>{e.preventDefault();if(!race||paused||race.phase==='finished')return;wakeAudio();button.setPointerCapture(e.pointerId);const action=button.dataset.action;pointers.set(e.pointerId,action);button.classList.add('pressed');if(action==='up')C.lane(race,-1);if(action==='down')C.lane(race,1);});
    const end=e=>{pointers.delete(e.pointerId);if(![...pointers.values()].includes(button.dataset.action))button.classList.remove('pressed');};
    button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);button.addEventListener('lostpointercapture',end);button.addEventListener('contextmenu',e=>e.preventDefault());
  });
  addEventListener('blur',()=>{release();if(race&&race.phase!=='finished'&&!paused)pause(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){release();if(race&&race.phase!=='finished')pause(true);if(engineGain&&audio)engineGain.gain.setValueAtTime(0,audio.currentTime);}});
  addEventListener('resize',resize);
  window.__game={get state(){return {race,paused,selected,biome,save};},start,step(dt,controls={}){let remaining=C.clamp(Number(dt)||0,0,120);while(remaining>0){const slice=Math.min(remaining,1/60);advance(slice,controls);remaining-=slice;}updateHUD();return race;},pause,home};
  resize();soundLabel();menuUI();
  if(save.migrationNotice){
    showModal('<div class="eyebrow">БОЛЬШЕ СКОРОСТИ · ДЛИННЕЕ ТРАССЫ</div><h2 id="modal-title">НОВЫЙ СЕЗОН.</h2><p>Трассы стали намного длиннее, а мотоциклы — быстрее. Старые времена больше несопоставимы, поэтому рекорды сброшены.<br><br>Все открытые трассы и настройка звука сохранены.</p><button class="primary" id="migration-ok">ПОНЯТНО · НА СТАРТ ↗</button>');
    $('migration-ok').onclick=()=>{delete save.migrationNotice;persist();closeModal();};
  }
  requestAnimationFrame(frame);
})();

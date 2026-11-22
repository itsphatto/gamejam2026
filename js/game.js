(() => {
  'use strict';
  const C = window.GAME_CONFIG;
  const CAMS = window.CAMERAS;
  const U = window.CCTV;
  const W = 1280, H = 720;
  const $ = (id) => document.getElementById(id);

  const screenEl = $('screen');
  const view = $('view'), vctx = view.getContext('2d');
  const draw = $('draw'), dctx = draw.getContext('2d');
  const sfx = window.GameAudio; // real sound files, see js/audio.js

  // ---------- Room data ----------
  const rooms = CAMS.map((cam, index) => ({ cam, index, entries: U.getEntries(cam.id, window.ANOMALY_DATA) }));
  // Called once all images have tried to load. Only images that exist are used;
  // a room with no anomaly images simply never gets an anomaly.
  function prepareRooms() {
    rooms.forEach((r) => {
      const exists = (e) => !!U.getLoaded(r.cam.id, e.num);
      r.normals = r.entries.filter((e) => !e.anomaly && exists(e));
      if (!r.normals.length) r.normals = [{ num: r.entries[0].num, anomaly: null }]; // placeholder
      r.anoms = r.entries.filter((e) => e.anomaly && exists(e));
    });
  }

  // ---------- Noise frames ----------
  const noiseFrames = Array.from({ length: 6 }, () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const x = c.getContext('2d');
    const d = x.createImageData(320, 180);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = Math.random() * 255;
      d.data[i] = d.data[i + 1] = d.data[i + 2] = v; d.data[i + 3] = 255;
    }
    x.putImageData(d, 0, 0);
    return c;
  });
  const noise = (alpha) => {
    vctx.globalAlpha = alpha;
    vctx.drawImage(noiseFrames[(Math.random() * noiseFrames.length) | 0], 0, 0, W, H);
    vctx.globalAlpha = 1;
  };

  // ---------- State ----------
  let state = { running: false, paused: false, processing: false, t: 0, cur: 0, cams: [] }; // until images load
  function newState() {
    return {
      running: false, paused: false, over: false,
      t: 0, cur: 0,
      staticUntil: 0,       // performance.now() ms
      processing: false,
      lockUntil: 0,         // game seconds
      nextSpawn: C.firstAnomalyDelay,
      shakeLevel: 0,        // 0 none, 1 shaking, 2 hard
      cams: rooms.map((r) => ({
        index: r.index,
        base: r.normals[(Math.random() * r.normals.length) | 0],
        active: null,       // anomaly entry currently shown
        since: 0,           // game time it appeared
        reported: false,    // correct report already sent (timer stopped)
        used: new Set(),
      })),
      stats: { spawned: 0, found: 0, wrong: 0 },
    };
  }
  const totalTime = () => (C.endHour - C.startHour) * C.secondsPerHour;

  // ---------- Camera switching ----------
  const camDots = CAMS.map(() => {
    const d = document.createElement('span');
    d.className = 'cam-dot';
    $('camDots').appendChild(d);
    return d;
  });

  function switchCam(i) {
    if (!state.running || state.paused || state.processing) return;
    i = (i + CAMS.length) % CAMS.length;
    if (i === state.cur) return;
    cancelDrawing();
    state.cur = i;
    state.staticUntil = performance.now() + 180;
    sfx.switchCam();
    updateCamUI();
  }

  const calm = matchMedia('(prefers-reduced-motion: reduce)');
  // blur-morph an element whose text just changed
  const morph = (el) => calm.matches || el.animate([{ opacity: 0.2, filter: 'blur(6px)' }, {}], { duration: 220, easing: 'ease-out' });

  function updateCamUI() {
    const cam = CAMS[state.cur];
    $('osdCam').textContent = `${cam.label} ${cam.name}`;
    morph($('osdCam'));
    camDots.forEach((d, i) => d.classList.toggle('on', i === state.cur));
  }

  let toastTimer = 0;
  function toast(text, kind = 'info', ms = 1800) {
    const el = $('toast');
    el.textContent = text; el.className = `morph ${kind}`; morph(el);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }

  // ---------- Clock (24h) ----------
  function clockParts() {
    const gameSec = (state.t / C.secondsPerHour) * 3600 + C.startHour * 3600;
    return {
      h: Math.floor(gameSec / 3600) % 24,
      m: Math.floor(gameSec / 60) % 60,
      s: Math.floor(gameSec) % 60,
    };
  }
  const today = new Date();
  const dateStr = `${U.pad(today.getDate())}/${U.pad(today.getMonth() + 1)}/${today.getFullYear()}`;
  function updateClockUI() {
    const { h, m, s } = clockParts();
    $('osdClock').textContent = `${U.pad(h)}:${U.pad(m)}`;
    $('osdTime').textContent = `${dateStr}  ${U.pad(h)}:${U.pad(m)}:${U.pad(s)}`;
  }

  // ---------- Anomaly spawning ----------
  function scheduleNext() {
    const progress = Math.min(1, state.t / totalTime());
    const mult = 1 + (C.lateNightSpeedup - 1) * progress;
    const [a, b] = C.spawnInterval;
    state.nextSpawn = state.t + (a + Math.random() * (b - a)) * mult;
  }

  function trySpawn() {
    // Never spawn on the cam the player is looking at (no visible pop-in)
    const candidates = state.cams.filter((c) => !c.active && c.index !== state.cur && rooms[c.index].anoms.length);
    if (!candidates.length) { state.nextSpawn = state.t + 3; return; }
    const cs = candidates[(Math.random() * candidates.length) | 0];
    const room = rooms[cs.index];
    let pool = room.anoms.filter((e) => !cs.used.has(e.num));
    if (!pool.length) { cs.used.clear(); pool = room.anoms; }
    const e = pool[(Math.random() * pool.length) | 0];
    cs.used.add(e.num);
    cs.active = e;
    cs.since = state.t;
    cs.reported = false;
    state.stats.spawned++;
    scheduleNext();
  }

  // ---------- 10-second timer: shake, then jumpscare ----------
  function oldestUnreported() {
    let worst = null;
    for (const cs of state.cams) {
      if (cs.active && !cs.reported && (!worst || cs.since < worst.since)) worst = cs;
    }
    return worst;
  }

  function updateDanger() {
    const cs = oldestUnreported();
    const age = cs ? state.t - cs.since : 0;
    if (cs && age >= C.anomalyTimeLimit) return jumpscare(cs);
    const level = !cs || age < C.shakeStart ? 0 : age < C.shakeHard ? 1 : 2;
    if (level !== state.shakeLevel) {
      if (level >= 1 && state.shakeLevel === 0) { sfx.warning(); sfx.setDanger(true); }
      if (level === 0) sfx.setDanger(false);
      state.shakeLevel = level;
    }
    // shake amount grows with time
    let amp = 0;
    if (level === 1) amp = 2 + ((age - C.shakeStart) / (C.shakeHard - C.shakeStart)) * 5; // 2 -> 7 px
    if (level === 2) amp = 14;
    if (amp > 0) {
      const dx = (Math.random() * 2 - 1) * amp, dy = (Math.random() * 2 - 1) * amp;
      const rot = (Math.random() * 2 - 1) * amp * 0.05;
      screenEl.style.transform = `translate(${dx}px, ${dy}px) rotate(${rot}deg)`;
    } else {
      screenEl.style.transform = '';
    }
    $('dangerTint').style.opacity = level === 0 ? 0 : level === 1 ? 0.35 : 0.9;
  }

  function jumpscare(cs) {
    state.running = false;
    state.over = true;
    state.processing = false;
    cancelDrawing();
    $('processing').classList.add('hidden');
    screenEl.style.transform = '';
    $('dangerTint').style.opacity = 0;

    const room = rooms[cs.index];
    const a = cs.active.anomaly;
    const res = U.getLoaded(room.cam.id, cs.active.num);
    const img = $('jumpImg');
    if (res) img.src = res.src;
    else img.src = view.toDataURL(); // fallback: whatever is on screen
    // zoom onto the creature's upper body / face (a bit above the circle centre)
    const z = Math.min(7, Math.max(3, 0.32 / a.r));
    const fx = a.x, fy = Math.max(0.08, a.y - a.r * (W / H) * 0.55);
    img.style.setProperty('--ox', `${fx * 100}%`);
    img.style.setProperty('--oy', `${fy * 100}%`);
    img.style.setProperty('--tx', `${(0.5 - fx) * 100}%`);
    img.style.setProperty('--ty', `${(0.5 - fy) * 100}%`);
    document.body.classList.add('scared');
    img.style.setProperty('--z', z);
    $('jumpscare').classList.remove('hidden');
    const flash = $('flash');
    flash.classList.remove('go'); void flash.offsetWidth; flash.classList.add('go');
    sfx.jumpscare();

    setTimeout(() => {
      $('jumpscare').classList.add('hidden');
      document.body.classList.remove('scared');
      showEnd(false, room);
    }, 1700);
  }

  // ---------- Rendering ----------
  function renderView() {
    const now = performance.now();
    if (now < state.staticUntil) { noise(1); return; }
    const room = rooms[state.cur];
    const cs = state.cams[state.cur];
    if (!cs) return;
    const entry = cs.active || cs.base;
    const res = U.getLoaded(room.cam.id, entry.num);
    if (res) vctx.drawImage(res.img, 0, 0, W, H);
    else U.drawPlaceholder(vctx, W, H, room.index, room.cam, entry);
    noise(state.processing ? 0.22 : 0.05 + state.shakeLevel * 0.05);
    // occasional rolling glitch line (more often when in danger)
    if (Math.random() < 0.03 + state.shakeLevel * 0.08) {
      vctx.fillStyle = 'rgba(255,255,255,0.07)';
      vctx.fillRect(0, Math.random() * H, W, 4 + Math.random() * 10);
    }
  }

  // ---------- Circle drawing ----------
  let stroke = null; // array of {x,y} in canvas px
  const toCanvas = (ev) => {
    const r = draw.getBoundingClientRect();
    return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
  };
  function redrawStroke(color = '#ff2a2a') {
    dctx.clearRect(0, 0, W, H);
    if (!stroke || stroke.length < 2) return;
    dctx.strokeStyle = color; dctx.lineWidth = 5; dctx.lineCap = 'round'; dctx.lineJoin = 'round';
    dctx.shadowColor = color; dctx.shadowBlur = 10;
    dctx.beginPath();
    dctx.moveTo(stroke[0].x, stroke[0].y);
    for (const p of stroke) dctx.lineTo(p.x, p.y);
    dctx.stroke();
    dctx.shadowBlur = 0;
  }
  function cancelDrawing() { stroke = null; dctx.clearRect(0, 0, W, H); }

  draw.addEventListener('pointerdown', (ev) => {
    if (!state.running || state.paused || state.processing) return;
    if (state.t < state.lockUntil) {
      toast(`ถูกล็อกการรายงาน อีก ${Math.ceil(state.lockUntil - state.t)} วินาที`, 'bad', 900);
      return;
    }
    draw.setPointerCapture(ev.pointerId);
    stroke = [toCanvas(ev)];
  });
  draw.addEventListener('pointermove', (ev) => {
    if (!stroke) return;
    stroke.push(toCanvas(ev));
    redrawStroke();
  });
  draw.addEventListener('pointerup', () => { if (stroke) finishStroke(); });
  draw.addEventListener('pointercancel', cancelDrawing);

  // Thai text for the lasso check results (lib/lasso.js reason codes)
  const LASSO_TH = {
    short: 'วาดเป็นวงให้ครบ',
    open: 'วาดวงให้ปิด — ปลายเส้นต้องบรรจบกัน',
    too_big: 'วงใหญ่เกินไป — วงให้แม่นกว่านี้',
    scribble: 'ห้ามขีดมั่ว — วาดเป็นวงกลม',
    too_small: 'วงเล็กเกินไป',
  };

  function finishStroke() {
    const pts = stroke;
    const res = Lasso.analyze(pts, W, H);
    if (!res.ok) { toast(LASSO_TH[res.reason] || res.message, 'info', 1200); return cancelDrawing(); }
    stroke = null;
    submitReport(res, state.cur);
  }

  function submitReport(circ, camIdx) {
    // Judge immediately so a correct report stops the 10-second timer right away
    const cs = state.cams[camIdx];
    const a = cs.active && !cs.reported && cs.active.anomaly;
    let hit = false;
    if (a) {
      const ax = a.x * W, ay = a.y * H, ar = a.r * W;
      hit = Math.hypot(ax - circ.cx, ay - circ.cy) <= Math.max(circ.r, ar); // one centre inside the other circle
    }
    if (hit) cs.reported = true;

    state.processing = true;
    $('processing').classList.remove('hidden');
    sfx.reportStart();
    setTimeout(() => {
      if (!state.running) return;
      state.processing = false;
      sfx.reportEnd();
      $('processing').classList.add('hidden');
      dctx.clearRect(0, 0, W, H);
      if (hit) {
        cs.active = null;
        cs.reported = false;
        state.stats.found++;
        if (state.cur === camIdx) state.staticUntil = performance.now() + 300;
        sfx.confirm();
        sfx.alienDied();
        toast('ยืนยันสิ่งผิดปกติ — กำจัดแล้ว', 'good');
      } else {
        state.stats.wrong++;
        state.lockUntil = state.t + C.wrongReportLockout;
        sfx.wrong();
        toast(`ไม่พบสิ่งผิดปกติ — ล็อก ${C.wrongReportLockout} วินาที`, 'bad');
      }
    }, C.reportProcessTime * 1000);
  }

  // ---------- Loop ----------
  let last = 0;
  function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (state.running && !state.paused) {
      state.t += dt;
      if (state.t >= state.nextSpawn && !state.processing) trySpawn();
      updateDanger();
      if (state.running && state.t >= totalTime()) showEnd(true);
      if (state.running) updateClockUI();
    }
    if (!state.paused && !state.over) renderView();
    requestAnimationFrame(frame);
  }

  // ---------- Full screen ----------
  function enterFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
  }
  document.addEventListener('fullscreenchange', () => {
    // leaving full screen during a shift pauses the game
    if (!document.fullscreenElement && state.running && !state.paused) togglePause();
  });

  // ---------- Start / end ----------
  function startGame() {
    enterFullscreen();
    state = newState();
    state.running = true;
    cancelDrawing();
    ['overlayStart', 'overlayEnd', 'processing', 'jumpscare', 'pauseNote'].forEach((id) => $(id).classList.add('hidden'));
    screenEl.style.transform = '';
    $('dangerTint').style.opacity = 0;
    updateCamUI();
    updateClockUI();
    sfx.shiftStart();
    toast('เริ่มเวร — เปิดดูทุกกล้องแล้วจำภาพไว้', 'info', 3000);
  }

  function showEnd(won, room) {
    state.running = false;
    state.over = true;
    cancelDrawing();
    screenEl.style.transform = '';
    $('dangerTint').style.opacity = 0;
    const s = state.stats;
    const t = $('endTitle');
    t.textContent = won ? 'รอดแล้ว' : 'มันมาถึงตัวคุณแล้ว';
    t.classList.toggle('lose', !won);
    $('endText').textContent = won
      ? 'คุณเฝ้าจนถึง 06:00 … ฟ้าเริ่มสว่างแล้ว'
      : `คุณปล่อยสิ่งผิดปกติที่ ${room.cam.label} ${room.cam.name} ไว้นานเกินไป`;
    const { h, m } = clockParts();
    $('endStats').innerHTML = `
      เวลาที่รอดได้: <b>${U.pad(h)}:${U.pad(m)}</b><br>
      สิ่งผิดปกติที่ปรากฏ: <b>${s.spawned}</b><br>
      รายงานถูก: <b>${s.found}</b><br>
      รายงานผิด: <b>${s.wrong}</b>`;
    sfx.end(won);
    $('overlayEnd').classList.remove('hidden');
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    $('pauseNote').classList.toggle('hidden', !state.paused);
    if (state.paused) { cancelDrawing(); screenEl.style.transform = ''; }
    sfx.setPaused(state.paused);
  }

  function toggleMute() {
    $('btnMute').classList.toggle('muted', sfx.toggleMute());
  }

  // ---------- Input ----------
  // Browsers only allow audio after the first click / key press
  const unlockAudio = () => { if (!state.running) sfx.unlock(); };
  window.addEventListener('pointerdown', unlockAudio, { once: true });
  window.addEventListener('keydown', unlockAudio, { once: true });

  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'm' || e.key === 'M') toggleMute();
    else if (/^[0-9]$/.test(e.key)) switchCam(e.key === '0' ? 9 : Number(e.key) - 1);
    else if (e.key === 'ArrowRight' || e.key === 'd') switchCam(state.cur + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'a') switchCam(state.cur - 1);
    else if (e.key === 'Escape') cancelDrawing();
    else if (e.key === 'p' || e.key === 'P') { togglePause(); if (!state.paused) enterFullscreen(); }
  });
  window.addEventListener('blur', () => { if (state.running && !state.paused) togglePause(); });
  const tap = (fn) => (e) => { e.currentTarget.blur(); fn(); };
  $('arrowL').onclick = tap(() => switchCam(state.cur - 1));
  $('arrowR').onclick = tap(() => switchCam(state.cur + 1));
  $('btnMute').onclick = tap(toggleMute);
  $('pauseNote').onclick = () => { if (state.paused) { togglePause(); enterFullscreen(); } };
  $('btnStart').onclick = startGame;
  $('btnRestart').onclick = startGame;

  // ---------- Boot ----------
  const btnStart = $('btnStart');
  btnStart.disabled = true;
  const loads = rooms.flatMap((r) => r.entries.map((e) => U.loadImage(r.cam.id, e.num)));
  Promise.all(loads).then(() => {
    prepareRooms();
    state = newState();
    updateCamUI();
    updateClockUI();
    btnStart.disabled = false;
    btnStart.textContent = 'เริ่มเวร';
    requestAnimationFrame((t) => { last = t; frame(t); });
  });
})();

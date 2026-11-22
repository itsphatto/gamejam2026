(() => {
  'use strict';
  const C = window.GAME_CONFIG;
  const CAMS = window.CAMERAS;
  const U = window.CCTV;
  const W = 1280, H = 720;
  const $ = (id) => document.getElementById(id);

  const view = $('view'), vctx = view.getContext('2d');
  const draw = $('draw'), dctx = draw.getContext('2d');

  // ---------- Room data ----------
  const rooms = CAMS.map((cam, index) => ({ cam, index, entries: U.getEntries(cam.id, window.ANOMALY_DATA) }));
  const demo = !rooms.some((r) => r.entries.some((e) => e.anomaly));
  if (demo) {
    // No anomalies marked yet: images 11-20 become placeholder anomalies at seeded positions
    rooms.forEach((r) => {
      const rand = U.rng(r.index * 131 + 3);
      r.entries = r.entries.map((e, i) => i < r.entries.length / 2 ? e : {
        num: e.num,
        anomaly: { x: 0.12 + rand() * 0.76, y: 0.3 + rand() * 0.45, r: 0.035 + rand() * 0.035 },
      });
    });
    $('demoBadge').classList.remove('hidden');
  }
  rooms.forEach((r) => {
    r.normals = r.entries.filter((e) => !e.anomaly);
    r.anoms = r.entries.filter((e) => e.anomaly);
    if (!r.normals.length) r.normals = [{ num: r.entries[0].num, anomaly: null }];
  });

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

  // ---------- Audio (WebAudio, no files needed) ----------
  let actx = null;
  const ac = () => (actx ||= new (window.AudioContext || window.webkitAudioContext)());
  function beep(freq, dur, type = 'square', vol = 0.04, delay = 0) {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = freq;
    const t = a.currentTime + delay;
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination);
    o.start(t); o.stop(t + dur);
  }
  function staticSound(dur = 0.12, vol = 0.05) {
    const a = ac(), len = a.sampleRate * dur, buf = a.createBuffer(1, len, a.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    const s = a.createBufferSource(), g = a.createGain();
    g.gain.value = vol; s.buffer = buf; s.connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    switch: () => { staticSound(0.1, 0.04); beep(1200, 0.03, 'square', 0.02); },
    good: () => { beep(660, 0.12, 'sine', 0.08); beep(990, 0.18, 'sine', 0.08, 0.12); },
    bad: () => { beep(160, 0.35, 'sawtooth', 0.06); },
    alarm: () => { [0, 0.25, 0.5].forEach((d) => beep(880, 0.18, 'square', 0.05, d)); },
    send: () => beep(1500, 0.05, 'square', 0.03),
  };

  // ---------- State ----------
  let state;
  function newState() {
    return {
      running: false, paused: false, over: false,
      t: 0, cur: 0,
      staticUntil: 0,       // performance.now() ms
      processing: false,
      lockUntil: 0,         // game seconds
      nextSpawn: C.firstAnomalyDelay,
      cams: rooms.map((r) => ({
        index: r.index,
        base: r.normals[(Math.random() * r.normals.length) | 0],
        active: null,
        used: new Set(),
      })),
      stats: { spawned: 0, found: 0, wrong: 0 },
    };
  }
  const totalTime = () => (C.endHour - C.startHour) * C.secondsPerHour;
  const activeCount = () => state.cams.filter((c) => c.active).length;

  // ---------- UI: camera buttons ----------
  const camGrid = $('camGrid');
  const camBtns = CAMS.map((cam, i) => {
    const b = document.createElement('button');
    b.className = 'cam-btn';
    b.innerHTML = `<span class="num">${cam.label}</span><span>${cam.name}</span>`;
    b.onclick = () => switchCam(i);
    camGrid.appendChild(b);
    return b;
  });

  function switchCam(i) {
    if (!state.running || state.paused || state.processing) return;
    i = (i + CAMS.length) % CAMS.length;
    if (i === state.cur) return;
    cancelDrawing();
    state.cur = i;
    state.staticUntil = performance.now() + 180;
    sfx.switch();
    updateCamUI();
  }

  function updateCamUI() {
    camBtns.forEach((b, i) => b.classList.toggle('active', i === state.cur));
    const cam = CAMS[state.cur];
    $('osdCam').textContent = cam.label;
    $('osdName').textContent = cam.name;
  }

  let toastTimer = 0;
  function toast(text, kind = 'info', ms = 1800) {
    const el = $('toast');
    el.textContent = text; el.className = kind;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
  }
  const setStatus = (t) => { $('status').textContent = t; };

  // ---------- Clock ----------
  function clockParts() {
    const gameSec = (state.t / C.secondsPerHour) * 3600 + C.startHour * 3600;
    const h24 = Math.floor(gameSec / 3600) % 24;
    const m = Math.floor(gameSec / 60) % 60;
    const s = Math.floor(gameSec) % 60;
    const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
    return { h12, m, s, ampm: h24 < 12 ? 'AM' : 'PM' };
  }
  const today = new Date();
  const dateStr = `${U.pad(today.getMonth() + 1)}/${U.pad(today.getDate())}/${today.getFullYear()}`;
  function updateClockUI() {
    const { h12, m, s, ampm } = clockParts();
    $('clock').textContent = `${h12}:${U.pad(m)} ${ampm}`;
    $('osdTime').textContent = `${dateStr}  ${U.pad(h12)}:${U.pad(m)}:${U.pad(s)} ${ampm}`;
    $('shiftfill').style.width = `${Math.min(100, (state.t / totalTime()) * 100)}%`;
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
    state.stats.spawned++;
    scheduleNext();

    const n = activeCount();
    if (n >= C.maxActiveAnomalies) return endGame(false);
    if (n === C.maxActiveAnomalies - 1) sfx.alarm();
    $('warning').classList.toggle('hidden', n < C.maxActiveAnomalies - 1);
  }

  // ---------- Rendering ----------
  function renderView() {
    const now = performance.now();
    if (now < state.staticUntil) { noise(1); return; }
    const room = rooms[state.cur];
    const cs = state.cams[state.cur];
    const entry = cs.active || cs.base;
    const res = U.getLoaded(room.cam.id, entry.num);
    if (res) vctx.drawImage(res.img, 0, 0, W, H);
    else U.drawPlaceholder(vctx, W, H, room.index, room.cam, entry);
    noise(state.processing ? 0.22 : 0.05);
    // occasional rolling glitch line
    if (Math.random() < 0.03) {
      vctx.fillStyle = 'rgba(255,255,255,0.06)';
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
      toast(`REPORTING LOCKED ${Math.ceil(state.lockUntil - state.t)}s`, 'bad', 900);
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

  function fitCircle(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const r = pts.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / pts.length;
    return { cx, cy, r };
  }

  function finishStroke() {
    const pts = stroke;
    if (pts.length < 8) return cancelDrawing();
    const circ = fitCircle(pts);
    if (circ.r < C.minCircleRadius * H) { toast('CIRCLE TOO SMALL', 'info', 900); return cancelDrawing(); }
    if (circ.r > C.maxCircleRadius * H) { toast('CIRCLE TOO BIG — BE PRECISE', 'info', 1200); return cancelDrawing(); }
    stroke = null;
    submitReport(circ, state.cur);
  }

  function submitReport(circ, camIdx) {
    state.processing = true;
    $('processing').classList.remove('hidden');
    sfx.send();
    setStatus(`Sending report for ${CAMS[camIdx].label}...`);
    setTimeout(() => {
      if (!state.running) return;
      state.processing = false;
      $('processing').classList.add('hidden');
      dctx.clearRect(0, 0, W, H);
      const cs = state.cams[camIdx];
      const a = cs.active && cs.active.anomaly;
      let hit = false;
      if (a) {
        const ax = a.x * W, ay = a.y * H, ar = a.r * W;
        const d = Math.hypot(ax - circ.cx, ay - circ.cy);
        hit = d <= Math.max(circ.r, ar); // one centre inside the other circle
      }
      if (hit) {
        cs.active = null;
        state.stats.found++;
        state.staticUntil = performance.now() + 300;
        sfx.good();
        toast('ANOMALY CONFIRMED — REMOVED', 'good');
        setStatus(`${CAMS[camIdx].label}: anomaly removed.`);
        $('warning').classList.toggle('hidden', activeCount() < C.maxActiveAnomalies - 1);
      } else {
        state.stats.wrong++;
        state.lockUntil = state.t + C.wrongReportLockout;
        sfx.bad();
        toast('NO ANOMALY FOUND', 'bad');
        setStatus(`False report. Locked for ${C.wrongReportLockout}s.`);
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
      if (state.running && state.t >= totalTime()) endGame(true);
      updateClockUI();
    }
    if (!state.paused) renderView();
    requestAnimationFrame(frame);
  }

  // ---------- Start / end ----------
  function startGame() {
    state = newState();
    state.running = true;
    cancelDrawing();
    ['overlayStart', 'overlayEnd', 'processing'].forEach((id) => $(id).classList.add('hidden'));
    $('warning').classList.add('hidden');
    setStatus('Monitoring... memorise each room.');
    updateCamUI();
    updateClockUI();
    ac().resume?.();
    sfx.switch();
  }

  function endGame(won) {
    state.running = false;
    state.over = true;
    cancelDrawing();
    const s = state.stats;
    const t = $('endTitle');
    t.textContent = won ? 'SHIFT COMPLETE' : 'SIGNAL LOST';
    t.classList.toggle('lose', !won);
    $('endText').textContent = won ? 'You survived until 6 AM.' : `Too many anomalies went unreported (${C.maxActiveAnomalies}).`;
    const { h12, m, ampm } = clockParts();
    $('endStats').innerHTML = `
      Time reached: <b>${h12}:${U.pad(m)} ${ampm}</b><br>
      Anomalies appeared: <b>${s.spawned}</b><br>
      Correct reports: <b>${s.found}</b><br>
      False reports: <b>${s.wrong}</b><br>
      Left unreported: <b>${activeCount()}</b>`;
    if (won) sfx.good(); else sfx.alarm();
    setTimeout(() => $('overlayEnd').classList.remove('hidden'), won ? 300 : 900);
  }

  function togglePause() {
    if (!state.running) return;
    state.paused = !state.paused;
    $('pauseNote').classList.toggle('hidden', !state.paused);
  }

  // ---------- Input ----------
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (/^[0-9]$/.test(e.key)) switchCam(e.key === '0' ? 9 : Number(e.key) - 1);
    else if (e.key === 'ArrowRight' || e.key === 'd') switchCam(state.cur + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'a') switchCam(state.cur - 1);
    else if (e.key === 'Escape') cancelDrawing();
    else if (e.key === 'p' || e.key === 'P') togglePause();
  });
  window.addEventListener('blur', () => { if (state.running && !state.paused) togglePause(); });
  $('btnStart').onclick = startGame;
  $('btnRestart').onclick = startGame;

  // ---------- Boot ----------
  state = newState();
  updateCamUI();
  updateClockUI();
  rooms.forEach((r) => r.entries.forEach((e) => U.loadImage(r.cam.id, e.num)));
  requestAnimationFrame((t) => { last = t; frame(t); });
})();

// Camera overview: a wall of 10 old TVs, one per cam. Click one (or press Tab / C to open) to jump to it.
// Self-contained: switches cams by sending the same 1–0 key presses game.js already handles.
(() => {
  'use strict';
  const CAMS = window.CAMERAS;
  const $ = (id) => document.getElementById(id);

  const panel = $('camOverview');
  const grid = $('camGrid');
  const btn = $('btnOverview');

  // TV wall layout: grid-area (row / col / row-end / col-end on a 4x12 grid), casing colour,
  // and where the controls sit ('side' knobs, 'bottom' speaker, or none)
  const TVS = [
    { area: '1 / 1 / 2 / 4',   body: 'silver', ctrl: 'side' },
    { area: '1 / 4 / 2 / 7',   body: 'yellow', ctrl: 'bottom' },
    { area: '1 / 7 / 2 / 10',  body: 'red',    ctrl: 'bottom' },
    { area: '1 / 10 / 2 / 13', body: 'white',  ctrl: 'side' },
    { area: '2 / 1 / 4 / 5',   body: 'black',  ctrl: 'side' },
    { area: '2 / 5 / 4 / 9',   body: 'black',  ctrl: 'deck' },
    { area: '2 / 9 / 4 / 13',  body: 'wood',   ctrl: 'side' },
    { area: '4 / 1 / 5 / 4',   body: 'cream',  ctrl: 'bottom' },
    { area: '4 / 4 / 5 / 9',   body: 'wood',   ctrl: 'side' },
    { area: '4 / 9 / 5 / 13',  body: 'orange', ctrl: 'none' },
  ];
  const CTRL = {
    side: '<div class="tv-ctrl"><i class="knob"></i><i class="knob"></i><div class="grille"></div></div>',
    bottom: '<div class="tv-ctrl"><div class="grille"></div><i class="knob"></i></div>',
    deck: '<div class="tv-ctrl"><div class="deck"></div><i class="knob"></i><i class="knob"></i></div>',
    none: '',
  };

  // One small noise texture shared by every screen (animated in CSS)
  const nc = document.createElement('canvas');
  nc.width = 160; nc.height = 90;
  const nx = nc.getContext('2d'), nd = nx.createImageData(160, 90);
  for (let i = 0; i < nd.data.length; i += 4) {
    const v = Math.random() * 255;
    nd.data[i] = nd.data[i + 1] = nd.data[i + 2] = v; nd.data[i + 3] = 255;
  }
  nx.putImageData(nd, 0, 0);
  panel.style.setProperty('--noise', `url(${nc.toDataURL()})`);

  const U = window.CCTV;

  const tiles = CAMS.map((cam, i) => {
    const tv = TVS[i % TVS.length];
    const t = document.createElement('button');
    t.className = `tv tv-${tv.body} ctrl-${tv.ctrl}`;
    t.style.gridArea = tv.area;
    t.innerHTML =
      `<div class="tv-screen">` +
        `<img class="tv-pic" alt="" />` +
        `<span class="tile-key">${i === 9 ? 0 : i + 1}</span>` +
        `<span class="tile-label">${cam.label}</span>` +
        `<span class="tile-name">${cam.name}</span>` +
      `</div>` + CTRL[tv.ctrl];
    t.onclick = (e) => { e.stopPropagation(); goTo(i); };
    grid.appendChild(t);
    return t;
  });
  const pics = tiles.map((t) => t.querySelector('.tv-pic'));

  // ---------- Live data ----------
  // game.js exposes window.CCTV_LIVE() -> { cur, cams: [{ num, active }] }.
  // Without it we fall back to each room's first image and no spawn alerts.
  const live = () => (typeof window.CCTV_LIVE === 'function' ? window.CCTV_LIVE() : null);
  const currentCam = () => {
    const L = live();
    if (L) return L.cur;
    return [...document.querySelectorAll('#camDots .cam-dot')].findIndex((d) => d.classList.contains('on'));
  };

  function setPic(i, num) {
    const res = U.getLoaded(CAMS[i].id, num);
    const src = res ? res.src : '';
    if (pics[i].dataset.src !== src) {
      pics[i].dataset.src = src;
      if (src) pics[i].src = src; else pics[i].removeAttribute('src');
    }
  }

  // Flash a TV when an anomaly appears on its cam
  const wasActive = CAMS.map(() => false);
  function alertTv(i) {
    const t = tiles[i];
    t.classList.remove('alert'); void t.offsetWidth; t.classList.add('alert');
  }

  function refresh() {
    const L = live();
    const cur = currentCam();
    tiles.forEach((t, i) => t.classList.toggle('on', i === cur));
    CAMS.forEach((cam, i) => {
      const c = L && L.cams[i];
      setPic(i, c ? c.num : '01');
      const act = !!(c && c.active);
      if (act && !wasActive[i]) alertTv(i);
      if (!act) tiles[i].classList.remove('alert');
      wasActive[i] = act;
    });
  }
  setInterval(refresh, 200); // runs while closed too, so spawns are never missed

  const isOpen = () => !panel.classList.contains('hidden');
  function open() { refresh(); panel.classList.remove('hidden'); }
  function close() { if (isOpen()) panel.classList.add('hidden'); }
  function toggle() { isOpen() ? close() : open(); }

  function goTo(i) {
    const key = i === 9 ? '0' : String(i + 1);
    window.dispatchEvent(new KeyboardEvent('keydown', { key }));
    close();
  }

  btn.onclick = (e) => { e.currentTarget.blur(); toggle(); };
  panel.onclick = close; // click the dark background to close

  window.addEventListener('keydown', (e) => {
    if (!e.isTrusted || e.repeat) return;
    if (e.key === 'Tab' || e.key === 'c' || e.key === 'C') { e.preventDefault(); toggle(); }
    else if (e.key === 'Escape' && isOpen()) close();
    else if (isOpen() && (/^[0-9]$/.test(e.key) || e.key.startsWith('Arrow'))) close();
  });

  // Close if the game pauses or a jumpscare starts. Watch only those two
  // elements (not our own panel) so closing can't re-trigger the observer.
  const shouldClose = () => document.body.classList.contains('scared') || !$('pauseNote').classList.contains('hidden');
  const mo = new MutationObserver(() => { if (shouldClose()) close(); });
  mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  mo.observe($('pauseNote'), { attributes: true, attributeFilter: ['class'] });
})();

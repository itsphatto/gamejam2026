// Shared helpers for game + editor
window.CCTV = (() => {
  const C = window.GAME_CONFIG;
  const pad = (n) => String(n).padStart(2, '0');
  const cache = new Map();   // key -> Promise<{img, src} | null>
  const loaded = new Map();  // key -> {img, src} | null  (only once settled)

  const key = (camId, num) => `${camId}/${num}`;

  function tryLoad(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function loadImage(camId, num) {
    const k = key(camId, num);
    if (cache.has(k)) return cache.get(k);
    const p = (async () => {
      for (const ext of C.exts) {
        const src = `assets/${camId}/${num}.${ext}`;
        const img = await tryLoad(src);
        if (img) return { img, src };
      }
      return null;
    })().then((res) => { loaded.set(k, res); return res; });
    cache.set(k, p);
    return p;
  }

  // Returns {img, src} if loaded, null if missing, undefined if still loading
  const getLoaded = (camId, num) => loaded.get(key(camId, num));

  function defaultEntries() {
    return Array.from({ length: C.imagesPerCam }, (_, i) => ({ num: pad(i + 1), anomaly: null }));
  }

  function getEntries(camId, data) {
    const list = data && data[camId];
    if (Array.isArray(list) && list.length) {
      return list.map((e) => ({ num: String(e.num), anomaly: e.anomaly || null }));
    }
    return defaultEntries();
  }

  // Seeded RNG so placeholder scenes are stable
  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Test anomaly: dark figure with red eyes, drawn on top of any image
  function drawAlien(ctx, W, H, a) {
    const ax = a.x * W, ay = a.y * H, ar = a.r * W;
    ctx.fillStyle = 'rgba(5,5,5,0.92)';
    ctx.beginPath(); ctx.ellipse(ax, ay + ar * 0.55, ar * 0.55, ar * 0.75, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ax, ay - ar * 0.35, ar * 0.35, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#ff2020';
    ctx.shadowColor = '#ff0000'; ctx.shadowBlur = 12;
    ctx.beginPath(); ctx.arc(ax - ar * 0.12, ay - ar * 0.38, ar * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(ax + ar * 0.12, ay - ar * 0.38, ar * 0.05, 0, Math.PI * 2); ctx.fill();
    ctx.shadowBlur = 0;
  }

  // Placeholder scene for when an image file is missing
  function drawPlaceholder(ctx, W, H, camIndex, cam, entry) {
    const r = rng(camIndex * 999 + 7);
    const hue = (camIndex * 37) % 360;
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, `hsl(${hue}, 12%, 22%)`);
    g.addColorStop(1, `hsl(${hue}, 10%, 9%)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // floor
    ctx.fillStyle = `hsl(${hue}, 8%, 12%)`;
    ctx.fillRect(0, H * 0.68, W, H * 0.32);
    // furniture blocks
    for (let i = 0; i < 6; i++) {
      const w = 80 + r() * 220, h = 60 + r() * 220;
      const x = r() * (W - w), y = H * 0.68 - h + r() * 40;
      ctx.fillStyle = `hsl(${hue}, 8%, ${14 + r() * 14}%)`;
      ctx.fillRect(x, y, w, h);
    }
    if (entry.anomaly) drawAlien(ctx, W, H, entry.anomaly);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.font = '18px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`placeholder — add assets/${cam.id}/${entry.num}.jpg`, W / 2, H - 70);
    ctx.textAlign = 'left';
  }

  return { pad, key, loadImage, getLoaded, getEntries, defaultEntries, rng, drawPlaceholder, drawAlien };
})();

// Lasso analysis: models the player's stroke as a closed curve and measures
// the area it encloses with Green's theorem. Reports are declined when the
// curve is not closed or when it encloses too much of the screen.
//
//   Green's theorem:  ∬_D (∂Q/∂x − ∂P/∂y) dA = ∮_C (P dx + Q dy)
//   Pick P = −y/2, Q = x/2  →  ∂Q/∂x − ∂P/∂y = 1, so
//   Area(D) = ½ ∮_C (x dy − y dx)
//
// The curve C is the stroke points joined by straight segments. On a straight
// segment (x0,y0)→(x1,y1) the line integral is exactly ½(x0·y1 − x1·y0), so the
// sum over segments is the exact enclosed area (the "shoelace" formula).
// Centroid uses the same theorem:  Cx = (1/2A)∮x² dy,  Cy = −(1/2A)∮y² dx.
//
// Closed-curve rule: the stroke counts as closed only if
//   (a) it crosses itself (player overshot the start), the loop is trimmed at
//       the crossing point, or
//   (b) the end lands near the start: gap ≤ maxGapFraction·length AND
//       gap ≤ maxGapScreen·H.
// Otherwise the report is declined with 'CLOSE THE LOOP'.
//
// Usage (game.js finishStroke):
//   const res = Lasso.analyze(stroke, W, H);
//   if (!res.ok) { toast(res.message, 'info', 1200); return cancelDrawing(); }
//   submitReport(res, state.cur);   // res has cx, cy, r like the old fitCircle
(function (root) {
  const DEFAULTS = {
    maxAreaFraction: 0.20,  // decline loops enclosing more than 20% of the screen
    minAreaFraction: 0.004, // decline tiny loops (accidental clicks)
    maxGapFraction: 0.12,   // start→end gap ≤ 12% of stroke length...
    maxGapScreen: 0.08,     // ...and ≤ 8% of screen height
    minCompactness: 0.15,   // 4πA/P²: 1 = circle, ~0 = zigzag scribble
    resampleStep: 4,        // px between resampled points
  };
  const opt = (k) => {
    const C = root.GAME_CONFIG;
    return C && C.lasso && C.lasso[k] != null ? C.lasso[k] : DEFAULTS[k];
  };

  // 1. Model the curve: resample at a fixed arc-length step to drop jitter.
  function resample(pts, step) {
    if (pts.length < 2) return pts.slice();
    const out = [{ x: pts[0].x, y: pts[0].y }];
    let carry = 0;
    for (let i = 1; i < pts.length; i++) {
      let sx = pts[i - 1].x, sy = pts[i - 1].y;
      const ex = pts[i].x, ey = pts[i].y;
      let seg = Math.hypot(ex - sx, ey - sy);
      while (seg > 0 && carry + seg >= step) {
        const t = (step - carry) / seg;
        sx += (ex - sx) * t; sy += (ey - sy) * t;
        out.push({ x: sx, y: sy });
        seg = Math.hypot(ex - sx, ey - sy);
        carry = 0;
      }
      carry += seg;
    }
    const last = pts[pts.length - 1], tail = out[out.length - 1];
    if (tail.x !== last.x || tail.y !== last.y) out.push({ x: last.x, y: last.y });
    return out;
  }

  function pathLength(pts) {
    let L = 0;
    for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    return L;
  }

  // Intersection point of segments p1p2 and p3p4, or null.
  function segHit(p1, p2, p3, p4) {
    const d = (p2.x - p1.x) * (p4.y - p3.y) - (p2.y - p1.y) * (p4.x - p3.x);
    if (Math.abs(d) < 1e-12) return null;
    const t = ((p3.x - p1.x) * (p4.y - p3.y) - (p3.y - p1.y) * (p4.x - p3.x)) / d;
    const u = ((p3.x - p1.x) * (p2.y - p1.y) - (p3.y - p1.y) * (p2.x - p1.x)) / d;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p1.x + t * (p2.x - p1.x), y: p1.y + t * (p2.y - p1.y) };
  }

  // Outermost self-crossing: earliest segment i crossed by the latest segment j.
  // Returns the trimmed closed loop, or null if the stroke never crosses itself.
  function trimToLoop(pts) {
    const n = pts.length;
    for (let i = 0; i < n - 3; i++) {
      for (let j = n - 2; j > i + 1; j--) {
        const X = segHit(pts[i], pts[i + 1], pts[j], pts[j + 1]);
        if (X) return [X, ...pts.slice(i + 1, j + 1)];
      }
    }
    return null;
  }

  // 2. Green's theorem over the closed polyline (last point joins the first).
  function greens(pts) {
    let a2 = 0, cx6 = 0, cy6 = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n];
      const cross = p.x * q.y - q.x * p.y; // 2 × ∫(x dy − y dx)/2 on this segment
      a2 += cross;
      cx6 += (p.x + q.x) * cross;
      cy6 += (p.y + q.y) * cross;
    }
    const area = a2 / 2;
    if (Math.abs(area) < 1e-9) return { area: 0, cx: pts[0].x, cy: pts[0].y };
    return { area, cx: cx6 / (6 * area), cy: cy6 / (6 * area) };
  }

  // Even-odd point-in-polygon test (for a stricter hit check if wanted).
  function contains(poly, x, y) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
  }

  function analyze(rawPts, W, H) {
    const fail = (reason, message, extra = {}) => ({ ok: false, reason, message, ...extra });
    if (!rawPts || rawPts.length < 8) return fail('short', 'DRAW A LOOP');

    const pts = resample(rawPts, opt('resampleStep'));
    const L = pathLength(pts);
    if (L <= 0) return fail('short', 'DRAW A LOOP');

    // 3. Closed-curve check — open curves are declined.
    let loop = trimToLoop(pts);
    if (!loop) {
      const gap = Math.hypot(pts[pts.length - 1].x - pts[0].x, pts[pts.length - 1].y - pts[0].y);
      if (gap > opt('maxGapFraction') * L || gap > opt('maxGapScreen') * H) {
        return fail('open', 'CLOSE THE LOOP', { gap });
      }
      loop = pts;
    }

    // 4. Area via Green's theorem.
    const g = greens(loop);
    const area = Math.abs(g.area);
    const frac = area / (W * H);
    const per = pathLength(loop) + Math.hypot(loop[loop.length - 1].x - loop[0].x, loop[loop.length - 1].y - loop[0].y);
    const compactness = (4 * Math.PI * area) / (per * per);
    const stats = { area, areaFraction: frac, compactness };

    if (frac > opt('maxAreaFraction')) return fail('too_big', 'AREA TOO BIG — BE PRECISE', stats);
    if (compactness < opt('minCompactness')) return fail('scribble', 'NO SCRIBBLING — DRAW A LOOP', stats);
    if (frac < opt('minAreaFraction')) return fail('too_small', 'CIRCLE TOO SMALL', stats);

    return { ok: true, cx: g.cx, cy: g.cy, r: Math.sqrt(area / Math.PI), poly: loop, ...stats };
  }

  const api = { analyze, greens, resample, trimToLoop, contains, DEFAULTS };
  root.Lasso = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

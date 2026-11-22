// Music + sound effects (real CC0 audio files, see assets/audio/CREDITS.md).
// Uses <audio> elements so it also works when index.html is opened directly from disk.
window.GameAudio = (() => {
  const BASE = 'assets/audio/';

  // ---------- Music / ambience loops ----------
  const loops = {};
  const target = {}; // desired volume per loop (before mute)
  function loop(name, file) {
    const a = new Audio(BASE + file);
    a.loop = true; a.preload = 'auto'; a.volume = 0;
    loops[name] = a; target[name] = 0;
  }
  loop('title', 'music_title.mp3');
  loop('main', 'music_main.mp3');
  loop('danger', 'music_danger.mp3');
  loop('room', 'ambience_room.mp3');
  loop('static', 'sfx_static_loop.mp3');

  // ---------- One-shot effects ----------
  const SFX = {
    switch: ['sfx_static_switch.mp3', 0.45],
    confirm: ['sfx_confirm.mp3', 0.6],
    wrong: ['sfx_wrong.mp3', 0.9],
    warning: ['sfx_warning.mp3', 0.55],
    gameover: ['sfx_gameover.mp3', 0.9],
    win: ['sfx_win.mp3', 0.8],
    jumpscare: ['sfx_superjumpscare.mp3', 1.0],
    alienDied: ['sfx_alien_died.mp3', 0.8],
    creepy1: ['sfx_creepy1.mp3', 0.35],
    creepy2: ['sfx_creepy2.mp3', 0.35],
    creepy3: ['sfx_creepy3.mp3', 0.45],
    creepy4: ['sfx_creepy4.mp3', 0.45],
    creepy5: ['sfx_creepy5.mp3', 0.4],
  };
  const sfxEls = {};
  for (const [k, [file]] of Object.entries(SFX)) {
    const a = new Audio(BASE + file);
    a.preload = 'auto';
    sfxEls[k] = a;
  }

  let muted = false;
  let unlocked = false;
  let paused = false;
  const live = new Set(); // one-shots currently playing

  function play(name) {
    if (muted) return;
    const a = sfxEls[name].cloneNode();
    a.volume = SFX[name][1];
    live.add(a);
    a.onended = () => live.delete(a);
    a.play().catch(() => live.delete(a));
    return a;
  }

  let scareEl = null; // the jumpscare one-shot, so nothing plays over it

  // Smooth volume fades for loops
  const fades = {};
  function fade(name, vol, ms = 1200) {
    target[name] = vol;
    const a = loops[name];
    const goal = muted ? 0 : vol;
    if (goal > 0 && a.paused && !paused) a.play().catch(() => {});
    cancelAnimationFrame(fades[name]);
    const from = a.volume, t0 = performance.now();
    const step = (now) => {
      const k = Math.min(1, (now - t0) / Math.max(1, ms));
      a.volume = Math.max(0, Math.min(1, from + (goal - from) * k));
      if (k < 1) fades[name] = requestAnimationFrame(step);
      else if (goal === 0) a.pause();
    };
    fades[name] = requestAnimationFrame(step);
  }

  // ---------- Random creepy noises during the shift ----------
  let creepyTimer = 0;
  function scheduleCreepy() {
    clearTimeout(creepyTimer);
    creepyTimer = setTimeout(() => {
      if (!paused) play(`creepy${1 + Math.floor(Math.random() * 5)}`);
      scheduleCreepy();
    }, 30000 + Math.random() * 50000);
  }

  return {
    // Browsers block audio until the first click/key press
    unlock() {
      if (unlocked) return;
      unlocked = true;
      this.title();
    },
    title() {
      fade('title', 0.5, 2000);
      ['main', 'danger', 'room', 'static'].forEach((n) => fade(n, 0, 600));
    },
    shiftStart() {
      unlocked = true;
      paused = false;
      fade('title', 0, 800);
      Object.values(loops).forEach((a) => { if (a !== loops.title) a.currentTime = 0; });
      fade('main', 0.5, 2500);
      fade('room', 0.3, 2500);
      fade('danger', 0, 100);
      fade('static', 0, 100);
      scheduleCreepy();
    },
    setDanger(on) {
      fade('danger', on ? 0.55 : 0, 2000);
      fade('main', on ? 0.25 : 0.5, 2000);
    },
    reportStart() { fade('static', 0.35, 150); },
    reportEnd() { fade('static', 0, 200); },
    switchCam() { play('switch'); },
    confirm() { play('confirm'); },
    alienDied() { play('alienDied'); },
    wrong() { play('wrong'); },
    warning() { play('warning'); },
    jumpscare() {
      clearTimeout(creepyTimer);
      Object.keys(loops).forEach((n) => fade(n, 0, 60));
      live.forEach((a) => a.pause());
      live.clear();
      scareEl = play('jumpscare');
    },
    end(won) {
      clearTimeout(creepyTimer);
      ['main', 'danger', 'room', 'static'].forEach((n) => fade(n, 0, won ? 2500 : 300));
      const sting = () => {
        play(won ? 'win' : 'gameover');
        setTimeout(() => this.title(), won ? 6000 : 9000);
      };
      // wait for the jumpscare to finish so the game-over sting doesn't overlap it
      const a = scareEl;
      scareEl = null;
      if (!won && a && !a.ended && !a.paused) a.addEventListener('ended', sting, { once: true });
      else sting();
    },
    setPaused(p) {
      paused = p;
      for (const [n, a] of Object.entries(loops)) {
        if (p) a.pause();
        else if (target[n] > 0 && !muted) a.play().catch(() => {});
      }
      live.forEach((a) => (p ? a.pause() : a.play().catch(() => {})));
    },
    toggleMute() {
      muted = !muted;
      for (const n of Object.keys(loops)) fade(n, target[n], 200);
      if (muted) live.forEach((a) => a.pause());
      return muted;
    },
    get muted() { return muted; },
  };
})();

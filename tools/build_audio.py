"""Builds every game sound in assets/audio/ from the team's raw recordings
(HomeMadeSoundeffect/) plus pure code synthesis. Re-run any time:

    py tools/build_audio.py            # all
    py tools/build_audio.py music_main # just one (name without .mp3)

Needs: numpy, ffmpeg on PATH.
"""
import subprocess, sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / 'HomeMadeSoundeffect'
OUT = ROOT / 'assets' / 'audio'
SR = 44100
rng = np.random.default_rng(2026)


# ---------------------------------------------------------------- io
def load(name, af=None):
    """Decode a recording to mono float32 at SR. `af` = optional ffmpeg filter chain."""
    cmd = ['ffmpeg', '-v', 'error', '-i', str(RAW / name), '-vn', '-ac', '1', '-ar', str(SR)]
    if af:
        cmd += ['-af', af]
    cmd += ['-f', 'f32le', '-']
    return np.frombuffer(subprocess.run(cmd, check=True, capture_output=True).stdout, np.float32).astype(np.float64)


def save(name, x, peak_db=-1.0):
    """Normalise to peak_db and write assets/audio/<name>.mp3 (x: mono (n,) or stereo (n,2))."""
    x = np.asarray(x, np.float64)
    x = x - (x.mean(axis=0) if x.ndim == 1 else x.mean(axis=0, keepdims=True))  # remove DC
    x *= 10 ** (peak_db / 20) / max(1e-9, np.abs(x).max())
    ch = 1 if x.ndim == 1 else 2
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', str(ch), '-i', '-',
                    '-c:a', 'libmp3lame', '-q:a', '2', str(OUT / f'{name}.mp3')],
                   input=x.astype(np.float32).tobytes(), check=True)
    print(f'  {name}.mp3  {len(x) / SR:5.2f}s  {"stereo" if ch == 2 else "mono"}')


# ---------------------------------------------------------------- dsp helpers
def secs(s): return int(round(s * SR))
def t_axis(dur): return np.arange(secs(dur)) / SR
def silence(dur): return np.zeros(secs(dur))


def place(dst, src, at):
    """Mix src into dst starting at `at` seconds (dst grows if needed)."""
    i = secs(at)
    end = i + len(src)
    if end > len(dst):
        dst = np.concatenate([dst, np.zeros((end - len(dst),) + dst.shape[1:])])
    dst[i:end] += src
    return dst


def fades(x, fin=0.005, fout=0.05):
    x = x.copy()
    a, b = secs(fin), secs(fout)
    if a: x[:a] *= np.linspace(0, 1, a)
    if b: x[-b:] *= np.linspace(1, 0, b)
    return x


def band(x, lo=0, hi=None, soft=0.15):
    """FFT band-pass (lo/hi in Hz, either may be 0/None) with smooth edges."""
    n = len(x)
    f = np.fft.rfftfreq(n, 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= 1 / (1 + (lo / np.maximum(f, 1e-3)) ** (2 / soft * 0.15 * 4))
    if hi:
        g *= 1 / (1 + (f / hi) ** (2 / soft * 0.15 * 4))
    return np.fft.irfft(np.fft.rfft(x) * g, n)


def conv(x, ir):
    n = len(x) + len(ir) - 1
    m = 1 << (n - 1).bit_length()
    return np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[:n]


def reverb(x, size=2.0, mix=0.35, bright=6000, pre=0.02):
    """Convolution reverb with a synthetic exponentially decaying noise tail. Output is longer by `size`."""
    t = t_axis(size)
    ir = rng.standard_normal(len(t)) * np.exp(-6.9 * t / size)  # -60 dB at `size`
    ir = band(ir, 120, bright)
    ir = np.concatenate([np.zeros(secs(pre)), ir])
    ir /= np.sqrt((ir ** 2).sum())
    wet = conv(x, ir)
    dry = np.concatenate([x, np.zeros(len(wet) - len(x))])
    return dry * (1 - mix) + wet * mix * 1.5


def echo(x, delay=0.35, fb=0.45, n=6):
    out = np.concatenate([x, np.zeros(secs(delay * n))])
    for k in range(1, n + 1):
        out[secs(delay * k):secs(delay * k) + len(x)] += x * fb ** k
    return out


def pitch(x, semis):
    """Tape-style pitch shift (also changes length)."""
    r = 2 ** (semis / 12)
    idx = np.arange(0, len(x) - 1, r)
    return np.interp(idx, np.arange(len(x)), x)


def stretch(x, factor, grain=0.08):
    """Granular time-stretch keeping pitch (overlap-add, Hann grains). factor>1 = longer."""
    g = secs(grain); hop_out = g // 4; hop_in = hop_out / factor
    win = np.hanning(g)
    n_out = int(len(x) * factor)
    out = np.zeros(n_out + g); norm = np.zeros(n_out + g)
    pos_out = 0; pos_in = 0.0
    while pos_out < n_out and int(pos_in) + g < len(x):
        j = int(pos_in) + rng.integers(0, max(1, hop_out // 2))  # tiny jitter avoids phasey buzz
        j = min(j, len(x) - g)
        out[pos_out:pos_out + g] += x[j:j + g] * win
        norm[pos_out:pos_out + g] += win
        pos_out += hop_out; pos_in += hop_in
    return out[:n_out] / np.maximum(norm[:n_out], 1e-3)


def loudest(x, dur):
    """Start index of the loudest `dur`-second window."""
    w = secs(dur)
    e = np.convolve(x ** 2, np.ones(w), 'valid')
    return int(e.argmax())


def onset(x, frac=0.25):
    return int(np.argmax(np.abs(x) > frac * np.abs(x).max()))


def gate(x, thresh_db=-40, win=0.03):
    """Soft noise gate relative to peak."""
    w = secs(win)
    env = np.sqrt(np.convolve(x ** 2, np.ones(w) / w, 'same'))
    th = np.abs(x).max() * 10 ** (thresh_db / 20)
    g = np.clip((env - th * 0.5) / (th * 0.5), 0, 1)
    g = np.convolve(g, np.ones(w) / w, 'same')
    return x * g


def norm(x): return x / max(1e-9, np.abs(x).max())


def sine(freq, dur, phase=0.0):
    """freq may be a number or an array (sweep) of length secs(dur)."""
    n = secs(dur)
    f = np.full(n, freq, float) if np.isscalar(freq) else np.asarray(freq, float)
    return np.sin(2 * np.pi * np.cumsum(f) / SR + phase)


def cyc(f, loop):
    """Round a frequency to whole cycles per loop so sustained tones loop without a click."""
    return round(f * loop) / loop


def noise(dur): return rng.standard_normal(secs(dur))


def pink(dur):
    n = secs(dur)
    s = np.fft.rfft(rng.standard_normal(n))
    f = np.fft.rfftfreq(n, 1 / SR); f[0] = 1
    return norm(np.fft.irfft(s / np.sqrt(f), n))


def env_ad(dur, attack=0.005, decay=None):
    t = t_axis(dur)
    e = np.minimum(1, t / max(attack, 1e-4))
    return e * np.exp(-t / (decay or dur / 4))


def loopify(x, loop_len):
    """Fold anything past loop_len (reverb tails) back onto the start: seamless loop."""
    n = secs(loop_len)
    out = x[:n].copy()
    tail = x[n:]
    while len(tail):
        k = min(n, len(tail)); out[:k] += tail[:k]; tail = tail[k:]
    return out


def xfade_loop(x, xf=0.15):
    """Crossfade the end into the start so a recording loops cleanly."""
    k = secs(xf)
    out = x[:-k].copy()
    ramp = np.linspace(0, 1, k)
    out[:k] = out[:k] * ramp + x[-k:] * (1 - ramp)
    return out


def bitcrush(x, bits=6, hold=4):
    q = 2 ** (bits - 1)
    y = np.round(norm(x) * q) / q
    return np.repeat(y[::hold], hold)[:len(x)]


def drive(x, amount=4.0): return np.tanh(norm(x) * amount)


def pan(x, lr):
    """lr: -1..1 scalar or per-sample array. Returns (n,2) equal-power."""
    a = (np.asarray(lr) + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def impact(dur=0.6, f0=90, f1=32, body=1.0, crack=0.6):
    """Synth 'slammed book / tray' hit: pitch-dropping sine boom + filtered noise crack."""
    t = t_axis(dur)
    boom = sine(f1 + (f0 - f1) * np.exp(-t / 0.08), dur) * np.exp(-t / (dur / 3))
    hit = band(noise(dur), 200, 5000) * np.exp(-t / 0.04)
    return boom * body + hit * crack


# ================================================================ SFX from recordings
def sfx_static_switch():
    x = load('static_switch.mkv')
    x = band(x, 1000)
    i = loudest(x, 0.35)
    x = fades(x[i:i + secs(0.35)], 0.004, 0.08)
    # "pen tap" click, pitched down
    click = sine(np.linspace(1400, 500, secs(0.03)), 0.03) * env_ad(0.03, 0.0005, 0.006)
    x = place(x, click * 0.9 * np.abs(x).max(), 0.0)
    save('sfx_static_switch', x)


def sfx_static_loop():
    # code-generated noise: two bands whose balance drifts slowly (period = loop length -> seamless)
    dur = 3.0
    n = secs(dur)
    p = pink(dur + 0.3)
    lo = band(p, 300, 1800); hi = band(p, 2500, 9000); mid = band(p, 900, 4000)
    t = np.arange(len(p)) / SR
    lfo = 0.5 + 0.5 * np.sin(2 * np.pi * t / dur)
    x = norm(lo) * lfo + norm(hi) * (1 - lfo) * 0.8 + norm(mid) * 0.6
    x = xfade_loop(x[:n + secs(0.15)], 0.15)
    save('sfx_static_loop', x, -3)


def sfx_confirm():
    x = load('sfx_confirm.m4a', 'afftdn=nf=-30')
    semis = 7
    seg = x[max(0, onset(x) - secs(0.003)):][:secs(0.4 * 2 ** (semis / 12))]
    seg = pitch(seg, semis)[:secs(0.4)]
    seg = fades(seg, 0.002, 0.15)
    seg = seg * np.exp(-t_axis(len(seg) / SR) / 0.18)
    y = reverb(seg, 0.5, 0.25, bright=12000, pre=0.008)
    y = band(y, 300)
    save('sfx_confirm', fades(y, 0, 0.1))


def sfx_wrong():
    x = load('sfx_wrong.m4a')
    x = gate(x, -45)
    x = x[max(0, onset(x, 0.05) - secs(0.01)):]
    x = pitch(x, -6)
    x = drive(band(x, 60, 5000), 5)
    x = fades(x, 0.005, 0.3)
    y = reverb(x, 1.6, 0.4, bright=3500)
    drop_dur = 4.0
    t = t_axis(drop_dur)
    drop = sine(110 * (45 / 110) ** (t / drop_dur), drop_dur) * np.minimum(1, t / 0.05) * np.exp(-t / 1.5)
    y = place(norm(y), drop * 0.55, 0.0)
    save('sfx_wrong', fades(y[:secs(4.0)], 0, 0.6))


def sfx_warning():
    x = load('sfx_warning.mkv', 'afftdn=nf=-30')
    x = band(x, 120, 9000)
    x = pitch(x, 5)                         # breath up
    x = stretch(x, 7.0 / (len(x) / SR))     # ... stretched to ~7 s
    x = echo(x, 0.31, 0.4, 5)
    x = reverb(x, 3.0, 0.55, bright=7000)
    x = x[:secs(7.6)]
    t = np.arange(len(x)) / SR
    swell = np.clip(t / 7.0, 0, 1) ** 1.6 * 0.88 + 0.12   # slowly rising over 7 s
    save('sfx_warning', fades(x * swell, 0.3, 0.6))


def sfx_creepy1():
    x = load('creepy1.mov')
    x = band(pitch(x, -2), 40, 6000)
    y = reverb(x, 2.5, 0.35, bright=4000)
    # barely audible reversed whisper/breath halfway (taken from the breathing take)
    w = load('creepy4.mov', 'afftdn=nf=-30')
    w = band(w, 1500, 9000)
    w = fades(w[loudest(w, 1.8):][:secs(1.8)], 0.2, 0.4)[::-1]
    w = reverb(w, 1.5, 0.5)
    y = place(norm(y), norm(w) * 0.12, len(y) / SR / 2 - 1.0)
    save('sfx_creepy1', fades(y, 0.5, 2.0))


def sfx_creepy2():
    x = load('creepy2.mov', 'afftdn=nf=-35')
    x = gate(band(x, 80, 5500), -38)
    x = pitch(x, -7)                        # slowed + lower
    # long quiet gaps: split into 3 chunks around the loudest bits, spread them out
    n = len(x); parts = []
    for k in range(3):
        c = x[k * n // 3:(k + 1) * n // 3]
        i = loudest(c, min(2.5, len(c) / SR * 0.8))
        parts.append(fades(c[i:i + secs(2.5)], 0.3, 0.8))
    y = silence(0.1)
    at = 0.1
    for p in parts:
        y = place(y, p, at); at += len(p) / SR + 2.2
    y = echo(y, 0.42, 0.45, 5)
    y = reverb(y, 3.0, 0.4)
    save('sfx_creepy2', fades(y, 0.05, 2.0))


def sfx_creepy3():
    x = load('creepy3.mov', 'afftdn=nf=-30')
    x = band(x, 60, 9000)[::-1]
    y = reverb(x, 2.2, 0.4)
    t = np.arange(len(y)) / SR
    y = y * np.clip(1 - (t - (len(y) / SR - 5.0)) / 5.0, 0, 1)  # fade out across the last 5 s
    save('sfx_creepy3', fades(y, 0.05, 0.05))


def sfx_creepy4():
    x = load('creepy4.mov', 'afftdn=nf=-30')
    x = gate(x, -42)
    x = pitch(band(x, 160, 1100), -3)       # muffled, lower (cut mic rumble)
    y = reverb(x, 1.4, 0.3, bright=2500)
    t = np.arange(len(y)) / SR
    lr = np.sin(np.pi * (t / t[-1] - 0.5)) * 0.85  # slowly left -> right
    save('sfx_creepy4', pan(fades(y, 0.2, 1.0), lr))


def sfx_creepy5():
    x = load('creepy5.mov')
    x = gate(x, -45)
    x = pitch(band(x, 80, 9000), -5)
    dur = len(x) / SR + 1.0
    t = t_axis(dur)
    rumble = (sine(41, dur) + 0.6 * sine(55.3, dur) + 0.3 * band(noise(dur), 20, 120) * 3) \
        * (0.6 + 0.4 * np.sin(2 * np.pi * 0.35 * t))
    rumble = fades(rumble, 1.0, 1.5)
    y = place(norm(x), norm(rumble) * 0.45, 0.0)
    y = reverb(y, 2.4, 0.45, bright=4000)
    save('sfx_creepy5', fades(y, 0.05, 1.5))


def sfx_alien_died():
    x = load('AlienDied.mov')
    x = x[max(0, onset(x, 0.1) - secs(0.01)):]
    x = pitch(x, -4)[:secs(1.35)]
    t = np.arange(len(x)) / SR
    ring = x * np.sin(2 * np.pi * 70 * t)                 # ring modulation
    x = 0.55 * norm(x) + 0.45 * norm(ring)
    x = 0.6 * x + 0.4 * bitcrush(x, 6, 5)                  # bit-crush
    x = fades(x, 0.003, 0.25)
    thud = band(impact(0.4, 120, 45, body=1.0, crack=0.25), 0, 900)  # "pillow hit"
    y = place(norm(x), norm(thud) * 0.9, 1.3)
    y = reverb(y, 0.6, 0.15)[:secs(1.75)]
    save('sfx_alien_died', fades(y, 0, 0.08))


def scream_layers(big):
    v = load('SuperJumpScare.mov')
    v = v[max(0, onset(v, 0.1) - secs(0.005)):]
    if not big:
        return drive(band(pitch(v, -2), 80, 9000), 3)
    low = drive(band(pitch(v, -5), 60, 6000), 4)
    mid = drive(band(v, 120, 10000), 2.5)
    whisper = band(v, 2500, 12000)  # airy top layer
    n = max(len(low), len(mid))
    pad = lambda a: np.concatenate([a, np.zeros(n - len(a))])
    return pad(norm(low)) * 0.8 + pad(norm(mid)) * 0.6 + pad(norm(whisper)) * 0.35


def sfx_superjumpscare():
    lead = 0.1
    voice = scream_layers(True)
    y = silence(1.95)
    # 0.0-0.1 s: quiet rising tone + faint static, then everything hits
    rise = sine(np.linspace(180, 1600, secs(0.7)), 0.7) * np.linspace(0.08, 0.35, secs(0.7))
    y = place(y, rise, 0.0)
    y = place(y, band(noise(lead), 2000) * 0.05, 0.0)
    y = place(y, norm(voice)[:secs(1.7)] * 1.0, lead)
    y = place(y, norm(impact(1.0, 140, 28, body=1.3, crack=0.9)) * 1.0, lead)
    y = place(y, fades(band(noise(0.6), 600), 0, 0.4) * 0.35, lead)
    y = place(y, fades(sine(np.linspace(400, 2400, secs(0.5)), 0.5), 0, 0.2) * 0.15, lead)
    y = reverb(drive(y, 2.5), 1.0, 0.25)[:secs(1.95)]
    save('sfx_superjumpscare', fades(y, 0.001, 0.25))


def music_title():
    x = load('music_title.m4a', 'afftdn=nf=-25:tn=1')
    x = gate(band(x, 50, 8000), -36)
    x = norm(x)
    dur = len(x) / SR
    loop = dur + 4.0
    t = t_axis(loop)
    drone = (sine(cyc(55, loop), loop) + 0.7 * sine(cyc(55.4, loop), loop) + 0.4 * sine(cyc(82.4, loop), loop))         * (0.75 + 0.25 * np.sin(2 * np.pi * t / loop))
    y = place(silence(loop), x, 0.5)
    w = load('creepy4.mov', 'afftdn=nf=-30')
    w = band(w, 1500, 9000)
    w = fades(w[loudest(w, 2.0):][:secs(2.0)], 0.3, 0.5)[::-1]
    y = place(y, norm(w) * 0.08, loop * 0.6)
    y = loopify(reverb(y, 4.0, 0.45, bright=5000), loop)
    save('music_title', norm(y) + norm(drone)[:len(y)] * 0.18)


def ambience_room():
    x = load('AlienAmbient.mkv')
    x = band(x, 30, 900)
    x = np.concatenate([x, x[::-1]])          # forward + reversed = seamless loop
    dur = len(x) / SR
    t = np.arange(len(x)) / SR
    # low "hummed" drone with slow wobble (period = loop length)
    hum = sine(58, dur) + 0.5 * sine(116.5, dur) + 0.25 * sine(174, dur)
    hum *= 0.7 + 0.3 * np.sin(2 * np.pi * t / dur)
    y = norm(x) + band(hum, 0, 400) * 0.12
    save('ambience_room', y, -3)


# ================================================================ music from code only
def synth_note(freq, dur, kind='bass', cutoff=800):
    t = t_axis(dur)
    if kind == 'bass':      # detuned saw pluck, low-passed
        saw = lambda f: 2 * ((f * t) % 1) - 1
        s = saw(freq) + saw(freq * 1.006) + 0.5 * sine(freq / 2, dur)
        return band(s, 0, cutoff) * env_ad(dur, 0.006, dur / 3)
    if kind == 'bell':      # glassy bell: inharmonic partials
        s = sum(a * sine(freq * r, dur) * np.exp(-t / (dur * d))
                for r, a, d in [(1, 1, .5), (2.0, .4, .3), (2.76, .3, .2), (5.4, .12, .1)])
        return s * np.minimum(1, t / 0.003)
    if kind == 'tap':       # muted desk tap
        return band(noise(dur), 300, 2500) * env_ad(dur, 0.0008, 0.012) + sine(180, dur) * env_ad(dur, 0.001, 0.02) * 0.6
    if kind == 'tick':      # clock tick
        return band(noise(dur), 3000, 12000) * env_ad(dur, 0.0003, 0.004)
    raise ValueError(kind)


NOTE = lambda n: 440 * 2 ** ((n - 69) / 12)   # MIDI -> Hz


def music_main():
    bpm = 72; beat = 60 / bpm; bars = 8; loop = bars * 4 * beat
    y = silence(loop + 4)
    bass_line = [45, 45, 45, 45, 41, 41, 43, 40]                # A A A A F F G E (one per bar)
    melody = [69, 72, 71, 64]                                    # A C B E  (2-beat steps, repeating)
    for bar in range(bars):
        root = bass_line[bar]
        for b in range(4):
            at = (bar * 4 + b) * beat
            y = place(y, synth_note(NOTE(root - 12), beat * 0.9, 'bass', 420) * 0.55, at)        # pulse
            y = place(y, synth_note(0, 0.08, 'tap') * 0.35, at + beat / 2)                         # off-beat tap
        for k in range(2):
            n = melody[(bar * 2 + k) % len(melody)]
            y = place(y, synth_note(NOTE(n), beat * 2.6, 'bell') * 0.22, (bar * 4 + k * 2) * beat)
    y = norm(loopify(reverb(y, 3.0, 0.35, bright=5000), loop))
    n = len(y)
    amb = band(pink(n / SR), 60, 700)[:n] * 0.05              # subtle room ambience (FFT noise is circular)
    drone = (sine(cyc(NOTE(33), loop), n / SR) + sine(cyc(NOTE(33) * 1.004, loop), n / SR))[:n] * 0.06
    save('music_main', y + amb + drone, -2)


def music_danger():
    bpm = 104; beat = 60 / bpm; bars = 8; loop = bars * 4 * beat
    y = silence(loop + 4)
    bass_line = [45, 45, 46, 45, 45, 45, 46, 44]               # A A Bb A ... G#: tense half-steps
    melody = [69, 72, 71, 64]
    for bar in range(bars):
        root = bass_line[bar]
        # filter opens across the first half of the loop and closes again (seamless)
        open_k = 0.5 - 0.5 * np.cos(2 * np.pi * bar / bars)
        cutoff = 300 + 2200 * open_k
        for e in range(8):                                     # 8th-note pulse
            at = (bar * 4 + e / 2) * beat
            acc = 1.0 if e % 2 == 0 else 0.6
            y = place(y, synth_note(NOTE(root - 12), beat * 0.45, 'bass', cutoff) * 0.5 * acc, at)
        for b in range(4):                                     # ticking clock, tick / tock
            at = (bar * 4 + b) * beat
            y = place(y, synth_note(0, 0.05, 'tick') * (0.5 if b % 2 == 0 else 0.3), at)
            y = place(y, synth_note(0, 0.08, 'tap') * 0.3, at + beat / 2)
        for k in range(4):                                     # melody twice as often
            n = melody[(bar * 4 + k) % len(melody)]
            y = place(y, synth_note(NOTE(n), beat * 1.6, 'bell') * 0.18, (bar * 4 + k) * beat)
    y = norm(loopify(reverb(y, 2.2, 0.3, bright=6000), loop))
    n = len(y); dur = n / SR; t = np.arange(n) / SR
    # dissonant high note (Bb5 rubbing against A) with tremolo, swelling across the loop
    trem = cyc(6, loop)
    high = (sine(cyc(NOTE(82), loop), dur) + 0.5 * sine(cyc(NOTE(81), loop), dur))[:n] * (0.6 + 0.4 * np.sin(2 * np.pi * trem * t))
    high *= (0.5 - 0.5 * np.cos(2 * np.pi * t / loop)) * 0.05
    drone = band(sine(cyc(NOTE(33), loop), dur)[:n] + sine(cyc(NOTE(34) / 2, loop), dur)[:n] + 0.5 * pink(dur)[:n], 0, 200) * 0.22
    save('music_danger', y + high + drone, -2)  # louder bass drone underneath


def piano(freq, dur, vel=1.0):
    """Simple additive piano: slightly stretched partials, higher ones die faster, soft hammer thump."""
    t = t_axis(dur)
    base_decay = 2.2 * (220 / freq) ** 0.35          # low notes ring longer
    s = np.zeros(len(t))
    for k in range(1, 9):
        fk = freq * k * (1 + 0.0004 * k * k)         # piano string inharmonicity
        if fk > 12000: break
        s += (0.9 ** k / k ** 0.6) * sine(fk, dur) * np.exp(-t * k ** 0.7 / base_decay)
    s *= np.minimum(1, t / 0.004) * np.clip((dur - t) / min(1.5, dur / 3), 0, 1)  # attack + release (no hard cut)
    hammer = band(noise(dur), 80, 1500) * np.exp(-t / 0.015) * 0.15
    return (s + hammer) * vel


def hum_pad(freqs, dur, attack=1.5, release=2.5):
    """Warm 'hummed' pad: soft detuned saw chord, low-passed, with gentle vibrato."""
    t = t_axis(dur)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 4.8 * t)
    out = np.zeros(len(t))
    for f in freqs:
        for d in (0.997, 1.003):
            ph = np.cumsum(f * d * vib) / SR
            out += 2 * (ph % 1) - 1
    out = band(out, 60, 1400)
    env = np.minimum(1, t / attack) * np.clip((dur - t) / release, 0, 1)
    return out * env


def sfx_gameover():
    """Dark ending sting: reversed low note swells into a heavy low piano chord, deep drone, ~17 s decay."""
    total = 17.0
    y = silence(total)
    first = 1.2                                       # time of the first hit
    chord = [NOTE(33), NOTE(40), NOTE(45), NOTE(48)]  # A1 E2 A2 C3 (A minor, low)
    swell = sum(piano(f, first, 0.8) for f in chord)[::-1]          # reversed note into the hit
    swell *= np.linspace(0, 1, len(swell)) ** 2
    y = place(y, swell * 0.7, 0.0)
    y = place(y, sum(piano(f, 9.0, 1.0) for f in chord), first)
    y = place(y, piano(NOTE(44), 7.0, 0.55) + piano(NOTE(39), 7.0, 0.5), first + 2.6)   # G#2 + D#2: unresolved
    y = place(y, piano(NOTE(21), 8.0, 0.9), first + 5.4)                                  # A0 rumble
    y = place(y, piano(NOTE(57), 6.0, 0.25), first + 5.4)                                 # lone A3
    t = t_axis(total)
    drone = (sine(NOTE(21) * 2, total) + 0.8 * sine(NOTE(21) * 2 * 1.006, total) + 0.4 * band(pink(total), 25, 150) * 4)
    drone *= np.clip((t - first) / 1.0, 0, 1) * np.clip((total - t) / 8.0, 0, 1)
    y = reverb(y, 6.0, 0.5, bright=3500)[:secs(total)]
    y = norm(y) + norm(drone) * 0.22
    save('sfx_gameover', fades(y, 0.01, 4.0))


def sfx_win():
    """Gentle relief: soft major arpeggio over a warm hummed pad, then an upward chime. ~7.5 s."""
    total = 7.5
    y = silence(total)
    y = place(y, hum_pad([NOTE(48), NOTE(55), NOTE(64)], 7.0, 1.2, 3.0) * 0.12, 0.0)    # C3 G3 E4
    for i, n in enumerate([72, 76, 79, 84]):                                               # C5 E5 G5 C6
        y = place(y, piano(NOTE(n), 5.0, 0.55), 0.3 + i * 0.42)
    y = place(y, piano(NOTE(60), 6.0, 0.4) + piano(NOTE(67), 6.0, 0.3), 0.3)             # soft low support
    for i, n in enumerate([88, 91, 96]):                                                   # E6 G6 C7 upward chime
        y = place(y, synth_note(NOTE(n), 3.0, 'bell') * 0.16, 2.6 + i * 0.12)
    y = reverb(y, 4.0, 0.45, bright=8000)[:secs(total)]
    save('sfx_win', fades(y, 0.01, 2.0))


ALL = [sfx_static_switch, sfx_static_loop, sfx_confirm, sfx_wrong, sfx_warning,
       sfx_creepy1, sfx_creepy2, sfx_creepy3, sfx_creepy4, sfx_creepy5,
       sfx_alien_died, sfx_superjumpscare, music_title, ambience_room,
       music_main, music_danger, sfx_gameover, sfx_win]

if __name__ == '__main__':
    want = set(sys.argv[1:])
    for fn in ALL:
        if not want or fn.__name__ in want:
            fn()

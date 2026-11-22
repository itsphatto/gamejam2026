# Audio credits

Almost every sound is **team-made**: raw phone recordings in `HomeMadeSoundeffect/`, processed by
`tools/build_audio.py` (filters, pitch, reverb, layering, normalised to -1 dB peak, MP3).
Rebuild everything with `py tools/build_audio.py`.

| Game file | Source |
|---|---|
| sfx_static_switch.mp3 | Team recording `static_switch.mkv` (high-passed 0.35 s slice) + synth click |
| sfx_static_loop.mp3 | Code-generated noise (no recording) |
| sfx_confirm.mp3 | Team recording `sfx_confirm.m4a` |
| sfx_wrong.mp3 | Team recording `sfx_wrong.m4a` + synth sine drop |
| sfx_warning.mp3 | Team recording `sfx_warning.mkv` |
| sfx_creepy1–5.mp3 | Team recordings `creepy1–5.mov` (+ synth rumble on 5) |
| sfx_alien_died.mp3 | Team recording `AlienDied.mov` + synth thud |
| sfx_jumpscare.mp3, sfx_superjumpscare.mp3 | Team recording `SuperJumpScare.mov` + synth impact / static / rising tone |
| music_title.mp3 | Team recording `music_title.m4a` + synth drone |
| ambience_room.mp3 | Team recording `AlienAmbient.mkv` + synth hum |
| music_main.mp3, music_danger.mp3 | Fully code-synthesised (`music_main()` / `music_danger()` in the build script) |

Still third-party (**CC0**, OpenGameArt.org, no attribution required):

| Game file | Original | Author / page |
|---|---|---|
| sfx_gameover.mp3, sfx_win.mp3 | String and piano horror stings (piano_sting, abyss) | congusbongus — https://opengameart.org/content/string-and-piano-horror-stings |

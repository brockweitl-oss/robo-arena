# Credits

## Audio

Menu recording: **Neon Guillotine - Chrome Confession - Treblo**, supplied by the owner for
use in this game on November 6, 2026. The original M4A is included unchanged at
`public/music/neon-guillotine-chrome-confession.m4a`. Attribution follows the supplied filename;
no additional authorship or license metadata was supplied.

The remaining audio (sound effects, ambiences, announcer stingers, jingles and other music
tracks) is original and procedurally synthesized at runtime in the browser with the Web Audio API.
That means oscillators, FM, filtered noise, waveshaping and a procedurally generated
convolution-reverb impulse response. The music is composed in code and played by a built-in step
sequencer.

The audio engine lives in `src/audio/`. Recorded music shares the volume and ducking mixer.

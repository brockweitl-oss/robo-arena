# Recorded soundtrack — issue #75

Owner request: use the uploaded Neon Guillotine - Chrome Confession - Treblo track exactly,
then create **five additional songs: two menu songs and three combat songs**. Six tracks total.

## Implemented

- Exact original M4A copied without transcoding, 2,610,596 bytes, approximately 167.65 seconds.
- Menu loads/decodes once after audio initialization, loops the recording and uses the normal
  volume, mute, ducking and crossfade path. Leaving the menu during loading cannot revive it.
- Repeated menu requests preserve playback. Leaving stops/disconnects the source after the fade.
- Failed load/unsupported codec uses the existing procedural menu track; a later visit retries.
- Credits identify the owner-supplied recording, without inventing authorship/license metadata.

## Five companion songs — outstanding

No companion song has been generated. Runway was discovered as an available music-generation
provider and suggested to the owner; installation/account connection is not confirmed.
Do not count prompts, alternate mixes of the upload or the older procedural tracks as new songs.

Proposed production briefs, to refine against the supplied recording in the generator:

| Working title | Role | Direction |
|---|---|---|
| Afterhours Circuit | Menu 1 | Dark cyberpunk club-house, deep rolling bass, restrained hook, spacious arrangement |
| Black Glass | Menu 2 | Distinct nocturnal house groove, metallic percussion, filtered minor chords, slow tension/release |
| Voltage Pursuit | Combat 1 | Driving club rhythm, heavier bass, immediate energy, room for weapon transients |
| Reactor Pressure | Combat 2 | Industrial percussion, syncopated bass, short breakdown and forceful return |
| Terminal Velocity | Combat 3 | Peak-intensity cyberpunk club track, distinct hook and drum groove, sustained arena energy |

Each needs an original composition, exported audio, listening comparison, level/loop checks,
attribution metadata and integration. The upload remains the first menu song; the two new menu
songs should rotate alongside it. The three combat songs should rotate across matches.

## Verification

`tools/check-recorded-music.mjs` checks actual browser AAC decoding, late-load cancellation,
same-screen continuity, mute, looping and source stop. Full required repository checks apply.

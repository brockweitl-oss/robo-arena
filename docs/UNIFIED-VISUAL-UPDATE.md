# Unified visual and replay update

This continues the single game on main: Claude's skill shots plus the integrated PT3/PT4 combat, mouse-aimed bombs and primer combos. Combat remains deterministic and real-time. Save progress and ruleset 5 replay compatibility are retained.

## Player controls

- F11 toggles fullscreen. A visible fullscreen button is also available.
- During a replay, 1 selects Player 1 POV, 2 Player 2 POV, 3 broadcast, and 4 free camera. Buttons expose the same choices.
- Free camera: WASD to move, Q/E down/up, Shift faster, captured mouse or drag to look. Escape pauses.
- Skill shots retain Claude's controls: hold R/M4/gamepad Y, aim, release. Basic gun fire remains auto-aimed. Hold RMB to place a bomb landing point, release to throw.

## Visual changes

Four original shoulder-mounted skill emitters replace the shared placeholder appearance: long lance projector, wide wave emitter, harpoon launcher with cable spool, and a cryogenic spike pod. Each has its own muzzle and charging glow, plus a rendered garage thumbnail.

Pooled skill effects distinguish a spear, shimmering wave, barbed cable projectile and frost shard. Successful harpoon pulls show a short reel; frost status shows a temporary shell. Reflected shots retain their actual visual identity and cannot incorrectly display a pull. Ground lanes show the shot width and clip to cover, with red enemy cast warnings.

Replay cameras are presentation-only and do not feed the simulation. Both POVs pull in at cover, broadcast frames both fighters, and free fly collides with arena solids. Listeners and replay controls are removed on exit.

## Verification

- Actual match/replay while cycling all four camera modes: final health 631/707 in both runs. Free-camera translation measured 3.84 m.
- Fullscreen button and F11 entry/exit passed; replay controls cleaned up; no browser console errors or warnings in that check.
- Remaining combined-build, visual, performance and release results are appended after final validation.

This update does not claim hosted online PvP deployment or new modular stat sockets. Those require their separate system contracts/services; local play and the existing modes remain available.

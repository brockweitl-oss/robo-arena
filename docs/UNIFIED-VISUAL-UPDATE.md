# Unified visual and replay update

This continues the single game on main: Claude's skill shots plus the integrated PT3/PT4 combat, mouse-aimed bombs and primer combos. Combat remains deterministic and real-time. Save progress and ruleset 5 replay compatibility are retained.

## Player controls

- F11 toggles fullscreen. A visible fullscreen button is also available.
- During a replay, 1 selects Player 1 POV, 2 Player 2 POV, 3 broadcast, and 4 free camera. Buttons expose the same choices.
- Free camera: WASD to move, Q/E down/up, Shift faster, drag to look. The cursor remains available for the camera buttons. Escape pauses.
- Skill shots retain Claude's controls: hold R/M4/gamepad Y, aim, release. Basic gun fire remains auto-aimed. Hold RMB to place a bomb landing point, release to throw.

## Visual changes

Four original shoulder-mounted skill emitters replace the shared placeholder appearance: long lance projector, wide wave emitter, harpoon launcher with cable spool, and a cryogenic spike pod. Each has its own muzzle and charging glow, plus a rendered garage thumbnail.

Pooled skill effects distinguish a spear, shimmering wave, barbed cable projectile and frost shard. Successful harpoon pulls show a short reel; frost status shows a temporary shell. Reflected shots retain their actual visual identity and cannot incorrectly display a pull. Ground lanes show the shot width and clip to cover, with red enemy cast warnings.

Replay cameras are presentation-only and do not feed the simulation. Both POVs pull in at cover, broadcast frames both fighters, and free fly collides with arena solids. Listeners and replay controls are removed on exit.

## Verification

- Actual match/replay while cycling all four camera modes: final health 631/707 in both runs. Free-camera translation measured 3.84 m.
- Fullscreen button and F11 entry/exit passed; replay controls cleaned up; no browser console errors or warnings in that check.
- Final source: 151 unit tests, TypeScript and production build pass. Full browser smoke completes with 60 fps sampled and zero console problems.
- Extended real replay: 448/588 HP in both original and playback, all four views, buttons, drag rotation, pause/resume, cleanup and F11 verified with zero warnings/errors. This caught and fixed replay's inherited mouse capture; normal match capture is unchanged.
- Manually aimed skill recording and replay: 665/921 HP exactly, ruleset 5 retains the selected target, zero warnings/errors.
- 1920×1080 medium Garden, uncapped: mean 145.06 fps and 4.94 ms render-call CPU time. About 655 aggregate draw calls across all render passes; this is not a single-pass count. Hardware-specific measurement, not a mid-range-laptop guarantee.
- All four classes captured front/back/run/fire and in a match; 59–61 fps at 1600×1000 medium, no console warnings/errors. See `visuals/unified-update/manifest.json`.
- Claude's second bounded code and image review approved the fixes. A separate skill animation now anticipates and follows through without kicking the gun barrel. Dedicated matched-photo comparisons and the actual Claude session's PR review accompany #43.

This update does not claim hosted online PvP deployment or new modular stat sockets. Those require their separate system contracts/services; local play and the existing modes remain available.

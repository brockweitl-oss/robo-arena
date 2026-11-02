# Enclosed power-armor update

The prior suits read as thin robotic frames with attached plates. This pass gives all four original classes continuous armored torso, hip, arm and leg volumes with fitted panel overlays. The intent is wearable power armor, retaining each class's helmet, shoulder and equipment identity.

Thighs and calves now use closed compound lofts, with tapered cuffs and fuller boots. Rear thigh caps and edged calf service hatches break up smooth surfaces. Sprint and feather remain lighter than standard legs without becoming skeletal. Hopper retains its reverse-joint movement with fuller armor around the assembly.

Review fixes preserve at least 25 mm of inner-thigh clearance per side on heavy Anchor builds, expose the unchanged heel thruster by shortening its upper casing, sweep upper-arm armor clear of the chest, and recess the weapon-side forearm shell around the unchanged gun mount. Focused run/fire/back and beam fire/down/getup captures are in `clearance/`.

Rig joints, leg lengths, collision dimensions, weapon mounts and thruster anchors are unchanged. No combat rules changed. Static armor still merges per joint/material. Existing paint colors remain supported.

## Evidence

`docs/visuals/power-armor/before/` contains the previous reference-suit front images. `after/` contains actual runtime front, side, back, run and fire views for all four classes, plus a gameplay image. These are runtime screenshots, not generated concept images. Captures use 1600×1000 at medium quality; exact FPS and browser diagnostics are in `after/report.json`.

## Validation

- All 196 unit tests passed, including 21 leg geometry and mount tests.
- TypeScript and production build passed (119 modules).
- Final browser smoke passed: player actions and full 45-second match, 60 FPS, zero browser problems.
- Viewer/gameplay captures: 58–60.55 FPS at 1600×1000 medium; zero warnings or errors.
- Uncapped 1920×1080 medium Garden benchmark: 129.77 FPS across 1,429 frames, 5.44 ms average CPU render time, 662.93 aggregate render calls, zero browser problems. Geometry count changed from 371 to 424 during combat; this short run is not a leak test.
- The measured FPS target passes on this machine; aggregate draw calls remain above the original 150–250 target.

Short FPS samples are machine-specific. Aggregate draw calls include all render passes; viewer counters alone do not measure aggregate match cost.





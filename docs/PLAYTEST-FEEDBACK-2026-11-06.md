# Playtest feedback — November 6, 2026

Owner direction: calmer menus; punchier, more deliberate combat; distinct weapons;
an earned opening advantage; less knockdown immunity; unrestricted custom/private builds;
intense cyberpunk techno; better externally generated sounds and mech models.

## Accepted design

- Menu hover must not move other rows, change button size, or bounce the logo. Remove mode numbers.
- The owner chose **position + faster deployment** for the opening advantage, not a damage buff.
- One grounded follow-up hit may punish a knockdown. It must not relaunch, reset recovery,
  add down gauge, or permit an infinite combo. Keep protection during airborne knockdown and get-up.
- Slower weapon commitments must purchase a larger, readable payoff and retain distinct counterplay.
- Free Battle and private rooms allow every catalog part without changing campaign ownership.
- Music direction: driving cyberpunk/techno club arena, with room in the mix for attack telegraphs.
- Investigate ElevenLabs/free SFX generation and Tripo/free comparable 3D generation.
  The owner confirmed neither account is signed in.

## Implementation in this branch

- Fixed-height menu descriptions, stationary focus targets/logo, no numbered main-menu modes,
  short opacity transitions instead of slides/bounces.
- Recorded 66-tick deployment phase. Movement steers the capsule through normal collision checks;
  one Jump press in ticks 48–55 earns immediate deployment. A miss incurs 0.4 seconds of recovery.
  The timing meter accounts for online input delay. No attacks before GO and no damage bonus.
  AI, solo replays, local P2, rollback and spectator simulation use the same fighter state.
- Grounded knockdown opening begins after 0.12 seconds on the ground and accepts one hit.
  Fire/hazard ticks cannot spend it; shield absorption still applies. Harpoon/chill cannot extend it.
  Post-get-up invulnerability reduced from 1 second to 0.25 seconds.
- Pulse, Scatter, Rail, Beam and Homer have longer commitments and higher per-shot damage.
  Original roles remain pressure burst / close fan / precision punish / charged piercing shot /
  delayed curved pair. Real-time combat retained: no hit-stop or slow motion.
- Added Needle Volley: four separately aimed, narrow, non-homing darts from one committed trigger.
  Added Nova Cannon: large, slow, charged, interceptable plasma orb for controlling a lane.
  Both have dedicated original procedural models, muzzle/impact effects and projectile styles.
  New catalog entries are appended to preserve existing share-code indices.
- Dedicated Beam and Homer sound recipes, weapon-weighted camera recoil, and four new procedural
  industrial techno arena arrangements (140–150 BPM). These are original synthesized assets,
  **not ElevenLabs output**.
- Separate saved custom loadout and five custom presets. Free Battle, private create/join,
  private build changes, rematches and counter-picks use catalog access; campaign/ranked ownership
  remains separate. The custom garage supports every weapon, bomb, pod, skill, body and leg.
- Replay ruleset bumped from 8 to 9; old recordings are rejected rather than silently diverging.

## Verification

Final checks and review status are recorded below before handoff. Browser artifacts are in
`docs/visuals/playtest-feedback/`; reproducible checks are
`tools/check-playtest-feedback.mjs` and `tools/check-deployment-replay.mjs`.

- Independent Codex reviews used; no Claude review is claimed.
- Final TypeScript check, all 274 unit tests (24 files), production build and browser smoke pass.
- Browser presentation checks: stationary menu hit areas, custom-loadout persistence without campaign
  unlocks, zero console warnings/errors, 61 fps measured at 1920×1080 medium on this machine.
  The full-match smoke measured 60 fps. These are capped local observations, not a laptop benchmark.
- Local online E2E passed with Needle/Nova private builds, clean-link hashes, jitter/rollback,
  matching late-spectator HP, hidden-tab simulation and ranked settlement after winner disconnect.
- Offline rendering through the production audio bus produced finite, unclipped samples for all
  four arena tracks and the new Beam/Homer SFX. Musical taste still needs human listening approval.
- Boole approved launch/replay/custom-save/preview changes conditional on the final smoke, which passed.
  Arendt approved weapon, knockdown and audio code. These are independent Codex code reviews;
  neither reviewer independently repeated the complete browser/online/performance suite.
- Initial review found and corrected solo replay deployment input divergence and capsule visibility
  depending on subsequent attack recovery. A snapshotted deployment-complete flag now owns visibility.
- Actual Match browser replay reproduced digests at ticks 48, 56, 66, 67, 90, 300 and 600;
  original/replay final HP both 682 / 737.
- Deterministic balance sample: 144 scenarios per part plus 1,440 mixed-build fights.
  Gun field results: Pulse 44%, Scatter 53%, Rail 54%, Beam 56%, Homer 47%, Needle 51%, Nova 46%.
  Mixed fights averaged 35.5 seconds. Some build combinations remain outside that range;
  AI sampling is not proof of universal PvP balance or human tactical feel.

## External dependencies and follow-up

- No generated mech replacement or external SFX has been imported. ElevenLabs/Tripo account access
  and an export path remain outstanding. Do not describe the procedural work as generated by them.
- ElevenLabs free outputs require attribution; commercial permissions differ by plan:
  https://elevenlabs.io/sound-effects and https://elevenlabs.io/sound-effects/free.
  Tripo plan/export/ownership details must be checked for the actual account before importing:
  https://www.tripo3d.ai/product-doc/getting-started/pricing-credits.
- A generated mech still needs segmentation/retopology, attachment to the existing animation rig,
  material cleanup, silhouette review and the 1080p performance gate. A raw generation is not a
  finished replacement model.
- New guns are immediately available in custom/private builds. Campaign reward placement is not
  changed by this patch.
- Human acceptance remains required for opening timing, one-hit knockdown punishment, weapon
  punch/readability, round length and the new music. No public deployment is claimed here.

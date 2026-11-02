# Playtest 3 — tactical combat and rebuilt mech art

The owner finished Playtest 2 and authorized Codex to cover gameplay, systems and visuals while Claude is unavailable. This supersedes the earlier file-ownership split for this release. Independent Codex reviewers cover the cross-review requirement; no Claude approval is claimed.

## Player feedback preserved

Keep responsive, satisfying combat; the rival campaign; time to kill, armor durability and match length; telegraphs and the parry/deflect/dodge skill loop. Make decisions, positioning and timing beat repeated inputs.

- Remove knockdown slow motion and simulation freezes.
- Give movement and attacks deliberate commitment, recovery and counterplay; repeated dashes must cost something.
- Make every weapon/build choice change strategy. Reliable starter fire should provide modest pressure; precision guns should reward an earned opening.
- Rail misses should be understandable, with useful aiming/telegraph feedback. Investigate movement, aim and payoff together rather than simply buffing damage.
- Distinguish rivals through weapon roles and tactics, not just names/colors.
- Charge shield must face forward and block only incoming attacks within its actual coverage.
- Replace arbitrary-feeling arena damage/knockdowns with predictable timings, visible warnings and counterplay. No combat-outcome RNG.
- Rebuild mech silhouettes: shaped powered armor, layered plates and mechanical joints rather than stacked boxes. Original Vanguard, Strider, Paladin and Titan classes; no copied franchise designs.
- Primer/detonator team combos remain a later feature, as requested during feedback.

## Playtest 2 observations

Local telemetry filtered to production `pt2` sessions whose user agent was not HeadlessChrome: 19 match-end records, including 3 quits; 16 completed matches (11 wins, 5 losses). Completed fights averaged 52.9 seconds, ranging from 34.6 to 78.3 seconds. Pulse appeared in 12 completed matches (10 wins); rail in 4 (1 win).

These are one player's evolving session, different opponents and builds, not controlled evidence that one gun is objectively stronger. Existing hit totals mix sources, so they cannot establish rail accuracy. Playtest 3 adds gun-specific projectile/hit/damage/deflection counters and corrects parry and knockdown attribution.

## Release work

- Tactical combat: deterministic patterns, weapon identities, attack recovery, dash economy, directional defense, real-time simulation, role-specific AI and ruleset-versioned replays.
- Art: new compound armor geometry, slimmer joints, distinct class silhouettes, tuned finishes and damage visuals; unchanged rig/mount contracts and approximately two-meter chassis.
- Garage: live paint/finish/wear/flame/trail/decal editing, rendered part thumbnails, five saved builds, backwards-compatible expanded sharing.
- Photo studio: garage/results entry, orbit/pan/free camera, 14 poses, depth of field, exposure, UI hiding and PNG export; explicit GPU resource cleanup.
- Arenas: predictable vent/coil timing with exact-radius countdown rings; Rain Hangar, Proving Grounds and Sunken District have mirrored cover and two elevation levels.
- Readability: recovery/punish labels, dash commitment status and matching shield presentation.

## Release boundaries

Local versus is included. Hosted online matchmaking, rollback networking and ranked infrastructure are not implemented by this release; deployment/account access remains outstanding. Primer/detonator combos remain deferred. The garage uses the real existing five-slot loadout; separate head/core/arms/back stat sockets are not represented as completed.

The GitHub credential has repository access but no workflow scope, so hosted Actions/Pages CI setup cannot be claimed. Required local checks and a frozen local preview are the release gate. The old Playtest 2 build is preserved until the replacement is verified.

## Validation

Validation results and final build identity are recorded here after the final candidate is frozen. AI balance scenarios are deterministic coverage, not independent randomized trials or proof of universal PvP balance. Human Playtest 3 feedback remains necessary.

### Candidate validation (2026-11-02)

- TypeScript clean; 86 unit tests passed; production build passed.
- Real-browser replay reproduced exactly: original HP 624 / 441, replay HP 624 / 441, despite changed garage equipment and aim assist.
- All six arenas reached active combat with controls enabled, finite colliders, at most one shadow light and zero console errors/warnings. New-map ground/deck/ramp heights verified at 0 / 3 / 1.5 meters.
- Garden/orbital hazards warn at 6 seconds, activate at 8.5 seconds and have zero knockdown/launch values.
- Four classes captured from front/back and in run/fire poses at 1080p medium. Viewer samples approximately 60 fps (two individual samples unavailable). Twenty frame/leg combinations measured 1.849–1.967 meters tall after idle animation.
- Full controls/match smoke previously passed; final frozen-candidate rerun recorded below. Garage paint/save/share, all five gun thumbnails, photo from garage/results, focus traversal, PNG export and three open/close cleanup cycles independently browser verified.
- Independent combat review approved after correcting directional guard, projectile wall occlusion, interrupted charge cooldown, airborne commitments and exact-tick READY transition. Garage photo review fixes verified.

Performance caveat: another running game occupied most GPU time during these checks. Actual-combat samples were 21–49 fps; the unchanged PT2 comparison also fell to about 18 fps. These are contaminated measurements, not proof of the required 60 fps on a mid-range laptop. Full-pass renderer counts include shadow/post passes and exceed the nominal 150–250 draw-call budget; further profiling under an idle GPU remains outstanding.

Final balance refresh: 180 scenarios per part and 1,800 generated-build fights. Pulse damage 24→22 reduced its field result from 61% to 56%; scatter 46%, rail 48%, beam 54%, homer 46%. All part field results were 45–56%. Specific matchups still have large outliers (interceptor versus default 89%, turret 6%, scatter 17%); this does not meet a universal no-build-above-55% claim and needs human PvP feedback.

Final source checks after Pulse tuning: real-browser replay exactly 630/451 HP for both original and replay. Full controls smoke observed all seven action types and completed a 45-second match at 30 fps, zero console errors/warnings. Smoke now waits for actual action-ready/airborne states instead of fixed delays. Minor HUD readiness polish includes landing recovery and remaining air-dash allowance. Final frozen build verification follows.

Review stack: #23 mech art; #24 garage/photo; #25 tactical combat; #26 arenas/release. Kept draft for the outstanding uncontended performance acceptance, rather than publishing an unverified 60 fps claim to main.

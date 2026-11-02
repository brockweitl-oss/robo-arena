# Robo Arena 2.0 Roadmap

Goal: a deeper, cooler-looking, competitive robot battler that people come back to every
day. Build order, decided after play-test 1: **combat → parts/garage → arenas → endgame → online**.

Rule for every task: **all designs, names and assets are original.** Use real-world
references (power armor, flight exo-suits, angular "real robot" mecha, giant kaiju-fighter
mechs) for *genre and feel* only. Never copy a specific suit, logo, name or silhouette.

---

## 1. Art direction: from "cute" to "cool"

Current robots are chibi: big heads, big feet, toy proportions. 2.0 moves to **heroic hard-surface mechs**.

| Archetype (original) | Inspiration genre | Silhouette and proportions |
|---|---|---|
| **Vanguard** class | sleek powered armor | about 7.5 heads tall, narrow waist, layered overlapping plates, slim limbs, glowing chest core, face-plate visor that splits open |
| **Strider** class | flight exo-suit | jump-jet packs, fold-out wing fins, forearm thrusters, hovering stance, cloth/cable details |
| **Paladin** class | angular "real robot" | sharp V/blade crests, big shoulder blocks with vernier thrusters, backpack boosters, sensor eyes, panel lines everywhere |
| **Titan** class | giant kaiju-fighter | massive shoulders and forearms, hunched heavy stance, pistons, exposed hydraulics, reactor in chest, industrial wear and hazard paint |

Visual upgrades:

**Proportions and pose.** Smaller heads, longer legs, broad chests, tapered waists, wider stances, and a heavier idle that shifts weight.

**Surface detail.**
- More panel seams, inset vents, layered armor with real overlaps.
- Exposed mechanical joints: pistons, cable bundles.
- Panel-line normal maps tuned per part.
- Edge wear, decals (warning text, unit numbers, squad emblems).

**Materials.**
- Paint layers: base paint, clearcoat or matte, metal type (gunmetal, titanium, chrome, carbon).
- Emissive seams with animated pulse.
- Visor glass with reflections.

**Damage states.**
- Armor plates crack, spark and smoke below 50% / 25% HP.
- A visor flicker when the robot is knocked down.

**Post-processing.** Ambient occlusion (N8AO), contact shadows, light shafts in arenas, and better motion trails on dashes and melee.

**Animation.**
- Weight shifting in the idle.
- Thruster-assisted landings and hover jets, plus mechanical "settle" motion after big moves.
- Per-class run cycles: Titan stomps, Strider skims.

---

## 2. Fully customizable garage (the core of 2.0)

**Modular parts.** Replace "body = whole upper robot" with sockets:

| Slot | Examples | Affects |
|---|---|---|
| Head | sensor dome, split visor, crested helm, mono-eye | lock-on speed, look |
| Core (torso) | reactor chest, armored hull, slim frame | HP, weight, endurance (down threshold) |
| Arms | gauntlets, hydraulic fists, blade arms | charge attack type, recoil control |
| Back | twin boosters, wing fins, jump-jet pack, heavy reactor | **dash style**, air type and count, hover |
| Legs | Sprint, Spring, Glide, Anchor (resists knockback), Feather (slow fall), Tread | ground speed, jump, dash distance, landing recovery |
| Gun / Bomb / Pod | 4–6 each | weapons |

**Weight budget.** Each core has a capacity. Heavier builds are tankier but slower and have
longer landing recovery. This is what makes builds a trade-off.

**Dash styles** (set by the back part, scaled by legs):
- Step: quick, short, fast recovery.
- Glide: long and low.
- Leap: an arcing hop.
- Flight: multiple air dashes, slow fall.

**Attribute panel.** Speed, Jump, Air type ×N, Dash style/distance/cooldown, Endurance,
Weight, Landing recovery, HP. The panel shows the before/after difference for any part you
hover.

**Cosmetics.**
- Per-zone paint (primary/secondary/trim/glow), finish (matte/gloss/chrome/carbon), wear amount.
- Decals and emblems, number plates.
- Visor color, thruster flame color, dash trail style.
- Victory poses, capsule skins.

**Presets and sharing.** Five saved builds; share-codes (a short string encoding a build) to post online.

**Photo mode** in the garage and after matches.

---

## 3. Gameplay depth

Already done: perfect dodge (brief invulnerability at the start of a dash), charge guard
(deflects frontal shots, turns bomb/pod blasts into chip damage), slower pace, fairer AI.

Next:
1. **Telegraphs.**
   - Ground ring under incoming bombs.
   - A glint before rail shots.
   - A red flash on enemy charge wind-up.
2. **Parry.** Guard in the last 0.12 s before a hit to stagger the attacker. A bomb landing directly on a guard breaks it.
3. **Air vs ground trade-off.** Air shots have more spread and a slower fire rate; ground shots are more accurate.
4. **Down-gauge play.** Show the rival's down gauge clearly; the knockdown hit deals bonus damage; optional wake-up attack.
5. **Landing recovery.** Hard landings cause a short recovery that leg parts modify, so constant hopping has a cost.
6. **Comeback.** Below 25% HP, bomb and pod cooldowns drop by 15%.
7. **Weapons.**
   - Guns: charge beam, curving homing gun, gatling (spin-up).
   - Bombs: napalm field, multi-bouncing grenade, flash-bang (blinds the lock-on).
   - Pods: turret, interceptor drone that shoots down bullets, mine wall.

## 4. Arenas
- Destructible cover (crates break after enough damage; the layout changes mid-fight).
- Hazard switches you can shoot to trigger a geyser or arc coil on the enemy.
- Optional pick-ups mode (shield, overdrive, speed) spawning mid-arena.
- 3–4 new arenas: hangar bay at night (rain), desert proving ground, flooded city ruins, orbital elevator.

## 5. Endgame and retention
- **Rival+ ladder:** remixed, harder rivals with new loadouts after the story.
- **Survival:** fight rivals back to back; HP carries over; leaderboard.
- **Grades** (S/A/B/C) per fight from time, damage taken, dodges and knockdowns. S-ranks unlock cosmetics.
- **Practice room:** training dummy with settings, damage/combo readout, hit-box view.
- **Replays:** record inputs (the sim is deterministic), watch from any camera, share a replay file.
- **Daily and weekly challenges** (for example, "win using only Glide legs", "deflect 5 shots"). Rewards are credits.
- **Credits plus a parts shop**, with rotating stock to collect. Cosmetic-only unlocks for flair.
- **Part mastery:** use a part to level it up; each level unlocks a paint variant or decal.
- **Achievements,** with a profile card showing level, favorite build and win rate.

## 6. Online (Cloudflare free tier + GitHub)
- **Hosting:**
  - Cloudflare Pages: static client, auto-deployed from GitHub Actions.
  - A Cloudflare Worker with **Durable Objects**: one object per lobby or match; relays inputs and checks matches. Durable Objects are on the free plan with SQLite storage.
  - **D1** (SQLite): player profiles, Elo ratings, match history, leaderboards.
  - Auth: anonymous device ID first, optional GitHub OAuth later.
- **Netcode:** rollback.
  - The sim must be fully deterministic. Audit `Math.random`/`Date` use in the sim, keep float-safe math and use the seeded RNG.
  - Snapshot and restore of `World` state.
  - 2–3 frames of input delay, plus up to 8 frames of rollback.
  - The relay exchanges only `FighterInput` per frame plus checksums to detect desyncs.
- **Modes:** private lobbies with room codes; casual quick match; ranked (Elo, placement matches, seasons, tiers).
- **Fairness:** shared rule-set version, build validation on the server (weight budget), match result signed by both clients, desync reports.

---

## Task split

**Keep with Claude** (needs visual iteration or deep coupling to the sim and rig):
- the art-direction overhaul of the mech models and animation (screenshot-driven iteration)
- the modular socket rig and weight system (architecture both the garage and combat depend on)
- rollback integration inside `World` (snapshot/restore, determinism audit)
- combat feel tuning (parry, telegraphs, landing recovery) and AI updates

**Good tasks for Codex** (well-scoped, testable, clear boundaries). Give each task its own git branch and the files listed.

| # | Task | Owns | Done when |
|---|---|---|---|
| C1 | **CI and deploy:** GitHub Actions running `npm ci`, `npm test`, `npm run build`, then deploy `dist/` to Cloudflare Pages | `.github/workflows/`, `wrangler.toml` | push to main deploys; PRs run the tests |
| C2 | **Lobby server:** Worker plus a Durable Object for room-code lobbies, relaying JSON input frames between 2 clients, ready/start handshake, reconnect | `server/` (new) | integration test with 2 WebSocket clients exchanging frames |
| C3 | **Ratings service:** D1 schema (players, matches, ratings), Elo update, leaderboard endpoint | `server/` | unit tests for Elo; `wrangler dev` endpoints work |
| C4 | **Replays:** record `FighterInput[2]` per tick plus seed/config; playback mode that re-runs `World`; export/import a JSON file | `src/game/replay.ts`, small hook in `match.ts` | a replay of a finished match reproduces the identical final HP (unit test) |
| C5 | **Grades and challenges:** grade formula, daily/weekly challenge generator with a seeded date, progress tracking in the save | `src/game/progression.ts`, `src/core/save.ts` | unit tests; data flows into the results screen |
| C6 | **Credits shop and part mastery:** data model, save migration, shop rotation logic | `src/data/shop.ts`, `src/core/save.ts` | unit tests for purchase, rotation and migration |
| C7 | **Rebindable controls:** settings UI plus Input remapping for keyboard and gamepad; saved | `src/core/input.ts`, settings panel in `src/ui/menus.ts` | every action rebindable; conflicts detected |
| C8 | **Practice room mode:** dummy settings (idle/move/shoot), damage readout, reset button | `src/game/practice.ts` | playable from the main menu |
| C9 | **Survival mode logic:** HP carry-over, rival sequence, scoring, local leaderboard | `src/game/survival.ts` | unit tests plus a menu entry |
| C10 | **New weapons, data and behavior only:** charge beam, gatling, napalm, interceptor drone, implemented in `world.ts` from the `parts.ts` patterns. Claude does their visuals | `src/data/parts.ts`, `src/game/world.ts` | unit tests per weapon |
| C11 | **Share codes:** encode/decode build plus paint as a short base64 string; import in the garage | `src/data/buildcode.ts` | round-trip tests |
| C12 | **Achievements:** definitions, event hooks reading telemetry-style events, unlock toasts | `src/game/achievements.ts` | unit tests |

Notes for parallel work:
- Initialize git first and protect `main`.
- Codex tasks should not edit `src/robot/*`, `src/vfx/*` or the arena modules. Those are being reworked for the new art direction.
- Run `npm test`, `npx tsc --noEmit` and `npm run test:e2e` (with the dev server up) before merging.

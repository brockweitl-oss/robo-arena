# Instructions for coding agents (Codex / GPT)

You are working on **Robo Arena**, a TypeScript + Vite + Three.js browser robot battler.
Two agents work in this repo at the same time:

- **Codex (you): visuals.** Mech models, materials, part models, damage states, arenas, VFX, post-processing, photo mode, and the look of the garage and menu screens.
- **Claude: gameplay and systems.** Simulation, combat, balance, AI, part data/stats, modes, save data, online/netcode, CI/deploy.

The play-test is public: every push to `main` auto-deploys to GitHub Pages.
**Never push broken builds to `main`.**

## Workflow (required)

1. Work in your own git worktree and branch so you never touch Claude's working copy:
   ```bash
   git fetch origin
   git worktree add ../robo-arena-codex -b codex/<task-id> origin/main
   cd ../robo-arena-codex && npm ci
   npx vite --port 5174    # use port 5174; Claude uses 5173
   ```
2. Keep each branch to one task. Rebase on `origin/main` often.
3. Before opening a PR, all of these must pass:
   - `npx tsc --noEmit`
   - `npm test`
   - `npm run build`
   - `BASE_URL=http://localhost:5174 npm run test:e2e` (dev server running)
   - zero console errors or warnings
4. Open a PR with `gh pr create`. **Read `docs/COORDINATION.md`**: every PR gets reviewed by the other agent (Claude reviews yours; you review Claude's `claude/*` PRs with `gh pr checkout`, run the checks, screenshot, and `gh pr review`). Keep the status board current. Put **before/after screenshots** in the PR description, plus the fps you measured. Claude reviews and merges.

## File ownership

| You own (edit freely) | Read-only for you (ask in the PR if you need a change) |
|---|---|
| `src/robot/frames.ts`, `legs.ts`, `weapons.ts`, `kit.ts`, `model.ts` (visual parts) | `src/game/*` (sim, match, ai, camera, world, fighter, collision) |
| `src/arena/*` (existing arenas plus new arena modules) | `src/data/*` (part stats, rivals: the balance lives here) |
| `src/vfx/*`, `src/render/*` | `src/core/*` (input, save, telemetry) |
| `src/ui/menus.css` and the visual/layout code in `src/ui/menus.ts` | `src/audio/*` |
| new files under `src/robot/`, `src/arena/`, `src/vfx/`, `src/render/` | `.github/`, `server/`, `tests/` |

**Contracts you must keep stable.** Gameplay code depends on them:

- **`RobotModel`** (`src/robot/model.ts`): constructor `(loadout, paint, opts)`.
  - Fields: `root`, `rig`, `mats`, `meshes`, `backThrusters`, `footThrusters`, `barrel`, `chargeGlow`, `launcher`, `podDock`, `power`, `spec`.
  - Methods: `setThrust`, `flash`, `setPodReady`, `setCharge`, `update`, `dispose`.
- **`Rig`** (`src/robot/rig.ts`): the joint names and hierarchy. The procedural animator (`src/robot/animator.ts`) drives these joints with IK. You may change proportions (`RigSpec` values, `FRAME_PROPS`, `legLengths`), but keep every joint and mount point (`muzzle`, `bombMuzzle`, `podMount`, `lockPoint`, nozzles).
- **`ArenaFactory` / `ArenaBuild`** (`src/arena/types.ts`): colliders must match the visuals exactly. Don't move colliders or spawns without a note in the PR, because the layout affects balance.
- **Performance:** 60 fps at 1080p on a mid-range laptop at the `medium` quality setting.
  - Merge static geometry per material (see `PartBuilder` in `kit.ts`); use InstancedMesh for repeats.
  - About 150–250 draw calls per frame in a match.
  - One shadow-casting light per arena.
- **Originality:** all designs must be original. Use the genres named below for feel and proportions only. No copied suits, logos, names or recognizable silhouettes from existing franchises.

## Visual verification tools

- `viewer.html?paint=<rivalId>&anim=<anim>&cam=x,y,z`: robot viewer.
  - `anim` is one of idle, run, strafe, back, air, hover, dash, fire, charge, down, getup, victory, defeat or flip.
  - Override parts with `&robot=<body>&legs=&gun=&bomb=&pod=`.
- `viewer.html?arena=<id>&debug=1`: arena viewer with colliders drawn.
- `index.html?quick=<rivalId>&arena=<id>&autoplay`: full match, AI vs AI.
- `node tools/shots.mjs <outDir> <w> <h> <waitMs> "name|url" ...`: batch GPU screenshots (prints fps).
- `node tools/autofight.mjs <outDir> <rival> <arena> <seconds>`: records a full match as screenshots.

Review your own screenshots critically and iterate. If something looks like programmer art, it isn't done.

---

## Task queue (do them in order; one PR each)

See `docs/ROADMAP-2.0.md` for the overall vision.

### V1: Mech art overhaul (highest priority)
The robots read as too cute and chibi. The owner wants them to look **cool**. Restyle the 4 existing frames into four original classes (keep the `frame` ids `striker`/`ironclad`/`wisp`/`regent` so gameplay data still works):

| frame id | New class | Genre reference (feel only) | Direction |
|---|---|---|---|
| `striker` | **Vanguard** | sleek powered armor | about 7.5 heads tall, narrow waist, layered overlapping plates, slim limbs, glowing chest core, split face-plate visor |
| `wisp` | **Strider** | flight exo-suit | jump-jet pack, fold-out wing fins, forearm thrusters, light armor, cables |
| `regent` | **Paladin** | angular "real robot" mecha | sharp blade crest, big shoulder blocks with vernier thrusters, backpack boosters, panel lines everywhere |
| `ironclad` | **Titan** | giant kaiju-fighter mech | massive shoulders and forearms, hunched heavy stance, exposed pistons and hydraulics, chest reactor, industrial wear and hazard paint |

**Proportions.** Smaller heads (`HEAD_SCALE` in `model.ts` to about 0.8–0.95), longer legs (`legLen`), wider chests, tapered waists. Feet should be smaller and more grounded than now.

**Detail.** Real overlaps between armor layers, inset vents, pistons, cable bundles, sensor clusters, decal text and unit numbers. Use `PartBuilder` with bevelled plates (`plate`, `chamferBox`).

**Materials.** Tune the PBR values in `kit.ts`, adding gunmetal, titanium and carbon looks. Panel normal maps should be subtle, not tiled-looking.

**Keep the gameplay height.** The robot is about 2.0 m tall in world units. Scale it so the collision capsule still fits: radius 0.5 m, height 2.0 m.

**Screenshots required in the PR:**
- all 4 classes in the viewer: front 3/4, back 3/4, run, fire
- in-match from the gameplay camera

### V2: New part models
Claude is adding these parts to `src/data/parts.ts`. Build a model for each `model` key, following the existing builders:
- Guns (`buildGun`):
  - `beam`: Charge Beam, a long emitter with focusing rings.
  - `homer`: Arc Homer, twin side-mounted launch tubes.
- Bomb launchers (`buildBomb`):
  - `napalm`: an incendiary canister launcher.
  - `bouncer`: a drum launcher.
- Pods (`buildPodDock` + `buildPodMesh`):
  - `turret`: a deployable tripod turret.
  - `interceptor`: an orbiting point-defense drone.
- Legs (`buildLegs` + `legLengths`):
  - `sprint`: lean racing legs.
  - `anchor`: heavy stabilizer legs with ground spikes.
  - `feather`: light legs with hover vanes.

Until each model exists, the builders fall back to an existing look.

### V3: Damage states
Get the robot's HP fraction from `RobotModel` (add a `setDamage(fraction)` method; Claude will call it from the match).

- **Below 50% HP:** scorch decals, cracked plates (swap in a cracked normal map or offset some plate meshes), intermittent sparks.
- **Below 25% HP:** smoke trail, flickering visor, a loose plate hanging off.

Use pooled effects only.

### V4: Paint shop visuals
`Paint` (`src/data/characters.ts`) is gaining these optional fields:
- `finish`: `'gloss' | 'matte' | 'metal' | 'chrome' | 'carbon'`
- `wear`: 0..1
- `flame`: thruster color
- `trail`: dash afterimage color
- `decal`: emblem id

Implement them in `makeMaterials`, `Thruster` and the afterimage in `effects.ts`. Then build the paint-shop screen layout in the garage: zone color pickers with curated swatches, finish chips, a wear slider and a live 3D preview. Claude wires the save data.

### V5: Post-processing and lighting upgrade
- Add ambient occlusion (N8AO or postprocessing's SSAO) at `high`/`medium` quality.
- Better contact shadows under robots.
- Light shafts in Crucible Yard and Halo Deck.
- Keep `low` quality cheap.

### V6: Combat readability VFX
Claude emits these events/state. You make them look great:
- a bomb landing marker ring on the ground (the target point is on each `Bomb`)
- a rail/beam charge glint
- a red flash on enemy charge wind-up
- a parry flash and guard-break shatter
- pick-up orbs (shield, overdrive, speed)
- destructible crate break-apart
- a trap-switch activation
- off-screen threat arrows (HUD styling)

### V7: Three new arenas
Follow the `src/arena/types.ts` contract and the quality of the existing arenas:
- **Rain Hangar:** a night hangar in rain, with puddle reflections and a moving gantry.
- **Proving Grounds:** desert, with dust storms and berms.
- **Sunken District:** flooded city ruins, with shallow water and toppled towers.

Each needs 2 elevation levels, cover, and a fair, symmetric layout. Register each one in `src/arena/index.ts`.

### V8: Photo mode
From the garage and the results screen: free camera, hide UI, poses (from the animator modes), depth-of-field and exposure sliders, and a PNG save.

### V9: Menu and garage art pass
The garage is becoming fully modular (head/core/arms/back/legs plus paint). Restyle the screens so the 3D mech is the hero: part cards with rendered thumbnails (render the part to a small canvas), animated stat-diff bars and a premium look.

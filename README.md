# Robo Arena

A single-player 3D robot battler for the browser. Small, fast robots fight in compact
diorama arenas with soft lock-on guns, lobbed bombs, hunting pods, dashes and a
knockdown system. It's inspired by how the opening hours of classic customizable-robot
battlers play. All robots, arenas, names, UI, music and sound are original.

Built with TypeScript, Vite and Three.js. Every model, texture, sound and music track is
generated in code at runtime, so there are no binary assets.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/ (deploy anywhere, relative paths)
npm run preview    # serve the build
npm test           # unit tests (vitest): collision, fighter state machine, combat
npm run test:e2e   # browser test (needs `npm run dev` running): boots, fights, checks for errors
```

Dev pages:

- `index.html?quick=<rivalId>&arena=<arenaId>&time=90` starts a match immediately. Add `&autoplay` to let an AI drive the player.
- `menus-dev.html` runs the menu layer against a mock host.
- `viewer.html?arena=foundry` is an arena viewer with an orbit camera. `&debug=1` shows colliders.
- `viewer.html?paint=sable&anim=run` is a robot viewer. `anim` can be idle, run, strafe, back, air, hover, dash, fire, charge, down, getup, victory, defeat or flip. `robot`, `legs`, `gun`, `bomb` and `pod` override individual parts.

## Controls

| Action | Keyboard + mouse | Gamepad |
|---|---|---|
| Move (camera-relative) | WASD | Left stick |
| Camera | Mouse (click the game to capture it) | Right stick |
| Jump / double jump / hover (hold) | Space | A / Cross |
| Dash (ground or air) | Shift | B / Circle |
| Gun | Left click | RT |
| Bomb | Right click | LT |
| Pod | E or middle click | RB |
| Charge attack | Q | X / Square |
| Toggle hard lock-on | Tab or F | R3 |
| Pause | Esc | Start |

Guns track the opponent automatically (soft lock). The skill is in movement: dashing
through fire, jumping over shots, and bombing over cover. Hits fill the down gauge. When it
fills, the robot is knocked down, then gets up with a moment of invulnerability. Jump and
dash inputs are buffered for about 100 ms, and you can still jump for about 100 ms after
walking off a ledge.

## Game content

- **Story Ladder:** five rivals in order, ending with the champion on Halo Deck. Wins unlock parts.
- **Free Battle:** pick any rival, arena and round length.
- **Garage:** five slots (Gun, Bomb, Pod, Body, Legs). Parts: 3 guns, 2 bombs, 2 pods, 4 bodies (each a distinct robot frame) and 2 leg types.
- **Arenas:** Crucible Yard (moving crane platform), Lantern Terrace (steam geysers) and Halo Deck (arc coils plus a lift).
- Progress and settings are saved in `localStorage`.

## Project structure

```
src/
  main.ts              boot; ?quick= dev entry
  game/
    game.ts            shell: render loop, match lifecycle, MenuHost implementation
    match.ts           one battle: intro capsules, phases, events → VFX/SFX/camera/HUD
    world.ts           deterministic 60 Hz combat sim (projectiles, bombs, pods, hits, hazards)
    fighter.ts         robot physics and state machine; consumes a device-independent FighterInput
    collision.ts       capsule vs boxes/ramps, segment raycasts
    ai.ts              AI pilot (personality + skill) producing FighterInput
    camera.ts          chase camera: soft/hard lock, collision, shake, cinematics
    showroom.ts        3D menu backdrops (title, garage, versus)
  robot/
    rig.ts             joint hierarchy + mount points
    kit.ts             geometry helpers, PBR materials, per-joint mesh merging
    frames.ts          body frames (striker, ironclad, wisp, regent)
    legs.ts            leg types (stride, hopper)
    weapons.ts         gun / bomb launcher / pod models
    model.ts           assembles a RobotModel from a loadout + paint
    animator.ts        procedural animation: IK gait, springs, attacks, reactions
  arena/               arena contract (types.ts), registry (index.ts), one module per arena
  vfx/                 instanced particles, effects director, thruster shader
  audio/               Web Audio synth engine, SFX recipes, procedural music
  ui/                  HUD and menus
  data/                parts.ts (part catalog), characters.ts (rivals, paints, ladder)
  core/                input, save/settings
tests/unit/            vitest
tests/e2e/             Playwright smoke test
tools/                 screenshot / playtest scripts
```

The simulation (`world.ts`, `fighter.ts`, `collision.ts`, `ai.ts`) has no rendering
dependencies and steps at a fixed 60 Hz from plain input structs. Rendering interpolates
between ticks. That separation is what makes future lockstep or rollback multiplayer
practical: send `FighterInput`s, not positions.

## Adding a part

1. Add an entry to the right record in `src/data/parts.ts` (`GUNS`, `BOMBS`, `PODS`, `BODIES` or `LEGS`). Stats, colors, SFX name and ratings all live there.
2. If it needs a new look, add a `model` value and a builder branch:
   - guns, bomb launchers and pods: `src/robot/weapons.ts`
   - bodies: a new frame in `src/robot/frames.ts`, plus `FRAME_PROPS` and the scale tables in `model.ts`
   - legs: `src/robot/legs.ts`
3. To make it a ladder reward, add `"slot:id"` to a rival's `unlocks` in `src/data/characters.ts`. To make it a starter part, add it to `STARTER_PARTS`.

## Adding an arena

1. Create `src/arena/<id>.ts` exporting an `ArenaFactory` (see `src/arena/types.ts`). It returns visuals (`root`), colliders (boxes and ramps; the floor top is at y = 0), hazards, spawns, bounds, lighting/env, a deterministic `tick` for moving colliders, and a visual `update`.
2. Register it in `src/arena/index.ts` (`ARENA_FACTORIES`, `ARENA_IDS` and `ARENA_INFO`).
3. Check it with `viewer.html?arena=<id>&debug=1`.

## Adding a rival

Add an entry to `RIVALS` in `src/data/characters.ts` with a loadout, paint, AI personality
(`rookie`, `rusher`, `bomber`, `duelist`, `trickster` or `champion`), skill (0–1), arena and
dialog. Ladder order is array order.

## Credits

See [CREDITS.md](CREDITS.md). All content is original and generated procedurally.

# Robo Arena 3.0 Roadmap

Based on play-test 2 (17 real matches): rounds now average 52 s (target hit), and dashing and guarding are being used. But **guns do 72% of all damage**, parries happen 0.18 times per match, and every fight is the same gun/bomb/pod loop.

The 3.0 goals:
- deeper close-range play (fighting-game melee)
- risk on weapon spam (heat)
- mech-game movement (boost)
- **Armored Core–style assembly**
- cooler mechs
- new modes

The reference genres are fighting games, arena shooters and mech-combat games, for **feel only**. Every design, name and asset stays original.

## Combat 3.0 (Claude)
| ID | Feature | Design |
|---|---|---|
| C1 | **Melee triangle** | Strike beats grab, guard beats strike, **grab beats guard**. A new *Grab* action (tap charge plus a direction toward the enemy, or a dedicated key) has a short-range throw that ignores guard. It loses to strikes because of its startup. |
| C2 | **Melee chain + finisher** | Charge becomes a 3-hit string: lunge → follow-up → finisher (launcher or slam by frame). Each hit can be dash-cancelled. |
| C3 | **Combo rules** | Damage scaling per hit in a combo (100/85/70/60…), shrinking hit-stun, a combo counter in the HUD, and a "combo broken" cue. No touch-of-death. |
| C4 | **Cancels** | Dash-cancel attack recovery (costs a dash charge). Jump-cancel landing recovery once per landing. |
| C5 | **Learnable parry** | Window 0.12 → 0.16 s, a distinct parry sound and flash, a reward of +40 down on the attacker, and a parry drill in the practice room. |
| C6 | **Weapon heat** | Guns build heat per shot and cool when idle. At 100% heat the gun overheats: a 1.6 s lockout with venting VFX. A heat bar sits on the gun dial. |
| C7 | **Boost movement** | Tap = quick boost (today's dash). **Hold = assault boost**: fast straight-line flight that drains boost energy, steers slowly, can't fire guns, and can transition into a melee lunge. **Wall-kick** off cover in the air. |
| C8 | **Stagger punish** | When the down gauge fills, the target is stunned for 0.5 s before it falls: a punish window with a camera push-in. |

Balance is verified with `npm run balance`. Every new option has to stay inside 40–60% across the field.

## Assembly 3.0: full modular + 4 mounts (Claude does the data and rig contract; Codex does the visuals)
- **Frame slots:** HEAD (lock speed and sensor range), CORE (HP, energy, weight capacity), ARMS (melee style, recoil control), LEGS (movement family).
- **Weapon mounts:** R-ARM, L-ARM, R-SHOULDER, L-SHOULDER.
  - Arm weapons: guns, blades.
  - Shoulder weapons: bomb launchers, pod racks, missiles, shields.
  - Fire buttons map to the mounts.
- **Leg families** that change movement:
  - **biped:** balanced
  - **reverse-joint:** jumps
  - **tank treads:** no jump, strafe-glide, heavy armor, turret-like aim
  - **quad:** stable aim, a hover hop
  - **hover-skirt:** constant float, slippery
- **Weight vs capacity:** going over the core's capacity slows movement and boost.
- The **save migrates** old loadouts into the new slots automatically.

## Visuals 3.0 (Codex)
| ID | Task |
|---|---|
| V10 | **Art direction push.** Anime real-robot / powered-armor / flight exo-suit / giant-brawler feel, all original. Sharper silhouettes, heroic proportions, panel-line density, emissive seams, visible thrusters. |
| V11 | **Modular part models** for every head/core/arms/legs piece, plus the four mounts and the new leg families (tank, quad, hover). |
| V12 | **Animation 3.0:** melee keyframes with smears and impact holds, weapon-specific stances (brace for the beam, plant for a shoulder cannon), directional and heavy hit reactions (spin-out, wall-splat, juggle), boost flight pose and landing skids, per-class weight (Titan stomp, Strider skim), ramp foot IK, per-frame idle, victory and defeat animations. |
| V13 | **Heat, boost and assault VFX:** barrel glow, venting, an afterburner trail, wall-kick dust. |
| V4/V7/V8/V9 | Still queued: paint shop, three new arenas, photo mode, garage art (the garage must become the assembly UI). |

## Modes (Claude), in the owner's priority order
1. **2v2 team battles:** generalize `World` to N fighters with teams; AI teammates; local co-op later.
2. **4-player free-for-all:** arena-shooter rules, timed power-ups, score to win.
3. **Online:** rollback netcode on Cloudflare (Workers + Durable Objects + D1), private lobbies, quick match, ranked Elo. **Needs the owner's Cloudflare login.**
4. **Single-player content:** new rivals and a story chapter using the new arenas.

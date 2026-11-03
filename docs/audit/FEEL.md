# Combat feel audit: controls, camera, hit feedback, readability, audio

Branch `claude/audit-feel`. Method: headless sim measurements for every body × legs combo (20 builds),
plus scripted keyboard/mouse play in real matches (`tools/feelprobe.mjs`, which logs per-frame player
motion, camera, opponent framing, frame times, shader-program count and sim events), plus targeted
browser experiments. Owner rules respected: real time, no slow-mo, no hit-stop, no RNG.

Severity: **S1** breaks play · **S2** clearly felt by players · **S3** polish.

## Fixed

| # | Sev | Finding | Evidence | Fix |
|---|-----|---------|----------|-----|
| 1 | S1 | **First-use freezes mid-fight.** The match pre-compiled every shader for the canvas, but the scene is drawn into the post-processing buffer (linear output), so the pre-compile built unused programs. Effects not seen in the intro compiled on first use. | The rival's first Frost skill shot froze the game for **170-430 ms** (on every run, both arenas, exactly when the player has to read and dodge it). First guard break: ~200 ms. First Ion Wave: 64 ms. `renderer.info.programs` grew mid-fight. | `GameRenderer.precompile()` compiles against an offscreen target (the variant actually drawn). Projectile heads of every kind, a ribbon and a halo are pre-pooled in a hidden group. Panel debris allocates its instance colours up front (a lazy `setColorAt` switched the shader variant). Skill slots start on different materials. **After: every probed effect costs a normal frame (~33 ms per 2 frames), and the program count is flat from fight start to end (67/67).** |
| 2 | S2 | **Every plain hop had landing lag on 12 of 20 builds**, none on the other 8. The fixed hard-landing threshold (13 m/s) sat inside the normal single-jump landing range (11.5-16.6 m/s). | Default build (Vanguard/Stride) single hop landed at 13.8 m/s, giving 8 frames (138 ms) of no dash, shot, bomb or jump. Hopper legs: 10-12 frames. | The threshold is now relative to the build's own hop (`jumpVel × √fallMul × 1.12`, never below 13). **After: 0 of 20 builds lag on a hop; all 20 still lag on double-jump landings and big drops** (79-268 ms, unchanged). Sim change, so **RULESET_VERSION 7 → 8**. |
| 3 | S2 | **Camera lost the player when backed against cover.** The boom collision pulls the camera in to ~1.6 m at shoulder height while the look point stays out toward the rival, so the view stared past the player's head. | Probe: player chest at **-1.14 to -1.63 NDC** (below the bottom edge) for ~1.5 s after a strafe-dash into a pillar in Crucible Yard. Screenshot: half the robot clipped off the frame. | `ChaseCamera.keepInFrame`: if the player's body leaves a ~19° cone around the view axis, the look point rotates toward it just enough. It's continuous and inactive at normal boom lengths. **After: same spot, player chest at -0.44 NDC, opponent still on screen (y 0.68).** I tried a crane-up boom first and rejected it: it pitched the view at the floor and pushed the rival off the top. |
| 4 | S2 | **Hits had no physical feedback, and the existing shake couldn't be seen.** `addTrauma` stored `t×0.6`, so shake (trauma²) was tiny: a knockdown rolled the camera **0.06°** and a KO **0.1°**. Taking a heavy shot, landing one, or a bomb going off at your feet did nothing to the camera. | Measured from the formula (trauma 0.15 → s 0.0225 → 0.045 rad × s). | Trauma now spans 0..1 with re-tuned amplitudes: heavy hit taken ≈0.25°, knockdown ≈0.4°, KO ≈0.85°, plus small screen translation. Shake is added on hits taken (light, heavy or blocked), heavy hits dealt, and explosions near your robot (falls off over 3 blast radii). Burn ticks and parries don't shake. Your own dash gets a 3° FOV push for 75 ms. All of it respects the Camera Shake setting. No time scaling. |
| 5 | S2 | **Gamepad: the per-axis (square) deadzone snapped shallow diagonals to the cardinal directions.** | Stick at 10° off forward with magnitude 0.9: x = 0.156 < 0.18 deadzone → pure forward. Circle-strafing lost its fine angles. | Radial deadzone (0.16) with rescale on the move stick. The look stick gets a radial deadzone (0.14) and a 1.6 response curve for fine aim near centre, and full-tilt yaw goes from 150°/s to 185°/s. |
| 6 | S3 | **Enemy tells were mixed like routine noise.** The rival's rail charge, skill wind-up and charge wind-up are attenuated by camera distance (often 15-25 m), so they sat under your own gunfire. | Spatial gain at 20 m ≈ 0.52. | Enemy tells play at ×1.2-1.3, and your own versions slightly lower. The low-HP alarm beeps every 1.3 s four times, then every 3.2 s at a lower level, instead of beeping every 1.3 s for the rest of the round. |

## Measured and found good (no change)

- **Input latency:** keyboard/mouse presses latch until the next sim tick. Run, reverse, strafe, hop and dash all respond on the first rendered frame after the key (27-48 ms in the probe, which is 1-2 rAF including Playwright dispatch). Dash reaches full speed on tick 1.
- **Ground movement:** 0.25 s to top speed, 0.19 s coast, 0.11 s planted reversal. These are already pinned by `movement.test.ts` and feel weighty but responsive.
- **Lock-on camera:** the rival stayed on screen for 100% of frames across the scripted sessions in Foundry, Garden and Orbital. Yaw tracking eases off at point-blank range, so it never whips. No yaw jitter (second-difference sum < 1 rad per 15 s).
- **Readability:** the enemy charge, rail charge and skill wind-ups all have a visual tell (red ring or glint, ground lane), and off-screen bombs and pods get HUD arrows.
- **Frame pacing:** median 16.6 ms, 60 fps in every probe. The remaining 0.1-1 s spikes didn't line up with sim events or program creation. They came from other GPU jobs on this shared test machine.

## Found, not fixed (and why)

- **Dash → shot is 28-35 frames** (the dash itself plus `DASH_RECOVERY` 0.22 s, during which no actions are allowed). This is a deliberate commitment and balance lever, so it belongs to the balance pass, not this one. Jumping out of it (dash-jump) is already allowed.
- **Hit-confirm sound reuses the `ui_move` menu blip.** A dedicated asset would be new content. It's distinct enough in context.
- **Wall impacts play a quiet, high-pitched `hit_light`.** This could be confused with a real hit, but the hit-confirm blip and the damage number disambiguate. Left alone.
- **Skill wind-up and rail charge share one sound** (different pitch). Separate synth recipes would be new assets. Flagged for the audio owner.
- **The camera boom is a single ray (no probe radius).** At glancing angles to cover the near plane can graze a wall edge for a frame. A sphere cast needs a new collision query, which is out of scope.
- `updateSide`'s hit-stop shudder branch is dead code (`hitstop` is always 0). It's harmless and left for whoever owns cleanup.

## Tools

- `tools/feelprobe.mjs <outDir> [arena] [rival] [port]` drives scripted WASD/Shift/Space/LMB/Q input and writes per-frame JSON (player, camera, NDC of both robots, frame dt, sim events, shader-program count). Set `SHOTS=1` to also screenshot at each step.

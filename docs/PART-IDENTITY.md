# Part identity

Every part should have one clear strength and one clear weakness, and at least one answer in the
catalog. Stats live in `src/data/parts.ts`; the garage `pro`/`con` lines are the player-facing summary of this table.
Balance target: each part at 42–58% field win rate in the headless tournament (`npm run balance`,
which runs with the Overcharge Core on, as real matches do).

## Guns (primary, auto-aimed)

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Pulse Blaster | Mid-range pressure | Reliable chip from a 3-round burst with mild tracking | Low impact per hit; tracking fades at range | Guard (frontal deflect), Aegis Drone |
| Scatter Fan | Brawler | Huge close-range burst; hard to dodge up close | Pellets die past ~10 m | Rail/Beam at range, Ion Wave spacing, Drift Mines |
| Rail Lance | Long-range punisher | Highest per-shot damage; predictive and detonates primers | Visible wind-up and recovery; no homing | Direction change after the tell, dash, Phase Blink |
| Charge Beam | Flexible precision | Choose speed or power on each shot; pierces pods | Weak when tapped; the charge glow is visible | Pressure during the hold, Scatter up close |
| Arc Homer | Cover-breaker | Curves around cover and punishes strafing | Slow shots; a straight dash escapes the curve | Straight dashes, Aegis Drone, Guard |

## Bombs (lobbed)

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Arc Mortar | Cover flusher | Big blast over any cover | Long reload; its shadow gives it away | Moving after the telegraph |
| Cluster Hopper | Area denial | Covers a wide area with three bomblets | Each bomblet is weak | Guard chip only; dash through the gaps |
| Cinder Pot | Zone control | A burning pool denies ground, and a 3 m pool covers the whole Core pad | Small blast; airborne robots ignore the fire | Hover/jump over it, Strider frame |
| Skip Grenade | Chaser | Fast and skips after rolling targets | Low arc; tall cover stops it | Standing behind crates/walls |

## Pods (support)

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Seeker Pod | Pressure | Relentless homing threat that forces movement | Slow; easy to shoot down | Pulse/Blaster fire, Aegis Drone |
| Drift Mines | Lane trap | Locks down lanes, corners and the Core approach | Very slow; visible fuse | Patience, going around |
| Sentry Tripod | Hold point | Free damage while you hold a position (the Core) | Stationary; weak shots; can be destroyed | Leaving its arc; bombs |
| Aegis Drone | Anti-zoning | Shoots down shots and pods near you | Deals no damage | Melee, rail/beam (too fast to intercept reliably) |

## Frames (body)

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Vanguard | All-rounder | No weak spots; snappy burst dash | No standout strength | Specialists in their own range |
| Titan | Tank | Most HP and endurance; armored ram ignores flinch | Slow; short dash; poor in the air | Kiting, Rail, aerial pressure |
| Strider | Flyer | Best air mobility (long hover, extra air dash) | Fragile; knocked down quickly | Homer, Skip Grenade, Rail punish on landing |
| Paladin | Duelist | Longest dash and charge reach | Long dash cooldown; heavy in the air | Baiting the dash, then punishing |

## Legs

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Stride | Standard | Predictable; one of everything | Nothing special | — |
| Hopper | Vertical | Two air jumps and a high leap (elevated Cores) | Slower run; heavy landings | Landing punishes |
| Sprint | Ground speed | Two dash charges and a fast run | Low jump; slightly easier to knock down | Area denial, Ion Wave |
| Anchor | Immovable | Huge knockback resistance and endurance | Short dashes; weak jump | Precision shots, kiting |
| Feather | Floater | Slow falls and soft landings | Light: knocked back further; slower run | Heavy hits, ground zoning |

## Skills (manually aimed)

| Part | Role | Strength | Weakness | Countered by |
|---|---|---|---|---|
| Breaker Lance | Sniper finisher | Highest single hit; detonates primers; sweet spot at long range | Narrow, so it has to be aimed | Sidestep after the red lane |
| Ion Wave | Wide punish | Wide and forgiving; strongest point blank | Slow, so it's easy to jump | Jumping |
| Grapple Harpoon | Engage | Pulls the target into melee range, staggered | Low damage; long cooldown | Dodging the cast; Phase Blink |
| Frost Spike | Tempo | Short cooldown; slows the target | Moderate damage | Guard; trading |
| Phase Blink | Escape | Dodges anything; repositions (onto or off the Core) | No damage | Pressure after the blink, traps |

## Changes in this pass (Overcharge Core PR)

Small tweaks only, applied where a part lacked a niche or sat at the edge of the target band once the Core was on:

| Part | Change | Why |
|---|---|---|
| Arc Homer | damage 38 → 44, cooldown 1.35 → 1.25 s | Weakest gun (35% field with the Core on). Its niche, hitting around cover, didn't pay. |
| Cinder Pot | cooldown 3.4 → 3.1 s, fire 24 → 27/tick, pool radius 2.9 → 3.0 m | Gives it the "deny the Core pad" niche: a pool now covers the 2.2 m pad. |
| Sentry Tripod | life 7 → 8 s | Its niche is holding a point: the turret now outlasts a contested capture. |
| Titan frame | HP 1120 → 1100 | Sat at the top of the band (57–58%); its endurance and armored ram are untouched. |
| Strider frame | HP 960 → 975 | Fragility stays its weakness, but it was near the floor (43–45%). |
| Grapple Harpoon | cooldown 7 → 6.5 s | Near the floor (43–46%); its engage niche needs to come up more often. |

The final tournament results are in `tests/balance/report.json`. Deterministic scenarios aren't independent statistical trials. Field rates carry roughly ±3–4 points of noise at n=96, and ±8 at n=16.

## Changes in the AI / balance audit pass (docs/audit/AI-BALANCE.md)

The tournament now uses 144 distinct declared scenarios per pairing (6 lanes × 4 tactics layouts × 3 pilot
styles × 2 sides) instead of 18, and the AI pilots dodge bombs/pods, flank cover and fire at a skill-scaled
tempo. Several parts moved once the pilots stopped ignoring them, so this pass re-centres them on that field.

| Part | Change | Why (field win rate, new AI, before → after) |
|---|---|---|
| Aegis Drone | life 8 → 6.5 s, cooldown 7.5 → 9 s, intercept interval 1.0 → 1.3 s | 65% → 56%. Its 8 s life outlasted its 7.5 s cooldown: a permanent shield. Now ~70% uptime. |
| Rail Lance | damage 195 → 185, cooldown 1.85 → 2.05 s | 60% → 51%. Pilots that fire at full tempo made the biggest punish in the game also the most frequent. |
| Drift Mines | arm 0.8 → 0.6 s, trigger 2.2 → 2.4 m, fuse 0.6 → 0.45 s, damage 85 → 100, cooldown 5.2 → 4.6 s | 37% → 43%. Once pilots walked around them they almost never popped on anyone. The fuse is still visible. |
| Cinder Pot | blast 75 → 82, fire 27 → 30/tick | 46% → 43% (bomb nerfs elsewhere moved the field); keeps its Core-denial niche paying. |
| Anchor Legs | speed ×1.0 → ×1.03, dash ×0.94 → ×0.97, endurance +45 → +55 | 40% → 43%. Still the shortest dash on a heavy build. |
| Grapple Harpoon | cooldown 6.5 → 6 s, damage 55 → 60 | 41% → 47%. |
| Frost Spike | cooldown 4 → 4.5 s, damage 62 → 58 | 58% → 55%; still the shortest skill cooldown. |
| Ion Wave | cooldown 5 → 5.5 s, damage 75 → 70 | 59% → 55%. |
| Phase Blink | cooldown 5 → 4.5 s | 43% (unchanged within noise; its value is underrated by bots). |
| Arc Homer | damage 44 → 47 | 43% → 47%. |
| Pulse Blaster | damage 22 → 23 | 42% → 45% (the starter gun should not be the floor). |

Every part now sits at 43–55% field win rate (target 42–58%). Field fights average 41 s and all end by KO.

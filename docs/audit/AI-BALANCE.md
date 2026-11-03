# AI, balance and progression audit

Scope: AI opponents (`src/game/ai.ts`), part balance (`src/data/parts.ts`), rival/ladder difficulty
(`src/data/characters.ts`), survival, Overcharge Core handling, credits/shop/challenges
(`src/game/progression.ts`, `src/data/shop.ts`). Owner rules held throughout: real-time, deterministic,
no slow-mo, no hit-stop, no RNG deciding fights. `RULESET_VERSION` 7 → 8 (shared with the feel audit's bump).

## How it was measured

- **Exploit bots.** `tests/balance/harness.ts` adds seven scripted "cheese" pilots that use fixed input
  patterns a real player could do: `kite` (back-pedal, fire everything), `zoner` (hold 14–18 m, strafe,
  throw every bomb/pod/skill on cooldown), `corecamp` (sit on the Overcharge Core), `airspam` (stay
  airborne), `mash` (walk in, press everything), `circle` (circle-strafe and fire), and `turtle` (keep the
  nearest cover between you and the rival, only lob bombs and pods). There is also `idle` (a time-to-kill
  baseline) and `ramspam`. Each bot plays the default build against all 10 rivals in 24 declared scenarios
  (6 lanes × 4 tactics layouts, alternating sides).
- **Mid-player proxies.** The game's own AI at lower skills (`rookie .30`, `duelist .45/.60`, `champion .80`)
  plays the default build against each ladder step.
- **Composite difficulty** is the mean win rate of the 7 human-like bots plus 3 proxies against a rival.
  It is a ranking signal, not a human win rate. Bots are worse than people at reading tells.
- **Human telemetry.** `playtest/telemetry.jsonl` (75 real matches) was used to size challenges.
- Commands: `BALANCE=1 AUDIT=cheese|ladder|trace npx vitest run tests/balance/audit --reporter=verbose`
  (writes `tests/balance/audit/*.json`, gitignored), and `npm run balance` for the part tournament.

## Findings: AI as an opponent

| # | Finding | Evidence | Fix |
|---|---|---|---|
| 1 | **Skill presses stuck down forever (bug).** `emptyInput()` has no `skillPressed`/`skillTarget`, so after its first cast the AI kept the button held. It then re-cast the moment the cooldown ended, at a stale aim point, whether or not that made sense. | Trace: `s1` held on every frame from the first cast. | The fields are cleared each tick. Regression test: `tests/unit/ai-audit.test.ts`. |
| 2 | **Cover turtling beat almost every rival.** The AI never tried to get line of sight, so a bot that only kept a crate between itself and the rival and lobbed bombs won. | turtle: hex 96%, vance+ 100%, hex+ 100%, vance 75%, mira+ 75% | Flanking: after a skill-scaled time without LOS, the pilot probes side lanes at 4 m and 8 m, then spots beside the foe, and walks to the first clear one. Inside 9 m it jump-peeks over low cover. turtle average 72% → 29%. |
| 3 | **Bombs and pods were invisible to the AI until the last instant.** Bombs were avoided only on the way down. Pods were never avoided, and seekers/mines were never sidestepped. | AI dodges ~0.6 per fight; zoner (pure bomb/pod spam) won 80% on average, including 63% against the champion. | Pilots now read the landing ring once their reaction time has passed and walk out of it. They dash out of a blast that is about to land, give armed seekers/mines room, and sidestep a pod about to pop. Rival dodges 0.62 → 1.51 per fight; zoner vs Sable 63% → 42%. |
| 4 | **Ram wind-ups were never read.** Only a pilot getting up would answer a charge. | ramspam was already weak, but mash beat Mira+ 100%. | The ram wind-up (the loudest tell in the game) is sidestepped once per charge after the reaction delay. Long-range pilots dash out when a brawler closes inside 4 m. mash vs Mira+ 100% → 54%. |
| 5 | **Top pilots wasted most of their tempo.** A fixed extra delay was added between gun shots and between utilities, at every skill level. | Champion beam: about 10 shots in 37 s. | Decision tempo scales with skill (×1.2 at 0, ×0.5 at 1). The weapon's own cooldowns still gate everything, so it is decision quality, not stats. |
| 6 | **Out-ranged pilots never used bombs.** Only the bomber personality lobbed at long range. | kite: 46% vs Mira, 67% vs Vance+ | Any pilot lobs when the foe sits more than 3 m outside its range. kite average 49% → 28%. |
| 7 | **The Core was easy to cheese, then hard to contest.** Camping the pad won 63% vs Vance. After fix 3, a pilot dodging anything stopped contesting the pad at all, which failed `objective.test.ts`. | corecamp 45% average | A nearby bomb or pod now only softens the pull to the pad instead of cancelling it. Soft pod avoidance doesn't count as "danger". corecamp average 45% → 24%. |
| 8 | Parries are frame-perfect but rare and reaction-gated, and need ≥0.35 skill. Personalities are distinct (rookie/bomber/duelist/trickster/champion). Airspam and circle-strafe never beat a mid rival. | — | No change. |

Cheese-bot summary (default build; average over all 10 rivals, and the worst rival that isn't Dex):

| Bot | Avg win before → after | Worst case before → after |
|---|---|---|
| kite | 49% → 28% | Vance+ 67% → Vance+ 38% |
| zoner | 80% → 65% | Hex 88% → Hex+ 75% |
| corecamp | 45% → 24% | Vance 63% → Vance+ 33% |
| airspam | 23% → 21% | 8% → 13% |
| mash | 65% → 53% | Mira+ 100% → Mira 71% |
| circle | 22% → 15% | 21% → 25% |
| turtle | 72% → 29% | Vance+ 100% → Hex+ 79% |

**Still open.** Zoning, meaning holding long range and throwing every bomb and pod on cooldown, is still the
strongest simple plan against mid-ladder rivals (54–75%). It no longer beats Sable+ (25%). It is also a
legitimate strategy, not a bug. Hex+ (a beam trickster that holds range) is the most exploitable Rival+: turtle 79%,
zoner 75%. The next lever is giving the trickster a closing rule when it is being out-zoned.

## Ladder curve

Composite difficulty, meaning the bot win rate against each rival; lower is harder:

| | Dex | Mira | Vance | Hex | Sable | Dex+ | Mira+ | Vance+ | Hex+ | Sable+ |
|---|---|---|---|---|---|---|---|---|---|---|
| before | 99 | 38 | 47 | 33 | 22 | 76 | 41 | 55 | 39 | 13 |
| after | 99 | 26 | 35 | 16 | 14 | 70 | 27 | 29 | 27 | 10 |

- The smarter AI makes every rival tougher (by 10–25 points). Human telemetry against the *old* AI was Mira 50%, Hex 50–64%
  and Sable 25–60%, so there was headroom.
- Sable (story final) 1.0 → 0.9. She was the same pilot as Sable+, so the story ended on the hardest fight in the game.
- Dex+ 0.55 → 0.7. He was the easiest fight after Dex (76) even though Rival+ is the post-game.
- **Still open:** Mira (step 2) is still slightly harder than Vance (step 3). Lowering her skill below 0.45 turns off
  her setup logic and made her *more* erratic, not easier, so I left it. The clean fix is to swap ladder steps 2 and 3.
  That changes the unlock order (Mira unlocks Strider/cluster, Vance unlocks mines/Titan), so it's the owner's call.

## Survival

`survivalCfg` picked the rival with `Math.random()` from widening pools. One run could meet Bricktop three
times while another met Sovereign in round 4, and the **global survival leaderboard compared those runs
directly**. It now uses the fixed escalating schedule `SURVIVAL_ORDER` in `progression.ts`: dex, mira, vance, dex+, hex,
mira+, vance+, sable, hex+, sable+. After round 10 it cycles the hardest four. Healing stays at 25% between rounds.

## Part balance

The tournament itself had a measurement bug. Its "seed" only picked one of 9 scenarios, and `World`
ignores its seed, so each N=96 pairing replayed **18 distinct fights** about 5 times each. Its stated ±3–4 point
noise was really ±12. It now runs 144 declared scenarios (6 lanes × 4 tactics layouts with crates, walls,
trap pads and Core positions × 3 pilot styles × 2 sides). It also reports KO rate, average fight length and the
top and bottom two-slot combos.

Field win rate per part (target 42–58%):

| Slot | Part | old lab, old AI | new lab, new AI, old stats | **final** | vs default (final) |
|---|---|---|---|---|---|
| gun | pulse | 45% | 42% | 43% | 50% |
| gun | scatter | 53% | 51% | 53% | 43% |
| gun | rail | 53% | **60%** | 56% | 58% |
| gun | beam | 53% | 53% | 54% | 76% |
| gun | homer | 46% | 43% | 44% | 37% |
| bomb | mortar | 52% | 46% | 49% | 50% |
| bomb | cluster | 54% | 52% | 53% | 44% |
| bomb | napalm | 44% | 46% | 42% | 42% |
| bomb | bouncer | 50% | 56% | 55% | 57% |
| pod | seeker | 49% | 50% | 51% | 50% |
| pod | mine | 52% | **37%** | 45% | 30% |
| pod | turret | 43% | 48% | 46% | 45% |
| pod | interceptor | 56% | **65%** | 58% | 47% |
| body | striker | 50% | 53% | 49% | 50% |
| body | ironclad | 57% | 46% | 49% | 48% |
| body | wisp | 47% | 51% | 52% | 55% |
| body | regent | 46% | 49% | 50% | 48% |
| legs | stride | 51% | 51% | 51% | 50% |
| legs | hopper | 55% | 54% | 52% | 57% |
| legs | sprint | 46% | 54% | 52% | 60% |
| legs | anchor | 47% | **40%** | 44% | 36% |
| legs | feather | 51% | 51% | 51% | 50% |
| skill | lance | 48% | 49% | 50% | 50% |
| skill | wave | 54% | **59%** | 54% | 71% |
| skill | hook | 44% | **41%** | 46% | 50% |
| skill | frost | 56% | 58% | 57% | 59% |
| skill | blink | 48% | 43% | 44% | 49% |

- Field fights average 40.9 s, and 100% end by KO, so there are no time-outs or mirror stalemates.
- The best two-slot combo is beam + Skip Grenade at 67%; the worst is pulse + lance at 30%. Pulse is the
  starter gun, and its weakness is the reason to unlock guns.
- The stat changes and their reasons are in `docs/PART-IDENTITY.md`, under "Changes in the AI / balance audit pass".
- Aegis Drone was the clearest problem: its 8 s life outlasted its 7.5 s cooldown, so it was a permanent shield.
- Measured on the feel audit's landing-lag change (PR #66 `fighter.ts`), which is merged into this branch.
- The dash-to-shot gap of 0.22 s (`DASH_RECOVERY`) flagged by the feel audit didn't show up as a balance
  outlier in this data (Sprint, the two-dash legs, sits at 52%), so I left it alone.

## Progression pacing

- **Credits.** ~100 per match on average (win 120 + KO 30, loss 40, plus dodges and parries) and ~370 per day from dailies.
  - The day's 6-item shop stock cost ~1,900. A new pilot could buy all of it within ~45 minutes of their first
    session, and after that credits had nothing to buy until midnight.
  - **Shop prices ×1.5** (rounded to 50; 150–600 → 200–900). The model below now buys out the daily stock at ~70 minutes,
    and the full 30-item catalog takes ~140 matches instead of ~95.
  - Credits never buy parts or power (`isPartKey` guard), so this is purely cosmetic pacing.
- **First 2 hours.** The model (`node tools/econ.mjs <priceMul>`) assumes ~150 s per match loop and the ladder win rates above:
  - ladder done at ~35 minutes (~14 matches) and all Rival+ at ~110 minutes
  - mastery level 5 on the starter parts by ~100 minutes
  - staged starter skills granted after the 1st and 2nd ladder wins (minute 3 and 8)
  - No change to mastery: 300/800/1500/2500 XP is a fast first reward and a real long-term track.
- **Challenges**, sized from the 75 telemetry matches (0.19 parries/match, ~2 dodges/match, 41 of 43 wins under 60 s, median ~30 s):

| Challenge | Before | After | Why |
|---|---|---|---|
| Daily parry | 3 parries | 1 parry | ~16 matches of play for a daily |
| Weekly parry | 15 parries | 5 parries | ~80 matches, effectively impossible |
| Daily perfect-dodge | 8 | 5 | |
| Weekly perfect-dodge | 50 | 30 | |
| Daily fast win | under 60 s | under 40 s (`FAST_WIN_S`) | 95% of wins were already under 60 s, so it was just "win a match" |

## Unfinished / recommendations

1. Swap ladder steps 2 and 3 (Vance before Mira) for a smooth curve. This needs an owner decision because it changes the unlock order.
2. Make the trickster stop out-ranging zoners (Hex+: zoner 75%, turtle 79%).
3. Core captures per AI-vs-AI fight dropped from 0.58 to 0.34. Fights are shorter (38 s vs 42 s), so most see only the
   first activation, and dodging pilots drift off the pad. The Core is still contested, and corecamping is answered.
4. Arena hazards weren't exercised: the real arena factories need a WebGL renderer, so the lab uses lab geometry
   with each arena's tactics layout.

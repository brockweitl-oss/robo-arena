# Audit: online play, ranked, replays, save data

Scope: rollback netcode (`src/net/*`, the net paths in `src/game/match.ts`), the relay server
(`server/src/index.ts`), ranked seasons / Elo, the survival board, replay share links, local
replays, the save file, and general robustness (leaks, timers, error handling).
Branch `claude/audit-net`. Owner rules respected: no slow-mo, no hit-stop, no RNG in fights.

Severity: **S1** can void or mis-score a ranked result / lose progress / crash a client.
**S2** visible wrong behaviour under realistic conditions. **S3** hardening, abuse resistance, polish.

## Fixed

| # | Sev | Area | Finding | Repro | Fix |
|---|---|---|---|---|---|
| 1 | S1 | ranked | **A winner who closed the tab during the victory outro was scored as a forfeit loss.** The client only reported the result after the outro and results screen; the server counts leaving an unreported ranked match as a loss. | Ranked match, win, close the tab while VICTORY plays. | The match reports as soon as its end is confirmed (`Match.netFinish` → `netTryReport`). Server: a leaver who already reported a *win* is parked as `pending` until the stayer's own report arrives (agree → rated, disagree → not rated); a leaver who reported a loss/draw is settled on that report; leaving unreported is still a forfeit. e2e scenario 4 + relay test. |
| 2 | S1 | ranked | **A fast "Fight!" click wiped the clicker's report** (`ready` cleared `result`), so if the opponent reported later (slow machine, hidden tab) the match was never rated. | Ranked: win, click Fight! before the opponent's client reports. | `ready` keeps the report until the match settles; `start` clears both. Relay test. |
| 3 | S1 | ranked | **Room ranked state was memory-only.** After a Durable Object eviction / hibernation wake, `ranked=false, settled=true`, so results were ignored and leavers never forfeited. | Ranked room idle >10 s between `start` and the report (e.g. both tabs hidden), then report. | `ranked`, `settled` and `pending` are persisted with the start message and reloaded on wake (`Room.load`), including in `webSocketClose`. |
| 4 | S1 | online | **Alt-tab = disconnect.** A hidden tab stops `requestAnimationFrame`, so its sim and input stream froze; after 10 s the opponent got an unrated "forfeit", and on return the hidden player also forfeited. | Online match, switch tabs for 10 s. | `Game` pumps `Match.backgroundTick` from a 50 ms interval while `document.hidden` (sim + inputs only, no rendering). Chrome does not throttle timers for tabs playing audio. e2e scenario 3: 12 s hidden, +712 ticks, no forfeit, no desync. |
| 5 | S1 | online | **A doctored peer could crash or cheat the opponent.** `decodeInput` spread arbitrary JSON into the sim input (`moveX: 5` = speed hack accepted by both sims; strings/NaN poison the sim). Peer/start hellos were trusted: a part id like `"constructor"` resolves to `Object` in `resolveLoadout` and crashes the model builders; bad paint values reach three.js. | Send `{"t":"i","n":..,"i":{"moveX":5}}` or a hello with `loadout.gun:"constructor"`. | `decodeInput` keeps only known fields, clamps the stick to the replay grid and targets to quantized finite points (honest inputs round-trip unchanged, so a doctored client only desyncs itself). `sanitizeHello` / `sanitizeStart` clean names, parts and paint deterministically on both machines. Unit tests. |
| 6 | S1 | save | **A full localStorage silently stopped saving progress.** The telemetry mirror kept 3000 events (match_end events carry timelines and stats) and replays up to 8 full matches; once the ~5 MB quota filled, `writeSave` failed silently forever. | Long-time player (hundreds of matches). | Telemetry mirror capped at 400 events and dropped on any write failure; `writeSave` frees the telemetry mirror, then the replay list, and retries (returns success). Unit test with a quota-limited store. |
| 6b | S1 | memory | **Every match leaked ~30 GPU geometries and their materials**: the two intro drop capsules (14 meshes each) and the two guard-shield meshes were never disposed. 15 matches: 163 → 596 live geometries. | `node tools/leakcheck.mjs 15` | `Capsule.dispose` + shield disposal in `Match.dispose`. After: 155 → 156 geometries over matches 6–15 (flat). |
| 7 | S2 | save | A corrupt save (truncated write, manual edit) was replaced by a fresh save on the next write with no copy kept. | Corrupt `robo-arena-save-v1`, open the game. | The unreadable text is copied once to `robo-arena-save-corrupt` before anything overwrites it. |
| 8 | S2 | save | Settings were spread from the stored object untyped: `master: "loud"` → NaN volumes, `quality: "ultra"` → unknown renderer level. | Edit the save. | Every setting is typed and ranged in `migrateSave`. |
| 9 | S2 | replays | Saving a replay to a full store failed and lost the newest replay; unplayable old-version entries stayed in storage forever (invisible but using quota); re-opening a shared link stored duplicates. | Fill storage; or open the same `?replay=` link twice. | `saveReplay` drops invalid/old entries and duplicates, and drops the oldest until the newest fits. Unit tests. |
| 10 | S2 | queue | **Quick/ranked search could spin forever**: the queue socket's `onclose` was unhandled (server restart, network change, idle proxy), and a non-JSON frame threw. | Kill the relay while searching. | `onclose` before a match rejects (UI: "Could not reach the online server"); parse errors ignored. |
| 11 | S2 | queue | Lobby: a waiter whose connection had died made `peer.send` throw, failing the *new* player's join; a just-matched socket could be handed out twice while closing. | Waiter drops without a close frame, then someone queues. | Dead waiters are skipped (next-closest rating is tried); matched sockets are tagged and never re-paired. |
| 12 | S2 | online | The last <2 s of a match were never hash-checked (sums every 120 ticks, checks stopped at the confirmed end), so a late desync surfaced only as two different results. Observed once in 5 ranked e2e runs before this fix (players disagreed on the final HP; no desync flagged). | — | The end tick's state is hashed and compared during the outro; the ranked report waits for it (≤2.5 s). Hashes of an abandoned (rolled-back) timeline are discarded so a predicted end tick can never cause a false desync. |
| 13 | S2 | ranked UX | When the opponent left right after the result, the stayer saw only "Opponent left the match." and never learned the rating change. | Ranked: the other player closes the tab at the end. | The stayer waits up to 3 s for `rated` and shows `Rated: -32 (968).` |
| 14 | S3 | server | No flood control: a client could push unlimited messages through a room to the opponent and every spectator. | Script a socket. | 900 messages/s per player socket (normal play ≈ 62/s, catch-up after a stall ≈ 300/s); 64 spectators per room. |
| 15 | S3 | server | Client-sent `rating` / `placed` in a hello passed through to the opponent when the key was invalid (fake rank badge). | Hello with `rating: 5000` and a short key. | The server strips them; only its own ratings are attached. Relay test. |
| 16 | S3 | server | `/replay` uploads were unlimited per client (one script could evict all 5000 shared replays); the keep-latest trim scanned the table without an index on every upload. | — | 20 uploads/min per address (429), `replays_at` index. |
| 17 | S3 | server | The live-match directory only pruned stale rooms when someone opened the watch list. | — | Also pruned when a room goes live. |
| 18 | S3 | server | Unknown `winner` values in `result` were stored as-is; a socket close followed by an error event could run the forfeit logic twice. | — | `winner` ∈ {-2,-1,0,1} else -2; close is idempotent (`gone` flag). |
| 19 | S3 | client | `NetSession`: the ping interval kept running after the server's `left`; `sum`/`pong` frames were not type-checked; remote sums were unbounded. | — | Fixed in `online.ts`. |
| 20 | S3 | replays | Importing a replay file from another game version said "not a Robo Arena replay". | Import an older replay JSON. | "That replay was recorded on a different game version". |

## Verified, no change needed

- **KO / outro poses vs desync checks (the known suspicion).** Online, the victory/defeat poses and
  the KO camera only start in `netFinish`, after `netFrozen` is set: from then on there is no
  rollback and the state hashes compared are all for ticks at or before the confirmed end tick
  (now including the end tick itself, #12). The offline-only victory-pose branch is gated by
  `!this.net`. Real-time presentation never touches a hashed state, so it cannot void a ranked result.
- Damage, hazards, fire, pickups and the objective are all gated by `combatEnabled`, so the local
  free-run after the end cannot change HP.
- Elo: draws (0.5), forfeits (leaver loses), placements (K 64), new players (K 48) and the zero-sum
  rounding are correct; mismatched or `-2` reports are never rated; the same key on both seats is
  never rated. Season rollover uses UTC on both sides; a match that crosses midnight UTC on the 1st
  counts in the new month (reported at the end). Soft reset is applied per season gone by (cap 12).
- Spectators: late join replays the log at fast-forward; leaving/joining mid-round is clean; a new
  round swaps the input buffers without disturbing the match still on screen.
- Counter-picks online: picks travel over the room and the final builds go through the server's
  `start`, so a lost `cp` message cannot desync the next round.
- Replays: `validateReplay` rejects other rule versions, malformed RLE streams and unknown parts;
  seeking back re-runs from the start deterministically (`tools/replaycheck.mjs`).

## Measurements

**Rollback cost** (`World.step` / `snapshot` / `restore`, Node, busy 60-collider arena, this desktop
while other agents ran GPU tests): step 0.114 ms, snapshot 0.044 ms, restore 0.117 ms, digest
0.085 ms. Worst-case rollback frame (restore + 12 × (snapshot + step)) = **2.0 ms**; at a 4× slower
CPU ≈ 8 ms. The per-frame budget holds; snapshot/restore are not the bottleneck (the re-simulated
steps are), so the reflection-based snapshot was left as is (rewriting it risks determinism for
~0.5 ms at depth 12). Jittery e2e link (60–120 ms one way): max rollback depth 12, ~1.2 resimulated
ticks per rollback on average, no desync, 21/21 hash checks.

**Memory over 15 matches** (`tools/leakcheck.mjs 15 15`: six arenas, five rivals, AI vs AI, one page,
forced GC before each sample). Before: geometries 163 → 596 (+30 a match). After the fix:

| after match | 1 | 6 | 9 | 12 | 15 |
|---|---|---|---|---|---|
| JS heap (MB) | 84 | 61 | 52 | 58 | 53 |
| GPU geometries | 135 | 155 | 156 | 155 | 156 |
| textures | 59 | 91 | 95 | 99 | 103 |
| shader programs | 33 | 48 | 48 | 48 | 48 |
| DOM nodes | 148 | 148 | 148 | 148 | 148 |

The heap swings with the arena on screen (garden is heaviest) but does not climb. Textures still
creep up by ~1.3 a match after every arena was seen once (see "Not fixed").

## Not fixed (needs a decision or a bigger change)

- **Ranked trust model.** Results are accepted when both clients agree; keys are free to generate,
  so one person with two browsers can farm rating, and anyone can post any survival score ≤500.
  Making this robust needs server-side verification (e.g. the server re-simulating from inputs,
  which the deterministic sim makes possible) — a new system, out of scope.
- **Stall forfeits stay unrated.** If the opponent stops sending inputs for 10 s but keeps the
  socket open (frozen browser, tab hidden on a browser that throttles timers despite audio), the
  waiting player gets an unrated forfeit win. The server cannot tell who stalled without tracking
  input timing per seat.
- Spectators joining *between* rounds receive the previous round's start and log and watch it at
  fast-forward before the next one starts (harmless, slightly confusing).
- Two tabs of the game write the same save key; the last write wins.
- Textures grow by ~1.3 per match after warm-up (91 → 103 over matches 6–15); not traced yet. Most
  procedural textures are cached by key (`render/textures.ts`), so the remainder is probably a
  per-match canvas texture in an arena or robot builder.

## Deploy

The server changes are backward compatible with the live client (same messages; new behaviour only
on edge cases). **`cd server && npx wrangler deploy` is needed** for #1–#3, #11, #14–#18 to take effect.

# Claude ⇄ Codex coordination

We are two AI agents building Robo Arena 2.0 together. We hold each other to a high bar.

## Protocol

1. **One task = one GitHub issue = one branch = one PR.**
   - Claude's branches: `claude/<topic>`. Codex's branches: `codex/<task-id>`.
   - Each agent works in its own git worktree. Never edit the other agent's checkout.
2. **Every PR is reviewed by the other agent before merge.** The reviewer:
   - checks out the branch and runs the full check suite: `npx tsc --noEmit`, `npm test`, `npm run build`, `npm run test:e2e` with that branch's dev server
   - takes screenshots (`tools/shots.mjs`, `tools/autofight.mjs`) and actually looks at them
   - leaves a written review with `gh pr review`: concrete findings with file:line, screenshots for visual issues, and a verdict of **approve** or **request changes**
   - is direct and specific. Praise what's genuinely good; flag anything that looks like programmer art, breaks a contract, costs frame rate, or harms balance.
3. **Merging.** The author merges after approval and green CI, then deletes the branch. If the reviewer hasn't responded within one work session, Claude may merge a Codex PR after running the full check suite and posting the results in the PR.
4. **Contracts.** If you need something changed in a file the other agent owns, say so in a PR comment or issue. Don't edit it yourself. See `AGENTS.md` for file ownership.
5. **Status.** Keep the board below current: move your own rows and add a one-line note.
6. **`main` is the public play-test** (auto-deploys to GitHub Pages). It must always build and play.

## One game (owner, Nov 2 2026)

The owner chose the combined build (Codex's PT3/PT4 stack + Claude's skill shots) as **the** game. It is `main` at `fd2613e` and it is live.
- **`main` is the only trunk.** Every branch starts from the latest `origin/main`. No parallel candidate stacks, no long-lived feature stacks: small PRs, rebased often, merged into `main`.
- Gameplay feel is settled for now ("gameplay feels decent"). Keep combat real-time and deterministic: no slow motion, no hit-stop freezes, no randomness deciding fights.
- Older branches (`claude/combat-3`, `claude/combat-integrate`, `claude/skill-shots`) are superseded. Don't build on them.

## AAA visual push (current priority)

The goal is visuals at a AAA standard: models, graphics, animations and effects. Both agents work on visuals, split by folder so we never edit the same files:

| Area | Owner | Files |
|---|---|---|
| Mech models: silhouettes, armor layering, materials, damage states, skill emitter meshes | Codex | `src/robot/*` except the animator |
| Animation: locomotion, weapon stances, recoil, hit reactions, melee/charge, foot IK, boost flight | Codex | `src/robot/animator.ts` |
| Arena art: lighting dressing, set pieces, hazards | Codex | `src/arena/*` |
| Combat VFX: projectiles per weapon and skill, muzzle flashes, impacts, explosions, dash/boost trails, primer/combo effects, skill aim lanes and telegraphs | Claude | `src/vfx/*` |
| Rendering: post-processing, AO, color grade, shadows, quality tiers | Claude | `src/render/*` |

Shared bar for every visual PR: before/after screenshots from the gameplay camera, 60 fps at 1080p `medium`, zero console warnings, and the other agent reviews the screenshots. If you need a hook in the other agent's files (e.g. a new mount point for an effect), ask in an issue.

### Unified visual/replay handoff (issue #40)

Current follow-up: #43 merged at `ed193d0` after Claude code/image review and replay/fullscreen verification; #46 merged at `1505bef` with the Proving Grounds layout unchanged. The owner now says arenas are good and directs further work to **mech models**, with sleek powered armor and anime/real-robot influence. Issue #47 (`codex/reference-suits`) uses original generated references in `docs/visuals/mech-reference`; it preserves rig/gameplay contracts. No further arena scope is planned.

Claude's consolidated VFX follow-up is #45 (supersedes #41), with #42 for rendering. They remain review work until checked and merged into the same main. Existing local frozen port 5320 is not automatically updated by a source merge; promote a verified final artifact there without changing the save origin.

Codex's `codex/unified-visual-replay` starts from the combined `main`, including skill shots (ruleset 5). The completed V14 skill VFX and replay presentation edits predate the folder split above; issue #40 records this one-time handoff for Claude review. Subsequent VFX/render changes remain Claude-owned. No gameplay balance or simulation timing changes are included.

- F11 fullscreen with a visible toggle; four replay cameras (both player POVs, broadcast, free fly).
- Four skill emitter models, garage thumbnails, charge feedback and distinct skill projectiles; clipped aim lanes, harpoon reel and frost status visuals.
- Armor silhouette/material refinement, preserving the rig and collision envelope.
- Old stacked PRs #24–26/#34–35/#37 are already ancestors of main and have been closed. Divergent #32/#33 are superseded by the one-game decision. They are not alternate candidates to merge.
- Validation and screenshots are recorded in `docs/UNIFIED-VISUAL-UPDATE.md`. The existing local build remains frozen until the reviewed artifact passes verification.

## Status board

| Task | Owner | Status | Note |
|---|---|---|---|
| V1 Mech art overhaul (Vanguard/Strider/Paladin/Titan) | Codex | merged | #10; reviewed by Claude; art follow-up #15 |
| V1b Tapered layered armor follow-up | Codex | merged | #13; reviewed by Claude |
| V2 New part models | Codex | merged | #12; reviewed with G2 by Claude; follow-up #16 |
| V3 Damage states | Codex | review | #14 approved; integrated checks running |
| V4 Paint shop visuals | Codex | todo | Claude adds the `Paint` fields and save data |
| V5 Post-processing / lighting | Codex | todo | |
| V6 Combat readability VFX | Codex | todo | waits on Claude's G1 events |
| V7 Three new arenas | Codex | todo | |
| V8 Photo mode | Codex | todo | |
| V9 Garage/menu art pass | Codex | todo | after G2 and V2 |
| G1 Combat depth: parry, guard break, telegraph events, air/ground trade-off, down-gauge combos, wake-up attack, comeback, landing recovery, dash variety | Claude | in progress | |
| G2 Loadout depth: mass/weight, endurance, 9 new parts, family set bonuses, counter-hints, derived stats | Claude | in progress | |
| G3 Arena tactics: destructible cover, trap switches, pick-ups mode | Claude | todo | Codex does the visuals in V6 |
| G4 Balance lab: headless AI-vs-AI tournament across all loadouts, no build above a 55% win rate | Claude | todo | |
| G5 Modes: Rival+ ladder, survival, grades, practice room, replays, local versus | Claude | todo | |
| G6 Meta: challenges, credits shop, part mastery, achievements, profile, share codes, rebinding, aim-assist slider, off-screen threat arrows, hit confirmation | Claude | todo | |
| G7 Online: Cloudflare Worker + Durable Objects lobbies, rollback netcode, ranked Elo (D1) | Claude | todo | needs the owner's Cloudflare login |
| G8 CI: GitHub Actions (test, build, Pages deploy) | Claude | blocked | the owner must grant the `workflow` scope |

## Playtest 3 takeover — 2026-11-02

The owner authorized Codex to complete gameplay and visuals while Claude has no usage. This temporarily overrides the ownership/reviewer split above. Independent Codex agents reviewed combat and garage/arena changes; no Claude review is claimed. Local validation replaces unavailable hosted CI for this candidate.

| Release task | Status | Evidence |
|---|---|---|
| Tactical combat / weapon roles / deterministic AI | implemented, independently reviewed | directional 3D guard, attack commitments, dash costs, exact-tick replay |
| V1 full silhouette rebuild | implemented, visually reviewed | four classes, 16 viewer poses plus gameplay |
| V2/V3/V5/V6 base features | already integrated; PT3 corrections applied | part models, pooled damage, AO/shafts, telegraphs |
| V4 paint and V9 garage | implemented and browser verified | persistent finishes/colors, rendered thumbnails, five builds, v2 sharing |
| V7 arenas and predictable hazards | implemented and browser verified | all six arenas, exact supports, warning/active phases, zero warnings |
| V8 photo mode | implemented and browser verified | garage/results, controls, PNG export and context cleanup |
| G4 balance coverage | final matrix passed; tuning remains | pulse56/rail48%; varied deterministic scenarios, not universal PvP balance proof |
| G5/G6 modes and progression | integrated, regression checks | campaign/practice/survival/local versus/replays/save compatibility |
| G7 hosted online | outstanding | networking service and deployment access unavailable; local versus is included |
| G8 hosted CI | blocked | GitHub token lacks workflow scope |
| Separate head/core/arms/back stat sockets | outstanding | current garage exposes the actual five-slot loadout |
| Primer/detonator team combos | deferred by player | later feature |

See [PLAYTEST-3.md](PLAYTEST-3.md) for player notes, telemetry, release boundaries and final validation.


Frozen PT3 candidate c6a60a1 verified on http://127.0.0.1:5320/; final smoke and telemetry pass. PRs #23–26 remain draft pending performance acceptance; old PT2 remains on4317 after policy blocked replacement.

## Playtest 4 — ready local candidate
Owner closed PT3. Frozen pt4-4d05592 is live on5320 with save origin preserved;116tests, full frozen smoke, natural combo and manual-target replay verified. Claude Code design + bounded code reviews approved; PR #33 overlap/conflicting slowmo/RNG received written review. New PRs #34/#35 cover animations and mouse-aimed combo/effects integration. Main remains unchanged pending stack consolidation. See PLAYTEST-4.md.


- PR #49 projectile follow-up: Claude implemented pool lifecycle, exact skill width and reflected launch/cable fixes; Codex independently reviewed. 160 tests, TypeScript, build, e2e passed; 1080p medium 60 FPS, zero browser warnings/errors. Matched captures: docs/screenshots/pr49/. No gameplay changes.
### Renderer lifecycle follow-up (#52)

- `codex/render-review-fixes`: retain postprocessing passes across quality changes; Claude CLI implementation independently reviewed by Codex. TypeScript, 157 unit tests and production build pass. Browser quality-churn and full e2e pass: 12 quality changes retain pass/material identity and one listener per effect, zero console errors/warnings; 60 fps at 1080p medium. Evidence in docs/visuals/render-lifecycle; no deployment.

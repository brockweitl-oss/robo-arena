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

## Status board

| Task | Owner | Status | Note |
|---|---|---|---|
| V1 Mech art overhaul (Vanguard/Strider/Paladin/Titan) | Codex | review | codex/mech-visual-overhaul; 16 poses + match captured; issue #1 |
| V2 New part models | Codex | todo | waits on Claude's G2 (new part data) |
| V3 Damage states | Codex | todo | |
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

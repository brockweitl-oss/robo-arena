# Playtest 4 — deliberate combos, animation and mouse bomb aiming

Playtest 3 is complete. The owner requested this pass and explicitly added mouse control of the bomb landing point. Development is isolated on codex/pt4-combo-feedback; the frozen PT3 files remain untouched.

## Controls and combat

- Hold the mouse button bound to Bomb (default RMB), move the mouse to place the landing marker, release to throw. Keyboard/gamepad bomb taps retain the existing auto-target behavior. Losing pointer lock, pausing or losing focus cancels a held aim. Fast taps fall back to the normal throw rather than reuse an old target.
- Arc preview and actual launch share the same fixed-step ballistic planner and quantized target. Range, elevation and cover are represented. Bouncer preview shows its first landing, not subsequent homing hops. Moving fighters may intercept the flight.
- Clean damaging bomb/pod blasts prime a surviving standing target. A primer arms after 0.35s and expires after 2s. Further blasts do not refresh or stack it.
- Rail or a beam charged to 75% can detonate an armed primer. Reflected shots, turret shots, damage-over-time and hazards cannot. Bonus is 15% of post-shield base damage, capped 18 HP, added after ordinary damage without extra stagger/launch/knockback or slow motion.
- Perfect dodge, parry and frontal shot deflection clear the primer. Down/getup/death/reset/expiry also clear it. AI uses its existing delayed observations and weapon cooldowns for setup/follow-up decisions.

## Presentation

Weapon-specific recoil, precision support-arm bracing, alternating homer launches, heavier Titan torso response, and explicit charge anticipation/recovery. Animation stays visual; physical collision and foot IK are preserved.

Pooled primer badges/countdown arcs distinguish arming with open corners/dashes and readiness with a closed diamond. Detonation uses short outward streaks, dedicated animation and an honest incremental-damage popup. Maximum two extra combo-effect draws, no extra lights or simulation pauses. Practice and garage explain setup/finisher roles.

## Collaboration

Claude Code provided the initial deterministic combo contract and independently reviewed the implementation, finding no exploit/defense/lifecycle blockers. Claude identified the original knockdown-overlap payoff as too small; we replaced it with a smaller separately capped additive bonus. Codex reviewers found and corrected buffered aim-target loss, cover ordering and preview/simulation quantization mismatches. Review records are local Claude plan reports; no claim that Claude ran the browser suite.

## Validation

Final candidate results recorded below after integration. Existing PT3 roadmap exclusions (hosted online, CI deployment access, separate modular stat sockets) remain separate from this scoped local playtest. No hosted-online readiness claim.

## Verified behavior so far

- Claude's final bounded read-only review approved revised damage math, defenses, AI reaction gates, buffered mouse targets and replay encoding; no blockers in that scope. Separate Codex review fixed bomb wall-before-fighter collision with a regression.
- Natural browser combo: one bomb prime, one rail projectile, one 18 HP bonus, two total hits, one knockdown, primer consumed; Escape cancels targeting; zero console/shader errors.
- Manual mouse-bomb replay reproduced exactly 651/934 HP; input recording contains the selected landing coordinates under ruleset 4.
- Animation comparison captured PT3/PT4 pulse, rail, beam, homer and charge poses/videos. Review found stronger precision brace/recoil and no new foot-IK/clipping issue. Viewer phase timing corrected for faithful previews.
- Final balance: Pulse 55.52%, Scatter 42.71%, Rail 53.24%, Beam 54.34%, Homer 44.53% in the generated-build field; 180 scenarios per part and 1,800 field fights. Specific matchup outliers remain (interceptor 94% versus default but 54% field). This is deterministic scenario coverage, not proof of universal PvP balance.

Final source verification: 116 unit tests and TypeScript pass; full control/match smoke passes with all seven actions, 61 fps sampled, zero console problems. AI replay original 470/520 HP equals replay 470/520 HP. Uncapped 1080p medium Garden measured 151.7 fps, 617 aggregate draw calls across all render passes, 4.66ms mean render-call CPU time; no console warnings/errors. These hardware-specific results do not establish a mid-range-laptop guarantee.

Matched pacing audit: 36 identical scenario pairs against PT3 commit c6a60a1, all fights finished by KO. PT3 mean 47.774s vs PT4 mean 47.115s, 1.379% faster (within proposed ±5% gate). PT4 produced 35 combos and 474 bonus HP across the 36 matches. This compares the integrated AI/trajectory/combo changes, not isolated combo causality or human PvP outcomes.

## Frozen Playtest 4 release

Build `pt4-4d05592` is live at http://127.0.0.1:5320/. The verified temporary preview on 5321 passed natural combo/cancel, manual-target replay (759/960 HP exact) and full-match smoke (61 fps, zero console problems). The same artifact was promoted to the existing 5320 origin, preserving the user's save without stopping any server. PT3 static files were backed up to `test-results/frozen-pt3-c6a60a1` before promotion. A fresh natural combo/cancel check on 5320 passed; telemetry uses the PT4 build ID.

PRs: #34 animations and #35 combo/aim integration. The separate Claude integration PR #33 restores hit-stop/slow motion and probabilistic aim/spread, contrary to explicit instructions in this conversation; Codex posted a concrete coordination review rather than merging conflicting mechanics. Its heat/elemental/status/cancel expansion is not silently claimed as part of this build. Main/public hosting remains unchanged pending consolidation of the review stack. PT3 replays are incompatible with ruleset 4; save/loadout progress remains compatible.

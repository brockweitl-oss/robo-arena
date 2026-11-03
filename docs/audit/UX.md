# UX audit: screens, flows and HUD

Branch `claude/audit-ux`. Scope: every menu screen and flow, the guided first match, the in-match HUD and post-match insights. No new systems and no sim changes.

**Method.** I walked every screen with headless Playwright (GPU) from an empty save and from a veteran save (ladder cleared, 48k credits, 128 matches). I captured each one at 1280×720, 1920×1080, 2560×1440 and 1024×768. I drove the menus three ways: keyboard only, mouse only (hover and click), and a simulated standard gamepad that injects `navigator.getGamepads`. Each run also did two automated checks:

- **Off-screen and overlap check:** any `[data-nav]` element outside the viewport, and any overlap with the hints bar.
- **Focus-style check:** for every focusable element, toggle `.is-focus` and diff the computed styles. An element whose styles don't change has no visible focus state.

Results came from a full AI-vs-AI ladder match, rendered again at each resolution.

Screenshots for the main fixes are in `docs/audit/ux/`, as `*_before.jpg` / `*_after*.jpg` pairs at 1280×720: Free Battle, Modes, Practice (the after shot uses pad glyphs), Garage, Results, and the HUD over a bright arena.

Severity:
- **S1:** blocks or misleads a player.
- **S2:** clearly wrong or hurts usability.
- **S3:** polish.

## Fixed in this branch

| # | Sev | Where | Problem | Fix |
|---|-----|-------|---------|-----|
| 1 | S1 | Free Battle | **Continue / Garage / Back sat below the bottom edge at every 16:9 size**: 1280×720 (y 708–750), 1080p (1060–1124) and 1440p (1412–1497). The menu scales with `--u`, so a bigger screen didn't help. With a mouse, players had to know to press Enter. | Compacted the panel: shorter arena art strips, tighter section gaps, panel starts 0.8u higher. All four sections and the action row now fit at every size, including 1024×768. `free_before/after` |
| 2 | S1 | Modes | **The mode cards had no focus or hover state.** `.ra-tile`/`.md-card` had no styles, so keyboard and pad users moved blind. The initial focus also landed on the *locked* Rival+ card for every new player. | Gave the cards a panel style plus a clear orange focus state (dimmer for locked cards), and added a lock icon on locked titles. Initial focus now goes to the first unlocked mode. Locked cards use the shared `locked` nav flag (error shake), so there is no silent dead press. `modes_before/after` |
| 3 | S2 | Every screen | The **fullscreen button sat on top of the hints bar** and hid the last hint, usually "Esc Back". On the title screen it also hid the version number. It stayed on screen during matches, over the gameplay corner. | Hints bar and title footer now end left of the button. The button gets a class (`fs-toggle`) and is hidden while the match HUD is up. F11 still works everywhere. |
| 4 | S2 | Every screen | **Hint labels were low contrast:** grey `#8d99ab` text with no backing over the lit floor ("SELECT" was barely readable on the main menu and ladder). | Hints bar gets a dark backing pill, brighter label colour and an 11px minimum size. |
| 5 | S2 | Results | At 1280×720 the **rewards strip covered "Photo Mode"**: the action row was centred on the full width while the body column left room for the strip. Achievement toasts covered the player's name and HP at the top of the stats panel. | The action row now shares the body column's width and offset, and centres and wraps inside it. Achievement toasts moved to the empty top-left corner beside the banner. `results_before/after` |
| 6 | S2 | Practice, Online, Survival | These screens used the garage backdrop without a preview rect, so **the player's robot stood half behind the panel**. | They now use the title backdrop (robot on its plinth on the right), like Modes and Profile. |
| 7 | S2 | Practice | The arena picker was a button at the bottom of the drill list. Players picked a drill first and never noticed the arena. It only cycled forward, and the help text was a dense wall of jargon. | Arena is now the first row and a real ◀ ▶ selector: left/right on keys or d-pad, click to go forward, click the ◀ to go back. It's remembered between visits, and the hints bar shows "◀ ▶ Arena". Drill labels shortened. Note rewritten in plain words, and it now names every finisher (rail, a beam charged past 75%, Breaker Lance). |
| 8 | S2 | Local Versus | Robot choice was two separate "◀ Robot / Robot ▶" buttons, and the arena only cycled forward. | Both are ◀ ▶ selectors (pad left/right works). Added a "Change" hint. |
| 9 | S2 | Garage | The 6 slot tabs sat in a 5-column grid, so **LEGS wrapped onto its own row** and pushed the part list down (only about 2.5 parts visible at 720p). | 6-column tab row. One more part fits in the list. |
| 10 | S2 | Garage | The equipped chip read "✓ E", which looks like the **E key** (also the pod key). | Changed to "✓ ON". |
| 11 | S2 | Garage | Rival+ parts (Charge Beam, Arc Homer, Napalm, …) said just **"Locked"** with no way to learn how to earn them. | Now reads e.g. "Beat Jinx EX in Rival+ to unlock". |
| 12 | S2 | Guided match | The bomb step said "Hold LT to aim a bomb" on a gamepad. Hold-to-aim is mouse-only; a pad tap auto-targets. The prompt glyph also stayed on the old device after a mid-step switch between keyboard and pad. | Added a `padText` variant for the bomb step and simpler parry/guard wording. The prompt redraws when the input device changes. |
| 13 | S2 | Results insights | The "primes, 0 combos" tip said to "follow up with *your skill* or a direct gun hit". That's wrong: only rail, a beam charged past 75%, or a detonator skill (Breaker Lance) cash in a primer. Builds with no finisher got advice that could never work. | The tip lists the finishers the build actually has, or says the build has none and names the parts to equip. The title is now in plain words ("Primed 4 times, no combo"). The bomb tip explains tap vs mouse-hold. The pod tip no longer hard-codes "E / RB" (bindings can be changed). |
| 14 | S2 | HUD | The primer label said "NEED RAIL / BEAM" even when the attacker had Breaker Lance, which does detonate. | Finisher check includes detonator skills. Label reads "NO FINISHER EQUIPPED" when it's true. |
| 15 | S2 | HUD | **Small HUD labels were unreadable over bright skies and sand** (Lantern Terrace sunset, Proving Grounds): the "DOWN" label, rival cooldown chips, dial labels and key caps had no shadow, at 60–70% opacity. | Added dark halos and higher opacity. Key caps sit on a dark chip instead of 11% white. |
| 16 | S2 | HUD | The "DOWN" meter label was jargon. The rival chip row had no label, and its "GUARD" chip didn't match the player dial's "CHARGE" for the same action. | Label now reads **KNOCKDOWN**. The chip row gets a small "RIVAL" caption, and the chip reads CHARGE. |
| 17 | S3 | HUD | At 2560×1440 the fixed-pixel weapon dials, labels and status lines were tiny. The controls hint was `nowrap`, so it could run off narrow screens. | A min-height 1300px media query scales the bottom cluster by 1.3× and bumps the status text. The hint wraps within 92vw. |
| 18 | S3 | HUD | Reduced motion was respected in menus but not in the HUD. The lock reticle spins forever, and the low-HP bar, timer warning and core countdown pulse. | `prefers-reduced-motion` turns those loops off. |
| 19 | S3 | Survival | No "move" hint even though there are two buttons. The best run was buried in body text. | Move hint added. Best run is shown as a gold headline. |
| 20 | S3 | Main menu | The Garage blurb omitted skills, paint and presets. The Modes blurb led with Rival+ (locked for new players) and didn't mention Online. | Both rewritten. |
| 22 | S3 | HUD | "PUNISH WINDOW 0.0s" showed for windows under 0.05 s, and the "CORE IN 19s" objective line was 55% opacity grey on light skies. | Durations under 0.05 s are hidden, and the core line gets a halo and 80% opacity. |
| 23 | S3 | Results | No Esc hint, although Esc goes to the main menu. | Added an "Esc Main Menu" hint (not on the champion screen, where Esc does nothing). |
| 21 | S3 | Ending | "Five rivals. **Three arenas.**" There are six arenas now. | The line no longer counts arenas. |

## Found, not fixed here (other owners or out of scope)

| Sev | Where | Problem | Suggested fix | Owner |
|-----|-------|---------|---------------|-------|
| S2 | Match start | The 5-second control strip ("Click to capture mouse · LMB auto-gun · Hold R + mouse: aim skill, release: fire · Hold RMB: aim bomb · E pod · Shift dash · Q charge") is one long line that is hard to read mid-intro. It is hard-coded to default keys and ignores rebinding. | Build it from `bindings` with `keyName`, and split it into two lines (attack / move). Text lives in `src/game/match.ts` `showHint(...)`. Left alone to avoid conflicts with the combat-feel agent. | combat/feel |
| S2 | HUD | A status line is always shown under the player ("DASH READY · 1/1", "ACTION COMMITTED", "COMMITTED · DASH LOCKED"). There are also "PUNISH WINDOW 0.3s" and "RECOVERY 0.1s" lines under each bar. That is a lot of always-on text for a new player. | Show the mobility line only when dash is *unavailable*, and hide the punish/recovery lines unless the window is at least 0.25 s. Or move all of it behind a "Detailed combat readouts" setting that is on in Practice. | combat/feel |
| S3 | Survival | The rival pool pick uses `Math.random()` (menu-side, not combat). | Use the round number and a run seed if seeded runs or shareable boards matter. | AI/progression |
| S3 | Results | Results is still dense: banner, HP, 6 stat rows, grade, quote, 2–3 tips, rewards, mastery for 6 parts, challenges and 6 buttons. | Collapse the mastery list to the parts that levelled up (plus "+120 XP to 6 parts"), and drop the per-row grade breakdown into a tooltip. | UX follow-up |
| S3 | Online | The "CODE" field looks like a disabled button. "Ranked rating: …" stays on "…" until the fetch settles. | Style the input as a field and show "Checking rating…" text. | UX follow-up |
| S3 | Local Versus | P1's robot still stands behind the panel (versus backdrop puts P1 on the left). | A left-aligned panel plus a backdrop offset, or a narrower panel. | visuals |
| S3 | Profile | "Pilot level 1 *of 109*": the cap reads as an odd number. | Show the XP to the next level instead. | progression |

## Verified fine

- **Keyboard:** Esc/Backspace backs out of every screen. Title → main → ladder → intro → FIGHT is 5 presses for a new pilot. Focus is restored on returning to the main menu, and hover never steals focus without real mouse movement.
- **Gamepad:** with the simulated pad, the d-pad moves focus, A confirms, B backs out, and the hints switch to pad glyphs. Left/right drives the new selectors.
- **Console:** no console errors or warnings on any screen or resolution in either save.
- **1024×768:** every screen fits and nothing is off-screen; the type is small but readable.

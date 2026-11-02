# Reference-led suit update

The four original suits now use swept, overlapping armor instead of rounded shoulder caps and flat chest plaques. Vanguard has a compact layered silhouette; Strider keeps flight fins and light armor; Paladin has longer pauldrons and a blade crest; Titan has broader armor and a recessed industrial reactor.

## Implementation

- Added convex armor geometry with an actual raised interior surface, smooth front shading, and hard bevel boundaries.
- Rebuilt helmets, chest layers, shoulders, forearm shells, waist plates, and back armor. Scapular plates and framed thrusters improve the view from the gameplay camera.
- Refined thigh, knee, split-shin, rear-leg, and foot armor. Hopper retains its reverse joints and exposed springs.
- Replaced the default mortar's oversized casing with a narrower throat and layered breech.

Existing rig joints, gameplay collision dimensions, leg lengths, nozzle anchors, skill mounts, mortar pivot, and bomb muzzle position remain unchanged. The visual lock-on point moved from local head Y 0.31 to 0.28 to match the shorter helmet. The added thruster trim lip uses the same exit transform as the existing ring and nozzle anchor. Paint choices remain supported. These are presentation changes; combat rules are unchanged.

## References and evidence

The generated images in `docs/visuals/mech-reference/` are design references. They establish proportions and armor direction; they are not screenshots or a claim that the simplified runtime models reproduce their rendering fidelity.

Actual runtime images are in `docs/visuals/reference-suits/`. `before/` contains the preceding main-branch models. `after/` contains controlled comparisons with the same paint and default legs. `presentation/` uses distinct existing rival paints and role-specific legs, plus hopper front/side/back/run checks. Exact capture settings and FPS samples are recorded in the manifests.

## Validation

- TypeScript check: passed.
- Unit tests: 175 passed.
- Production build: passed (Vite, 117 modules).
- Final end-to-end smoke: passed; all actions and a 45-second match, 60 FPS, zero console problems (final 7db1a31 run).
- Latest presentation captures: 59.36–60.62 FPS at 1600×1000, medium quality; zero browser warnings or errors.
- Geometry tests cover all frame/leg combinations, finite geometry, mount stability, and leg dimensions. Screenshots were inspected for armor clearance and grounded feet.

Final uncapped 1920×1080 medium-quality Garden benchmark: 124.23 FPS across 1,382 frames, 5.66 ms average CPU render time, 702.12 aggregate render calls, and zero browser problems. Geometry count ranged from 389 to 440 during combat; this short sample is not a leak test. The aggregate draw count exceeds the original 150–250 target despite meeting the measured FPS target on this machine. Raw results are in `docs/visuals/reference-suits/performance-1080p.txt`.

The capture FPS values are short samples, not a hardware-independent performance guarantee. Viewer draw-call counters reflect the final postprocessing pass and are not aggregate match draw counts.



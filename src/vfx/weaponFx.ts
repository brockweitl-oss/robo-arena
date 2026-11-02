import * as THREE from 'three';
import type { Effects } from './effects';

/**
 * Per-weapon effect recipes. Every gun, skill, bomb, pod, body charge and item has its own
 * signature built from the shared pooled systems (sparks, smoke, rings, fireballs, flares).
 * Presentation only: nothing here reads or writes sim state, and randomness is visual.
 */
const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Any unit vector perpendicular to `d`. */
function perp(d: THREE.Vector3, out: THREE.Vector3) {
  return out.set(-d.z, 0, d.x).lengthSq() > 1e-4 ? out.normalize() : out.set(1, 0, 0);
}

interface Delayed { t: number; fn: () => void }

export class WeaponFx {
  private queue: Delayed[] = [];

  constructor(private fx: Effects) {}

  /** Run `fn` after `t` seconds (cluster chains, after-shocks). */
  later(t: number, fn: () => void) {
    this.queue.push({ t, fn });
  }

  update(dt: number) {
    for (let i = this.queue.length - 1; i >= 0; i--) {
      const q = this.queue[i];
      q.t -= dt;
      if (q.t <= 0) {
        this.queue.splice(i, 1);
        q.fn();
      }
    }
  }

  clear() {
    this.queue.length = 0;
  }

  /* ------------------------------------------------------------------ guns: muzzle */

  muzzle(look: string, pos: THREE.Vector3, dir: THREE.Vector3, color: number) {
    const { sparks, smoke } = this.fx;
    switch (look) {
      case 'blaster': {
        // tight plasma pop: hot star, a muzzle ring facing the shot, a few forward darts
        sparks.emit({ pos, count: 1, size: [0.5, 0.6], life: [0.05, 0.07], color: 0xffffff, color2: color, intensity: 3.5 });
        this.fx.ring(pos, dir, color, 0.05, 0.42, 0.1, 0.9);
        sparks.emit({ pos, count: 5, dir, cone: 0.85, speed: [12, 22], size: [0.06, 0.09], life: [0.05, 0.1], color: 0xffffff, color2: color, intensity: 3, stretch: 0.04 });
        this.fx.lightFlash(pos, color, 10, 0.06);
        break;
      }
      case 'scatter': {
        // wide shotgun bloom: fan of hot pellets, a fat orange flash and a smoke puff
        sparks.emit({ pos, count: 1, size: [1.2, 1.4], life: [0.08, 0.11], color: 0xfff0c0, color2: 0xff8a2a, intensity: 3 });
        sparks.emit({ pos, count: 18, dir, cone: 0.55, speed: [10, 24], size: [0.05, 0.08], life: [0.08, 0.18], color: 0xffe0a0, color2: color, intensity: 3, stretch: 0.03, drag: 3 });
        smoke.emit({ pos, count: 4, dir, cone: 0.6, speed: [1.5, 4], size: [0.25, 0.4], grow: 2.6, life: [0.35, 0.6], color: 0x6c6a66, alpha: 0.4, drag: 4, gravity: -0.6, spin: 1.5 });
        this.fx.flare(pos, 0xffa040, 0.9, 6, dir, 0.6);
        this.fx.lightFlash(pos, 0xffa040, 26, 0.09);
        break;
      }
      case 'rail': {
        // hyper-velocity crack: long white spike, sideways vent jets, shock ring
        sparks.emit({ pos, count: 1, size: [1.2, 1.4], life: [0.07, 0.09], color: 0xffffff, intensity: 4 });
        sparks.emit({ pos, count: 3, dir, cone: 0.995, speed: [60, 80], size: [0.25, 0.32], life: [0.05, 0.07], color: 0xffffff, color2: color, intensity: 5, stretch: 0.05 });
        perp(dir, _a);
        for (const s of [-1, 1]) {
          _b.copy(_a).multiplyScalar(s).addScaledVector(dir, -0.2).normalize();
          smoke.emit({ pos, count: 3, dir: _b, cone: 0.8, speed: [3, 6], size: [0.18, 0.28], grow: 2.4, life: [0.3, 0.55], color: 0xcfd8e0, alpha: 0.35, drag: 5 });
          sparks.emit({ pos, count: 4, dir: _b, cone: 0.85, speed: [5, 10], size: [0.04, 0.06], life: [0.1, 0.2], color, intensity: 3, stretch: 0.03, drag: 4 });
        }
        this.fx.ring(pos, dir, color, 0.1, 0.6, 0.14, 0.45);
        this.fx.flare(pos, color, 1.6, 4, dir, 0.9);
        this.fx.lightFlash(pos, color, 36, 0.1);
        break;
      }
      case 'beam': {
        // focusing emitter: a ring that collapses onto the core, then a sustained glare
        this.fx.ring(pos, dir, color, 0.9, 0.05, 0.14, 0.9);
        this.fx.ring(pos.clone().addScaledVector(dir, 0.25), dir, 0xffffff, 0.6, 0.05, 0.1, 0.7);
        sparks.emit({ pos, count: 1, size: [0.9, 1.1], life: [0.12, 0.16], color: 0xffffff, color2: color, intensity: 4 });
        sparks.emit({ pos, count: 10, spread: 0.5, vel: dir.clone().multiplyScalar(-1.5), speed: [0.5, 1.5], size: [0.05, 0.08], life: [0.12, 0.22], color, intensity: 3, drag: 6 });
        this.fx.lightFlash(pos, color, 28, 0.14);
        break;
      }
      case 'homer': {
        // twin tube launch: two offset back-blasts with smoke, small forward kick
        perp(dir, _a);
        for (const s of [-0.12, 0.12]) {
          _b.copy(pos).addScaledVector(_a, s);
          sparks.emit({ pos: _b, count: 1, size: [0.4, 0.5], life: [0.05, 0.08], color: 0xfff0d0, color2: color, intensity: 3 });
          smoke.emit({ pos: _b, count: 3, dir: dir.clone().negate(), cone: 0.7, speed: [2, 5], size: [0.15, 0.25], grow: 3, life: [0.4, 0.8], color: 0x8a8a8f, alpha: 0.4, drag: 3, gravity: -0.4, spin: 1 });
        }
        sparks.emit({ pos, count: 6, dir: dir.clone().negate(), cone: 0.7, speed: [4, 9], size: [0.05, 0.08], life: [0.1, 0.2], color: 0xffc070, intensity: 2.5, stretch: 0.03, drag: 3 });
        this.fx.lightFlash(pos, color, 14, 0.08);
        break;
      }
      default:
        this.fx.muzzle(pos, dir, color, false);
    }
  }

  /* --------------------------------------------- projectiles: wall / ground impacts */

  impact(look: string, pos: THREE.Vector3, normal: THREE.Vector3, color: number) {
    const { sparks, smoke } = this.fx;
    switch (look) {
      case 'blaster':
      case 'turret':
        sparks.emit({ pos, count: 1, size: [0.6, 0.7], life: [0.06, 0.08], color: 0xffffff, color2: color, intensity: 3 });
        this.fx.ring(pos.clone().addScaledVector(normal, 0.03), normal, color, 0.05, 0.55, 0.16, 0.9);
        sparks.emit({ pos, count: 8, dir: normal, cone: 0.4, speed: [3, 9], size: [0.04, 0.07], life: [0.15, 0.3], color: 0xffffff, color2: color, intensity: 3, stretch: 0.03, drag: 2, gravity: 10 });
        this.fx.lightFlash(pos, color, 6, 0.08);
        break;
      case 'scatter':
        // pellets: cheap puffs of dust and a couple of ricochets each
        sparks.emit({ pos, count: 3, dir: normal, cone: 0.5, speed: [4, 10], size: [0.03, 0.05], life: [0.1, 0.2], color: 0xffe0a0, intensity: 2.5, stretch: 0.03, gravity: 14 });
        smoke.emit({ pos, count: 1, dir: normal, speed: [0.3, 0.8], size: [0.15, 0.25], grow: 2, life: [0.3, 0.5], color: 0x7a746c, alpha: 0.35, drag: 2 });
        break;
      case 'rail':
      case 'lance':
        // punch-through: deep crater flash, chunks, a long spray and a scorch mark
        sparks.emit({ pos, count: 1, size: [1.6, 1.9], life: [0.08, 0.1], color: 0xffffff, color2: color, intensity: 4 });
        sparks.emit({ pos, count: 22, dir: normal, cone: 0.55, speed: [8, 22], size: [0.05, 0.08], life: [0.2, 0.5], color: 0xffffff, color2: color, intensity: 3.5, stretch: 0.05, drag: 1.5, gravity: 14 });
        this.fx.ring(pos.clone().addScaledVector(normal, 0.03), normal, color, 0.1, 0.9, 0.22, 0.55);
        this.fx.debris(pos, 5, 7);
        smoke.emit({ pos, count: 4, dir: normal, speed: [0.5, 2], size: [0.4, 0.6], grow: 2.4, life: [0.6, 1.1], color: 0x5c5a58, alpha: 0.4, drag: 2, gravity: -0.6, spin: 1 });
        this.fx.scorch(pos, 0.9);
        this.fx.lightFlash(pos, color, 22, 0.14);
        break;
      case 'beam':
        // molten splash: glowing droplets arc out and fall, lingering heat glow
        sparks.emit({ pos, count: 1, size: [1.2, 1.4], life: [0.2, 0.28], color: 0xffffff, color2: color, intensity: 3 });
        sparks.emit({ pos, count: 16, dir: normal, cone: 0.3, speed: [3, 8], size: [0.06, 0.1], life: [0.4, 0.8], color: 0xfff0c0, color2: 0xff6a20, intensity: 3, gravity: 18, drag: 0.6 });
        sparks.emit({ pos, count: 3, spread: 0.1, speed: [0, 0.2], size: [0.5, 0.7], grow: 1.4, life: [0.5, 0.8], color, intensity: 1.4 });
        this.fx.scorch(pos, 0.8);
        this.fx.lightFlash(pos, color, 18, 0.25);
        break;
      case 'homer':
        this.fx.fireballs.spawn(pos.clone().addScaledVector(normal, 0.2), 0.45, color, 0.35);
        sparks.emit({ pos, count: 12, dir: normal, cone: 0.3, speed: [4, 10], size: [0.05, 0.08], life: [0.2, 0.45], color: 0xffd080, color2: color, intensity: 3, stretch: 0.03, gravity: 14 });
        smoke.emit({ pos, count: 4, dir: normal, speed: [0.6, 1.8], size: [0.35, 0.5], grow: 2.6, life: [0.7, 1.2], color: 0x45403c, alpha: 0.45, drag: 2, gravity: -0.8, spin: 1 });
        this.fx.lightFlash(pos, color, 20, 0.15);
        break;
      case 'wave':
        // ion wall breaking on a surface: a wide flat ring of crackle
        this.fx.ring(pos.clone().addScaledVector(normal, 0.05), normal, color, 0.3, 1.5, 0.28, 0.5);
        sparks.emit({ pos, count: 18, spread: 0.8, speed: [1, 4], size: [0.05, 0.08], life: [0.15, 0.35], color: 0xe8f4ff, color2: color, intensity: 3, stretch: 0.03, drag: 3 });
        this.fx.lightFlash(pos, color, 16, 0.14);
        break;
      case 'hook':
        // harpoon bite: hard metal clank sparks and grit
        sparks.emit({ pos, count: 16, dir: normal, cone: 0.35, speed: [6, 14], size: [0.04, 0.07], life: [0.15, 0.35], color: 0xffe2b0, intensity: 3.5, stretch: 0.05, gravity: 16 });
        smoke.emit({ pos, count: 2, dir: normal, speed: [0.4, 1.2], size: [0.25, 0.35], grow: 2, life: [0.4, 0.7], color: 0x6a645c, alpha: 0.4 });
        this.fx.debris(pos, 2, 5);
        break;
      case 'frost':
        this.frostBurst(pos, normal, color, 0.8);
        break;
      default:
        this.fx.impact(pos, normal, color, 0.8);
    }
  }

  /* -------------------------------------------------------- hits on robots, per weapon */

  /** Signature layer on top of the shared hit spark (which sells the contact itself). */
  hit(look: string | undefined, source: string, pos: THREE.Vector3, dir: THREE.Vector3, color: number, heavy: boolean) {
    const { sparks, smoke } = this.fx;
    switch (look) {
      case 'blaster':
      case 'turret':
        this.fx.ring(pos, dir.clone().negate(), color, 0.1, 0.9, 0.14, 0.8);
        break;
      case 'scatter':
        sparks.emit({ pos, count: 8, spread: 0.35, speed: [2, 6], size: [0.04, 0.06], life: [0.1, 0.2], color: 0xffd090, intensity: 3, stretch: 0.03 });
        break;
      case 'rail':
        // the round goes through: exit spray out of the far side
        sparks.emit({ pos, count: 18, dir, cone: 0.8, speed: [14, 28], size: [0.05, 0.08], life: [0.12, 0.3], color: 0xffffff, color2: color, intensity: 4, stretch: 0.06, drag: 1.5 });
        this.fx.flare(pos, color, 2.2, 6, dir, 0.85);
        break;
      case 'beam':
        // armor glows hot where the beam lands
        sparks.emit({ pos, count: 2, spread: 0.1, size: [0.7, 0.9], grow: 1.3, life: [0.35, 0.5], color: 0xffa060, intensity: 1.8 });
        sparks.emit({ pos, count: 10, dir: dir.clone().negate(), cone: 0.4, speed: [2, 6], size: [0.05, 0.08], life: [0.3, 0.6], color: 0xfff0c0, color2: 0xff6a20, intensity: 3, gravity: 16 });
        break;
      case 'homer':
        this.fx.fireballs.spawn(pos, 0.4, color, 0.3);
        smoke.emit({ pos, count: 3, speed: [0.5, 1.5], size: [0.3, 0.45], grow: 2.4, life: [0.6, 1], color: 0x45403c, alpha: 0.45, drag: 2, gravity: -0.8 });
        break;
      case 'frost':
        this.frostBurst(pos, dir.clone().negate(), color, 1);
        break;
      case 'wave':
        this.fx.ring(pos, dir.clone().negate(), color, 0.3, 2, 0.24, 0.8);
        break;
      case 'mortar': case 'cluster': case 'napalm': case 'bouncer': case 'seeker': case 'mine':
        // ordnance hits are sold by the explosion; add body-shrapnel only
        sparks.emit({ pos, count: 10, speed: [4, 10], size: [0.04, 0.07], life: [0.2, 0.4], color: 0xffd090, intensity: 3, stretch: 0.03, gravity: 14 });
        break;
      default:
        if (source === 'charge') this.fx.ring(pos, dir.clone().negate(), 0xffffff, 0.2, heavy ? 2.6 : 1.6, 0.2, 0.9);
    }
  }

  private frostBurst(pos: THREE.Vector3, normal: THREE.Vector3, color: number, k: number) {
    const { sparks, smoke } = this.fx;
    // ice shards: hard white-blue splinters that fall, a frost ring and cold mist
    sparks.emit({ pos, count: Math.round(14 * k), dir: normal, cone: 0.25, speed: [4, 11], size: [0.05, 0.09], life: [0.3, 0.6], color: 0xffffff, color2: color, intensity: 2.6, stretch: 0.05, gravity: 18 });
    this.fx.ring(pos.clone().addScaledVector(normal, 0.04), normal, 0xdff8ff, 0.1, 0.9 * k, 0.28, 0.55);
    smoke.emit({ pos, count: Math.round(4 * k), dir: normal, speed: [0.3, 1.2], size: [0.35, 0.55], grow: 2.2, life: [0.6, 1.1], color: 0xcfefff, alpha: 0.3, drag: 2, gravity: 0.4, spin: 0.6 });
    this.fx.lightFlash(pos, color, 12, 0.12);
  }

  /* ------------------------------------------------------- explosions, per ordnance */

  explosion(look: string | undefined, pos: THREE.Vector3, radius: number, color: number, big: boolean, onGround: boolean) {
    const { sparks, smoke } = this.fx;
    switch (look) {
      case 'cluster': {
        // carrier pop, then a ragged chain of small blasts around the impact
        this.fx.explosion(pos, radius * 0.6, color, false, onGround);
        const n = 4;
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2 + rnd(-0.4, 0.4);
          const r = radius * rnd(0.45, 0.9);
          const p = pos.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.1, Math.sin(a) * r));
          this.later(0.06 + i * 0.05, () => {
            this.fx.fireballs.spawn(p, radius * 0.28, color, 0.35);
            sparks.emit({ pos: p, count: 10, speed: [4, 10], size: [0.05, 0.08], life: [0.2, 0.45], color: 0xfff0b0, color2: color, intensity: 3, stretch: 0.03, gravity: 16 });
            smoke.emit({ pos: p, count: 2, speed: [0.5, 1.5], size: [0.4, 0.6], grow: 2.2, life: [0.7, 1.2], color: 0x3a3634, alpha: 0.45, gravity: -1 });
            this.fx.lightFlash(p, color, 18, 0.12);
          });
        }
        break;
      }
      case 'napalm': {
        // low, wide incendiary splash: liquid fire droplets arc out; heavy black smoke
        this.fx.fireballs.spawn(pos.clone().add(new THREE.Vector3(0, radius * 0.1, 0)), radius * 0.6, 0xff6a10, 0.8);
        sparks.emit({ pos, count: 1, size: [radius * 1.4, radius * 1.6], life: [0.08, 0.1], color: 0xffd080, intensity: 2.5 });
        sparks.emit({ pos, count: 46, dir: UP, cone: 0.15, speed: [5, 12], size: [0.16, 0.26], life: [0.6, 1.1], color: 0xffd060, color2: 0xff3a00, intensity: 3.2, gravity: 20, drag: 0.4, stretch: 0.02 });
        for (let i = 0; i < 5; i++) this.fx.fireballs.spawn(pos.clone().add(new THREE.Vector3(rnd(-1, 1) * radius * 0.7, 0.2, rnd(-1, 1) * radius * 0.7)), radius * 0.22, 0xff6a10, rnd(0.5, 0.8));
        smoke.emit({ pos, count: 14, spread: radius * 0.4, speed: [1, 3], size: [radius * 0.4, radius * 0.6], grow: 2.4, life: [1.4, 2.4], color: 0x141210, color2: 0x2c2420, alpha: 0.6, drag: 2, gravity: -1.8, spin: 0.6 });
        if (onGround) {
          this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.06, 0)), UP, 0xff7a20, 0.3, radius * 1.4, 0.45, 0.9);
          this.fx.scorch(pos, radius * 1.6);
        }
        this.fx.lightFlash(pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 0xff6a10, 70, 0.5);
        break;
      }
      case 'bouncer': {
        // kinetic charge: crisp white-blue flash, double shock ring, almost no smoke
        sparks.emit({ pos, count: 1, size: [radius * 1.4, radius * 1.6], life: [0.06, 0.08], color: 0xffffff, color2: color, intensity: 4 });
        this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.1, 0)), UP, color, 0.2, radius * 1.5, 0.22, 1);
        this.later(0.08, () => this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.12, 0)), UP, 0xffffff, 0.2, radius * 2.1, 0.3, 0.7));
        this.fx.ring(pos, new THREE.Vector3(0, 0, 1), color, 0.2, radius * 1.1, 0.2, 0.7);
        sparks.emit({ pos, count: 36, speed: [10, 22], size: [0.05, 0.08], life: [0.15, 0.35], color: 0xffffff, color2: color, intensity: 4, stretch: 0.05, drag: 2 });
        this.fx.flare(pos, color, radius * 1.4, 8);
        this.fx.lightFlash(pos, color, 60, 0.18);
        if (onGround) this.fx.dustRing(pos, radius * 0.8, 10);
        break;
      }
      case 'mine': {
        // shaped charge: flat shrapnel disc skimming the ground, short flame
        this.fx.fireballs.spawn(pos.clone().add(new THREE.Vector3(0, 0.3, 0)), radius * 0.45, color, 0.4);
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          sparks.emit({ pos, count: 1, vel: new THREE.Vector3(Math.cos(a), 0.08, Math.sin(a)).multiplyScalar(rnd(12, 20)), size: [0.05, 0.08], life: [0.2, 0.35], color: 0xffffff, color2: color, intensity: 3.5, stretch: 0.05, drag: 2 });
        }
        this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.06, 0)), UP, color, 0.2, radius * 1.6, 0.25, 1);
        this.fx.dustRing(pos, radius, 14);
        this.fx.scorch(pos, radius);
        this.fx.lightFlash(pos, color, 40, 0.2);
        break;
      }
      case 'seeker': {
        // missile warhead: tight bright core, a sharp flare and a quick smoke ball
        this.fx.fireballs.spawn(pos, radius * 0.6, color, 0.45);
        sparks.emit({ pos, count: 1, size: [radius * 1.2, radius * 1.4], life: [0.06, 0.08], color: 0xffffff, intensity: 3 });
        sparks.emit({ pos, count: 28, speed: [8, 18], size: [0.05, 0.08], life: [0.2, 0.5], color: 0xfff0b0, color2: color, intensity: 3.5, stretch: 0.04, gravity: 14 });
        smoke.emit({ pos, count: 6, spread: radius * 0.3, speed: [0.8, 2.4], size: [radius * 0.35, radius * 0.5], grow: 2.2, life: [0.8, 1.4], color: 0x3c3836, alpha: 0.5, gravity: -1.2, spin: 1 });
        this.fx.flare(pos, color, radius * 1.3, 6);
        this.fx.lightFlash(pos, color, 45, 0.22);
        if (onGround) this.fx.scorch(pos, radius);
        break;
      }
      case 'trap': {
        // electric discharge: a column of crackle and a yellow shock ring
        for (let i = 0; i < 10; i++) sparks.emit({ pos: pos.clone().add(new THREE.Vector3(rnd(-0.7, 0.7), rnd(0, 0.4), rnd(-0.7, 0.7))), count: 1, vel: new THREE.Vector3(rnd(-3, 3), rnd(24, 34), rnd(-3, 3)), size: [0.1, 0.14], life: [0.08, 0.12], color: 0xffffff, color2: color, intensity: 5, stretch: 0.06 });
        sparks.emit({ pos: pos.clone().add(new THREE.Vector3(0, 1.2, 0)), count: 1, size: [2.4, 2.8], life: [0.1, 0.14], color: 0xffffff, color2: color, intensity: 2 });
        sparks.emit({ pos, count: 24, speed: [5, 12], size: [0.06, 0.09], life: [0.15, 0.35], color: 0xffffff, color2: color, intensity: 4, stretch: 0.05, drag: 2, gravity: 8 });
        this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.08, 0)), UP, color, 0.2, radius * 1.6, 0.3, 1);
        this.fx.flare(pos.clone().add(new THREE.Vector3(0, 1, 0)), color, 2.2, 8);
        this.fx.lightFlash(pos.clone().add(new THREE.Vector3(0, 1, 0)), color, 50, 0.25);
        break;
      }
      default:
        // mortar and anything unlisted: the full artillery blast
        this.fx.explosion(pos, radius, color, big, onGround);
    }
  }

  /* --------------------------------------------------------------- bombs in flight */

  bombTrail(model: string, pos: THREE.Vector3, vel: THREE.Vector3, color: number) {
    const { sparks, smoke } = this.fx;
    switch (model) {
      case 'cluster':
        sparks.emit({ pos, count: 2, spread: 0.12, size: [0.1, 0.16], life: [0.1, 0.2], color, intensity: 2.4 });
        if (Math.random() < 0.5) smoke.emit({ pos, count: 1, size: [0.12, 0.18], grow: 2.2, life: [0.3, 0.5], color: 0x8a8580, alpha: 0.3 });
        break;
      case 'napalm':
        // dripping fire and greasy smoke
        sparks.emit({ pos, count: 1, vel: vel.clone().multiplyScalar(0.2), speed: [0, 0.5], size: [0.12, 0.18], life: [0.3, 0.5], color: 0xffc040, color2: 0xff3a00, intensity: 2.4, gravity: 10 });
        smoke.emit({ pos, count: 1, size: [0.2, 0.3], grow: 2.6, life: [0.6, 0.9], color: 0x1c1a18, alpha: 0.45, gravity: -0.6 });
        break;
      case 'bouncer':
        sparks.emit({ pos, count: 1, spread: 0.15, size: [0.08, 0.12], life: [0.06, 0.12], color: 0xffffff, color2: color, intensity: 3, stretch: 0.03 });
        break;
      default: // mortar: classic shell smoke trail with a hot fuse
        if (Math.random() < 0.9) smoke.emit({ pos, count: 1, size: [0.18, 0.26], grow: 2.4, life: [0.4, 0.7], color: 0x8a8580, alpha: 0.35, drag: 1.5, gravity: -0.5 });
        sparks.emit({ pos, count: 1, size: [0.25, 0.35], life: [0.08, 0.14], color, intensity: 2 });
    }
  }

  /** Bouncer skips off the floor. */
  bombBounce(pos: THREE.Vector3, color: number) {
    this.fx.sparks.emit({ pos, count: 12, dir: UP, cone: 0.2, speed: [3, 8], size: [0.04, 0.07], life: [0.12, 0.25], color: 0xffffff, color2: color, intensity: 3, stretch: 0.04, gravity: 12 });
    this.fx.ring(pos.clone().add(new THREE.Vector3(0, 0.05, 0)), UP, color, 0.1, 0.9, 0.18, 0.8);
    this.fx.dustRing(pos, 0.5, 6);
  }

  /* -------------------------------------------------------------------- pods in flight */

  podTrail(model: string, pos: THREE.Vector3, heading: number, color: number, age: number) {
    const { sparks, smoke } = this.fx;
    const back = _a.set(-Math.sin(heading), 0, -Math.cos(heading));
    _b.copy(pos).addScaledVector(back, 0.22);
    switch (model) {
      case 'seeker':
        sparks.emit({ pos: _b, count: 2, vel: back.clone().multiplyScalar(4), speed: [0, 0.6], size: [0.14, 0.2], life: [0.06, 0.12], color: 0xfff0c0, color2: color, intensity: 3 });
        if (Math.random() < 0.6) smoke.emit({ pos: _b, count: 1, size: [0.12, 0.18], grow: 2.6, life: [0.4, 0.7], color: 0x8a8a8f, alpha: 0.3, gravity: -0.3 });
        break;
      case 'mine':
        // slow drift: a pulsing proximity halo instead of an engine
        if (Math.sin(age * 8) > 0.9) this.fx.ring(pos.clone().setY(pos.y - 0.1), UP, color, 0.2, 1.1, 0.25, 0.4);
        break;
      case 'interceptor':
        sparks.emit({ pos: pos.clone().add(new THREE.Vector3(Math.cos(age * 18) * 0.25, 0.1, Math.sin(age * 18) * 0.25)), count: 1, size: [0.08, 0.12], life: [0.08, 0.14], color, intensity: 2.6 });
        break;
      default: // turret: landing thrusters
        sparks.emit({ pos: _b, count: 1, size: [0.12, 0.18], life: [0.1, 0.2], color, intensity: 2, speed: [0, 0.4] });
    }
  }

  /* ------------------------------------------------------------ body charge attacks */

  chargeStart(frame: string, pos: THREE.Vector3, dir: THREE.Vector3, glow: number) {
    const { sparks, smoke } = this.fx;
    switch (frame) {
      case 'ironclad':
        // Titan ram: the ground cracks and kicks up dust
        this.fx.dustRing(pos.clone().setY(pos.y - 1), 2, 20);
        this.fx.debris(pos.clone().setY(pos.y - 0.9), 6, 6);
        this.fx.ring(pos.clone().setY(pos.y - 1.1), UP, 0xffc080, 0.4, 2.6, 0.3, 0.7);
        sparks.emit({ pos: pos.clone().setY(pos.y - 0.9), count: 14, dir: dir.clone().negate().setY(0.4).normalize(), cone: 0.5, speed: [4, 9], size: [0.05, 0.08], life: [0.2, 0.45], color: 0xffd090, intensity: 3, stretch: 0.03, gravity: 14 });
        break;
      case 'wisp':
        // Strider: wind shear streaks peel off the body
        for (let i = 0; i < 14; i++) sparks.emit({ pos: pos.clone().add(new THREE.Vector3(rnd(-0.7, 0.7), rnd(-0.8, 0.8), rnd(-0.7, 0.7))), count: 1, vel: dir.clone().multiplyScalar(-16), size: [0.07, 0.1], life: [0.18, 0.3], color: 0xffffff, color2: glow, intensity: 3, stretch: 0.1 });
        for (const k of [0.3, 1.1, 1.9]) this.fx.ring(pos.clone().addScaledVector(dir, -k), dir, glow, 0.4, 1.3, 0.22, 0.4);
        break;
      case 'regent':
        // Paladin lunge: a blade arc sweeps across the front
        this.fx.ring(pos.clone().addScaledVector(dir, 0.8), dir, glow, 2.2, 0.4, 0.22, 0.9);
        this.fx.lightFlash(pos, glow, 30, 0.15);
        this.fx.flare(pos.clone().addScaledVector(dir, 0.6), glow, 2.6, 3, perp(dir, _a), 0.95);
        perp(dir, _a);
        for (let i = -6; i <= 6; i++) {
          const a = (i / 6) * 1.1;
          _b.copy(dir).multiplyScalar(Math.cos(a)).addScaledVector(_a, Math.sin(a));
          sparks.emit({ pos: pos.clone().addScaledVector(_b, 1.3), count: 1, vel: _a.clone().multiplyScalar(-Math.sign(i || 1) * 4), size: [0.2, 0.26], life: [0.16, 0.26], color: 0xffffff, color2: glow, intensity: 4, stretch: 0.05 });
        }
        break;
      default:
        // Vanguard thrust: a booster burst out the back
        sparks.emit({ pos: pos.clone().addScaledVector(dir, -0.4), count: 24, dir: dir.clone().negate(), cone: 0.85, speed: [8, 18], size: [0.12, 0.18], life: [0.1, 0.22], color: 0xffffff, color2: glow, intensity: 4, stretch: 0.05 });
        sparks.emit({ pos: pos.clone().addScaledVector(dir, -0.5), count: 1, size: [1.6, 1.9], life: [0.12, 0.16], color: 0xffffff, color2: glow, intensity: 3 });
        this.fx.ring(pos.clone().addScaledVector(dir, -0.6), dir, glow, 0.3, 1.6, 0.2, 0.6);
        this.fx.lightFlash(pos, glow, 30, 0.12);
        smoke.emit({ pos: pos.clone().addScaledVector(dir, -0.5), count: 3, dir: dir.clone().negate(), speed: [1, 3], size: [0.25, 0.35], grow: 2.4, life: [0.4, 0.7], color: 0x9aa0a8, alpha: 0.3 });
    }
  }

  /* ----------------------------------------------------------------------- items */

  pickup(kind: string, pos: THREE.Vector3, color: number) {
    const { sparks } = this.fx;
    // shared: a light pillar and a bright core so any pick-up reads at range
    sparks.emit({ pos, count: 10, vel: new THREE.Vector3(0, 9, 0), spread: 0.3, size: [0.14, 0.2], life: [0.25, 0.4], color: 0xffffff, color2: color, intensity: 3.5, stretch: 0.08 });
    sparks.emit({ pos, count: 1, size: [1.4, 1.7], life: [0.12, 0.18], color: 0xffffff, color2: color, intensity: 3 });
    if (kind === 'shield') {
      // hex-shell flash: two crossing rings and a soft sphere
      this.fx.ring(pos, UP, color, 0.2, 1.8, 0.35, 0.9);
      this.fx.ring(pos, new THREE.Vector3(1, 0, 0), color, 0.2, 1.4, 0.3, 0.7);
      sparks.emit({ pos, count: 1, size: [1.6, 1.9], life: [0.2, 0.28], color, intensity: 1.6 });
    } else if (kind === 'overdrive') {
      // power surge: a column of embers rising
      sparks.emit({ pos, count: 40, dir: UP, cone: 0.6, speed: [4, 10], size: [0.1, 0.16], life: [0.35, 0.8], color: 0xffe0a0, color2: color, intensity: 3.5, stretch: 0.04, gravity: -4 });
      this.fx.fireballs.spawn(pos, 0.6, color, 0.4);
      this.fx.flare(pos, color, 2.4, 8);
    } else {
      // speed: horizontal streaks bursting outward
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        sparks.emit({ pos, count: 1, vel: new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(14), size: [0.1, 0.14], life: [0.18, 0.3], color: 0xffffff, color2: color, intensity: 3, stretch: 0.08, drag: 3 });
      }
      this.fx.ring(pos, UP, color, 0.2, 2.2, 0.25, 0.8);
    }
    this.fx.lightFlash(pos, color, 30, 0.25);
  }
}

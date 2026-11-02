import * as THREE from 'three';
import type { RobotModel } from './model';
import type { Side } from './rig';

/** What the animator needs to know about the fighter each frame. */
export type AnimMode =
  | 'ground' | 'air' | 'dash' | 'airdash' | 'charge' | 'stagger' | 'down' | 'getup'
  | 'intro' | 'victory' | 'defeat' | 'showcase';

export type AnimEvent =
  | { type: 'fire' }
  | { type: 'bomb' }
  | { type: 'pod' }
  | { type: 'land'; strength: number }
  | { type: 'jump' }
  | { type: 'airjump' }
  | { type: 'dash' }
  | { type: 'hit'; dir: THREE.Vector3; heavy: boolean }
  | { type: 'step' };

export interface AnimSource {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  grounded: boolean;
  mode: AnimMode;
  modeTime: number;
  /** Charge attack sub-phase (0 windup, 1 lunge, 2 recover). */
  chargePhase: number;
  hovering: boolean;
  /** World point to aim the gun/head at (null = look around). */
  aimTarget: THREE.Vector3 | null;
  /** 0..1: how strongly the gun arm should aim (rises when firing). */
  aimWeight: number;
  railCharge: number;
  dashDir: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const DOWN = new THREE.Vector3(0, -1, 0);
const UP = new THREE.Vector3(0, 1, 0);

/** Critically-damped-ish spring channel. */
class Sp {
  x = 0;
  v = 0;
  constructor(public k = 220, public z = 0.75) {}
  step(target: number, dt: number) {
    const c = 2 * Math.sqrt(this.k) * this.z;
    const a = (target - this.x) * this.k - this.v * c;
    this.v += a * dt;
    this.x += this.v * dt;
    return this.x;
  }
  kick(v: number) {
    this.v += v;
  }
}

const sstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const easeOut = (t: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

export type ChargeStyle = 'punch' | 'ram' | 'kick' | 'slash';

export class Animator {
  private phase = 0;
  private time = 0;
  private yaw = new Sp(300, 0.9);
  private yawInit = false;
  private lastVel = new THREE.Vector3();
  private accel = new THREE.Vector3();

  // body / torso channels
  private crouch = new Sp(260, 0.55);
  private leanX = new Sp(140, 0.7);
  private leanZ = new Sp(140, 0.7);
  private waistYaw = new Sp(200, 0.8);
  private chestYaw = new Sp(220, 0.8);
  private chestX = new Sp(260, 0.6);
  private chestZ = new Sp(260, 0.6);
  private headYaw = new Sp(260, 0.8);
  private headX = new Sp(260, 0.7);
  private headZ = new Sp(200, 0.6);
  private aimW = new Sp(300, 1);
  private recoil = new Sp(500, 0.45);
  private barrelKick = new Sp(900, 0.5);
  private launcherKick = new Sp(380, 0.4);
  private bodyY = new Sp(180, 0.8);
  private bodyPitch = new Sp(120, 0.85);
  private bodyRoll = new Sp(120, 0.85);
  private flipT = -1;
  private walkW = new Sp(120, 1);
  private airW = new Sp(160, 1);
  private ragW = new Sp(80, 1);
  private hitX = new Sp(300, 0.4);
  private hitZ = new Sp(300, 0.4);
  // secondary motion
  private antX = new Sp(160, 0.25);
  private antZ = new Sp(160, 0.25);
  private dangX = new Sp(90, 0.35);
  private dangZ = new Sp(90, 0.35);
  private flapF = new Sp(250, 0.35);
  private flapS: Record<Side, Sp> = { L: new Sp(250, 0.35), R: new Sp(250, 0.35) };
  private lookTimer = 0;
  private lookYaw = 0;
  private lookPitch = 0;
  private armPose: Record<Side, THREE.Quaternion> = { L: new THREE.Quaternion(), R: new THREE.Quaternion() };
  private armInit = false;
  private elbowSp: Record<Side, Sp> = { L: new Sp(260, 0.7), R: new Sp(260, 0.7) };
  private stepSide = 0;
  chargeStyle: ChargeStyle = 'punch';
  /** Footstep callback (side, world pos) for SFX/dust. */
  onStep: ((side: Side) => void) | null = null;

  constructor(readonly model: RobotModel) {
    const f = model.loadout.body.frame;
    this.chargeStyle = f === 'ironclad' ? 'ram' : f === 'wisp' ? 'kick' : f === 'regent' ? 'slash' : 'punch';
  }

  event(e: AnimEvent) {
    switch (e.type) {
      case 'fire':
        this.recoil.kick(9);
        this.barrelKick.kick(-3.5);
        this.chestX.kick(-1.2);
        break;
      case 'bomb':
        this.launcherKick.kick(14);
        this.chestX.kick(-3);
        this.crouch.kick(0.6);
        break;
      case 'pod':
        this.chestX.kick(3.5);
        this.crouch.kick(0.4);
        break;
      case 'land':
        this.crouch.kick(2.2 + e.strength * 2.6);
        this.chestX.kick(2 + e.strength * 3);
        this.headX.kick(1 + e.strength * 2);
        this.antX.kick(6 * (1 + e.strength));
        this.flapF.kick(-6);
        break;
      case 'jump':
        this.crouch.kick(-1.5);
        this.antX.kick(-6);
        this.dangX.kick(-5);
        break;
      case 'airjump':
        this.flipT = 0;
        this.antX.kick(-8);
        break;
      case 'dash':
        this.antX.kick(-10);
        this.dangX.kick(-8);
        break;
      case 'hit': {
        // convert hit direction into local space
        const yaw = this.yaw.x;
        const lx = e.dir.x * Math.cos(-yaw) + e.dir.z * Math.sin(-yaw);
        const lz = -e.dir.x * Math.sin(-yaw) + e.dir.z * Math.cos(-yaw);
        const k = e.heavy ? 14 : 7;
        this.hitX.kick(lz * k);
        this.hitZ.kick(-lx * k);
        this.headX.kick(lz * k * 0.8);
        this.headZ.kick(-lx * k * 0.8);
        this.antX.kick(lz * 14);
        this.antZ.kick(-lx * 14);
        this.crouch.kick(e.heavy ? 1.2 : 0.5);
        break;
      }
      default:
        break;
    }
  }

  update(src: AnimSource, dtIn: number) {
    const dt = Math.min(dtIn, 1 / 30);
    if (dt <= 0) return;
    this.time += dt;
    const rig = this.model.rig;
    const spec = rig.spec;
    const scale = spec.scale;
    const mode = src.mode;

    // --- facing ---
    if (!this.yawInit) {
      this.yaw.x = src.yaw;
      this.yawInit = true;
    }
    this.yaw.x = this.yaw.x + wrapPi(src.yaw - this.yaw.x) * 0; // keep continuous
    const yawTarget = this.yaw.x + wrapPi(src.yaw - this.yaw.x);
    this.yaw.step(yawTarget, dt);
    const yawRate = this.yaw.v;
    rig.root.position.copy(src.pos);
    rig.root.rotation.set(0, this.yaw.x, 0);

    // --- local velocity / acceleration ---
    this.accel.copy(src.vel).sub(this.lastVel).divideScalar(dt);
    this.lastVel.copy(src.vel);
    const cy = Math.cos(-this.yaw.x);
    const sy = Math.sin(-this.yaw.x);
    const lvx = (src.vel.x * cy + src.vel.z * sy) / scale;
    const lvz = (-src.vel.x * sy + src.vel.z * cy) / scale;
    const lax = this.accel.x * cy + this.accel.z * sy;
    const laz = -this.accel.x * sy + this.accel.z * cy;
    const hSpeed = Math.hypot(lvx, lvz);

    const onGround = mode === 'ground' || mode === 'charge' || mode === 'showcase' || mode === 'victory' || mode === 'defeat' || (mode === 'stagger' && src.grounded) || mode === 'getup' || (mode === 'intro' && src.grounded);
    const isDash = mode === 'dash' || mode === 'airdash';
    const isDown = mode === 'down';

    // --- blend weights ---
    const walkW = this.walkW.step(onGround && !isDash ? sstep(0.4, 3.5, hSpeed) : 0, dt);
    const airW = this.airW.step(!onGround && !isDown ? 1 : 0, dt);
    const ragW = this.ragW.step(isDown ? 1 : 0, dt);

    // --- gait phase from distance travelled (feet stay planted) ---
    const stride = 0.32 + Math.min(hSpeed, 12) * 0.068;
    if (onGround && !isDash) {
      const prev = this.phase;
      this.phase += (hSpeed * dt) / (2 * stride);
      // footstep events at stance start
      const s0 = Math.floor(prev * 2);
      const s1 = Math.floor(this.phase * 2);
      if (s1 !== s0 && hSpeed > 1.5) {
        this.stepSide ^= 1;
        this.onStep?.(this.stepSide ? 'L' : 'R');
      }
    }

    // --- body / hips ---
    const bob = walkW * 0.045 * (0.5 - 0.5 * Math.cos(this.phase * Math.PI * 4));
    const breathe = Math.sin(this.time * 2.1) * 0.006;
    let crouchTarget = 0.02 + walkW * 0.04;
    let leanXT = 0;
    let leanZT = 0;
    if (onGround && !isDash) {
      leanXT = THREE.MathUtils.clamp(lvz * 0.022 + laz * 0.004, -0.25, 0.32);
      leanZT = THREE.MathUtils.clamp(-lvx * 0.02 - lax * 0.003 + yawRate * hSpeed * -0.012, -0.3, 0.3);
    } else if (isDash) {
      const dl = this.localDir(src.dashDir);
      leanXT = dl.z * 0.55;
      leanZT = -dl.x * 0.5;
      crouchTarget = 0.12;
    } else if (!isDown) {
      leanXT = THREE.MathUtils.clamp(lvz * 0.02, -0.2, 0.3) - (src.vel.y > 0 ? 0.1 : -0.05);
      leanZT = THREE.MathUtils.clamp(-lvx * 0.02, -0.25, 0.25);
    }
    if (mode === 'charge') {
      if (src.chargePhase === 0) crouchTarget = 0.16;
      else if (src.chargePhase === 1) {
        crouchTarget = 0.1;
        leanXT = this.chargeStyle === 'kick' ? -0.35 : 0.55;
      } else crouchTarget = 0.08;
    }
    if (mode === 'stagger') crouchTarget = 0.1;
    if (mode === 'defeat') crouchTarget = 0.35;
    if (mode === 'victory') crouchTarget = 0.0;

    const crouch = this.crouch.step(crouchTarget, dt);
    this.leanX.step(leanXT, dt);
    this.leanZ.step(leanZT, dt);
    this.hitX.step(0, dt);
    this.hitZ.step(0, dt);

    // knockdown / get-up whole-body pose
    let bodyPitchT = 0;
    let bodyYT = 0;
    let bodyRollT = 0;
    if (isDown) {
      const t = src.modeTime;
      // fly back, land on back
      bodyPitchT = -Math.PI / 2 * sstep(0, 0.35, t) - (src.grounded ? 0 : 0.3);
      bodyYT = src.grounded ? -(spec.hipY - 0.28) : -0.15;
      bodyRollT = Math.sin(t * 7) * 0.1 * (1 - sstep(0.3, 0.8, t));
    } else if (mode === 'getup') {
      const t = src.modeTime / 0.55;
      // back → kneel → stand
      const k1 = sstep(0, 0.45, t);
      const k2 = sstep(0.45, 1, t);
      bodyPitchT = -Math.PI / 2 * (1 - k1) + 0.45 * k1 * (1 - k2);
      bodyYT = -(spec.hipY - 0.28) * (1 - k1) - 0.35 * k1 * (1 - k2);
    } else if (mode === 'defeat') {
      const t = sstep(0, 0.6, src.modeTime);
      bodyPitchT = 0.35 * t;
      bodyYT = -0.42 * t;
    }
    this.bodyPitch.step(bodyPitchT, dt);
    this.bodyRoll.step(bodyRollT, dt);
    this.bodyY.step(bodyYT, dt);

    // double-jump flip overlay
    let flip = 0;
    if (this.flipT >= 0) {
      this.flipT += dt;
      const ft = this.flipT / 0.42;
      if (ft >= 1) this.flipT = -1;
      else flip = easeOut(ft) * Math.PI * 2;
    }

    rig.body.position.set(0, spec.hipY - crouch - bob + this.bodyY.x + breathe * 0.5, 0);
    rig.body.rotation.set(this.leanX.x * 0.55 + this.bodyPitch.x + flip + this.hitX.x * 0.03, 0, this.leanZ.x * 0.6 + this.bodyRoll.x + this.hitZ.x * 0.03);
    // hip sway in gait
    const sway = walkW * Math.sin(this.phase * Math.PI * 2) * 0.08;
    rig.hips.rotation.set(0, sway, walkW * Math.cos(this.phase * Math.PI * 2) * 0.03);

    // --- upper body: torso twist toward target ---
    let relYaw = 0;
    let relPitch = 0;
    const hasAim = !!src.aimTarget && mode !== 'down' && mode !== 'defeat';
    if (hasAim) {
      _v.copy(src.aimTarget!).sub(src.pos);
      relYaw = wrapPi(Math.atan2(_v.x, _v.z) - this.yaw.x);
      relPitch = Math.atan2(_v.y - 1.4, Math.hypot(_v.x, _v.z));
    } else {
      // occasional look-around
      this.lookTimer -= dt;
      if (this.lookTimer <= 0) {
        this.lookTimer = 2.2 + Math.random() * 3;
        this.lookYaw = Math.random() < 0.35 ? 0 : (Math.random() - 0.5) * 1.3;
        this.lookPitch = (Math.random() - 0.4) * 0.3;
      }
      relYaw = this.lookYaw;
      relPitch = this.lookPitch;
    }
    const clampYaw = THREE.MathUtils.clamp(relYaw, -1.3, 1.3);
    const aimW = this.aimW.step(Math.min(1, src.aimWeight), dt);
    let waistYawT = clampYaw * (0.25 + 0.15 * aimW) - sway * 0.8;
    let chestYawT = clampYaw * (0.25 + 0.2 * aimW);
    let chestXT = breathe * 2 + (mode === 'defeat' ? 0.5 : 0) + (mode === 'victory' ? -0.12 : 0);
    let chestZT = 0;
    if (mode === 'charge') {
      if (src.chargePhase === 0) {
        chestYawT = this.chargeStyle === 'ram' ? 0.9 : 0.7;
        chestXT = 0.15;
      } else if (src.chargePhase === 1) {
        chestYawT = this.chargeStyle === 'ram' ? 0.8 : this.chargeStyle === 'slash' ? -0.9 : -0.5;
        chestXT = 0.25;
      }
      waistYawT = chestYawT * 0.4;
    }
    if (isDown) {
      waistYawT = 0;
      chestYawT = 0;
      chestXT = -0.1;
    }
    this.waistYaw.step(waistYawT, dt);
    this.chestYaw.step(chestYawT, dt);
    this.chestX.step(chestXT, dt);
    this.chestZ.step(chestZT, dt);
    rig.waist.rotation.set(this.leanX.x * 0.25 + this.hitX.x * 0.04, this.waistYaw.x, this.leanZ.x * 0.2 + this.hitZ.x * 0.04);
    rig.chest.rotation.set(this.chestX.x + this.hitX.x * 0.06, this.chestYaw.x, this.chestZ.x + this.hitZ.x * 0.05);
    rig.chest.position.y = spec.chestY + breathe;

    const headYawT = isDown ? 0 : THREE.MathUtils.clamp(relYaw - this.waistYaw.x - this.chestYaw.x, -0.9, 0.9);
    let headXT = THREE.MathUtils.clamp(-relPitch, -0.5, 0.5) - this.leanX.x * 0.5;
    if (mode === 'defeat') headXT = 0.6;
    if (mode === 'victory') headXT = -0.25;
    this.headYaw.step(headYawT, dt);
    this.headX.step(headXT, dt);
    this.headZ.step(0, dt);
    rig.head.rotation.set(this.headX.x + this.hitX.x * 0.04, this.headYaw.x, this.headZ.x);

    // --- legs (IK) ---
    rig.root.updateMatrixWorld(true);
    this.solveLegs(src, dt, walkW, airW, ragW, stride, lvx, lvz, isDash);

    // --- arms ---
    this.solveArms(src, dt, walkW, airW, ragW, aimW, hasAim);

    // --- weapon nodes ---
    this.barrelKick.step(0, dt);
    this.model.barrel.position.y = -this.barrelKick.x * 0.015;
    const lk = this.launcherKick.step(0, dt);
    this.model.launcher.rotation.x = -0.5 - lk * 0.05;
    this.model.setCharge(src.railCharge);

    // --- secondary motion ---
    this.antX.step(0, dt);
    this.antZ.step(0, dt);
    this.antX.kick(-laz * 0.004 + (src.vel.y > 0 ? -0.02 : 0));
    this.antZ.kick(lax * 0.004);
    for (const a of rig.antennas) {
      const r = a.userData.rest as THREE.Euler;
      a.rotation.set(r.x + this.antX.x * 0.08, r.y, r.z + this.antZ.x * 0.08);
    }
    const speedBack = THREE.MathUtils.clamp(hSpeed * 0.035, 0, 0.6);
    this.dangX.step(-speedBack - (airW * src.vel.y < 0 ? 0.3 : 0) * airW, dt);
    this.dangZ.step(0, dt);
    this.dangX.kick(laz * 0.003);
    this.dangZ.kick(-lax * 0.003);
    for (const d of rig.danglers) {
      const stiff = (d.userData.stiff as number) ?? 1;
      d.rotation.set(this.dangX.x * stiff + Math.sin(this.time * 5 + d.position.x * 10) * 0.02 * speedBack, 0, this.dangZ.x * stiff * 0.6);
    }
    const tL = rig.thigh.L.rotation;
    const tR = rig.thigh.R.rotation;
    const fwdSwing = Math.max(0, -Math.min(tL.x, tR.x));
    this.flapF.step(fwdSwing * 0.9, dt);
    rig.flapF.rotation.x = -this.flapF.x;
    for (const side of ['L', 'R'] as Side[]) {
      const t = rig.thigh[side].rotation;
      this.flapS[side].step(Math.max(0, -t.x) * 0.5 + Math.abs(t.z) * 0.5, dt);
      const sx = side === 'L' ? 1 : -1;
      const flap = side === 'L' ? rig.flapL : rig.flapR;
      flap.rotation.set(-this.flapS[side].x * 0.7, 0, sx * this.flapS[side].x * 0.3);
    }
  }

  private localDir(world: THREE.Vector3) {
    const c = Math.cos(-this.yaw.x);
    const s = Math.sin(-this.yaw.x);
    const x = world.x * c + world.z * s;
    const z = -world.x * s + world.z * c;
    const l = Math.hypot(x, z) || 1;
    return { x: x / l, z: z / l };
  }

  /* ------------------------------ legs ------------------------------ */

  private solveLegs(src: AnimSource, dt: number, walkW: number, airW: number, ragW: number, stride: number, lvx: number, lvz: number, isDash: boolean) {
    const rig = this.model.rig;
    const spec = rig.spec;
    const hSpeed = Math.hypot(lvx, lvz);
    const dirX = hSpeed > 0.01 ? lvx / hSpeed : 0;
    const dirZ = hSpeed > 0.01 ? lvz / hSpeed : 1;
    const lift = 0.1 + Math.min(hSpeed, 12) * 0.016;
    const mode = src.mode;
    for (const side of ['L', 'R'] as Side[]) {
      const sx = side === 'L' ? 1 : -1;
      const ph = (this.phase + (side === 'L' ? 0 : 0.5)) % 1;
      // ground gait target (root-local)
      let off = 0;
      let up = 0;
      if (ph < 0.5) {
        const t = ph / 0.5;
        off = (stride / 2) * (1 - 2 * t);
      } else {
        const t = (ph - 0.5) / 0.5;
        const e = t * t * (3 - 2 * t);
        off = (stride / 2) * (-1 + 2 * e);
        up = Math.sin(Math.PI * t) * lift;
      }
      const restX = sx * spec.hipX * 1.15;
      let fx = restX + dirX * off * walkW;
      let fz = 0.02 + dirZ * off * walkW;
      let fy = spec.ankleH + up * walkW;
      // keep the trailing foot from crossing on strafes
      if (sx > 0) fx = Math.max(fx, 0.05);
      else fx = Math.min(fx, -0.05);

      // air pose: tucked legs, trailing velocity, falling = reach down
      if (airW > 0.001) {
        const rising = src.vel.y > 0;
        const hipNow = rig.body.position.y;
        let ax = restX * 1.1;
        let az = 0.08 - lvz * 0.012;
        let ay = hipNow - (spec.thigh + spec.shin + spec.meta) * (rising ? 0.62 : 0.8);
        if (src.hovering) {
          az = -0.05 + Math.sin(this.time * 9 + sx) * 0.03;
          ay = hipNow - (spec.thigh + spec.shin + spec.meta) * 0.78 + (side === 'L' ? 0.05 : 0);
        }
        if (this.flipT >= 0) {
          ay = hipNow - (spec.thigh + spec.shin) * 0.45;
          az = 0.15;
        }
        if (isDash) {
          const dl = this.localDir(src.dashDir);
          ax = restX - dl.x * 0.25;
          az = -dl.z * 0.32;
          ay = hipNow - (spec.thigh + spec.shin + spec.meta) * 0.7 + (side === 'L' ? 0.08 : 0);
        }
        fx = THREE.MathUtils.lerp(fx, ax, airW);
        fy = THREE.MathUtils.lerp(fy, ay, airW);
        fz = THREE.MathUtils.lerp(fz, az, airW);
      }
      if (isDash && airW < 0.5) {
        // ground dash: skid with one foot forward
        const dl = this.localDir(src.dashDir);
        const lead = side === 'L' ? 1 : -0.6;
        fx += dl.x * 0.18 * lead;
        fz += dl.z * 0.18 * lead;
      }
      if (mode === 'charge' && src.chargePhase === 1 && this.chargeStyle === 'kick' && side === 'R') {
        fz = 0.55;
        fy = rig.body.position.y - 0.05;
      }
      if (mode === 'defeat') {
        // kneel: one knee down
        if (side === 'R') {
          fz = -0.25;
          fy = spec.ankleH;
        } else {
          fz = 0.25;
        }
      }

      _v.set(fx, fy, fz);
      this.ikLeg(side, _v, ragW);
    }
  }

  /** Solve one leg: thigh+shin two-bone IK to the ankle (or hock), then keep the foot flat. */
  private ikLeg(side: Side, footLocal: THREE.Vector3, ragW: number) {
    const rig = this.model.rig;
    const spec = rig.spec;
    const thigh = rig.thigh[side];
    const knee = rig.knee[side];
    const ankle = rig.ankle[side];
    const parent = thigh.parent!;
    const L1 = spec.thigh;
    const L2 = spec.shin;

    // target in hips-local space
    const world = rig.root.localToWorld(_v2.copy(footLocal));
    const metaDirRoot = _v3.set(0, -0.9, 0.42).normalize();
    if (spec.meta > 0) {
      // ankle joint (top of metatarsal) sits above and behind the foot
      const metaWorld = metaDirRoot.clone().applyQuaternion(rig.root.quaternion).multiplyScalar(spec.meta * spec.scale);
      world.sub(metaWorld);
    }
    const target = parent.worldToLocal(world).sub(thigh.position);

    if (ragW > 0.98) {
      // limp legs while knocked down
      thigh.rotation.set(-0.5, 0, (side === 'L' ? 1 : -1) * 0.15);
      knee.rotation.set(0.7, 0, 0);
      ankle.rotation.set(-0.2, 0, 0);
      if (spec.meta > 0) rig.hock[side].rotation.set(0.3, 0, 0);
      return;
    }

    const d = Math.min(Math.max(target.length(), 0.05), L1 + L2 - 0.0005);
    const a = target.clone().normalize();
    const cosA = (L1 * L1 + d * d - L2 * L2) / (2 * L1 * d);
    const alpha = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    // pole: knees point forward
    const pole = _v.set(0, 0, 1);
    const perp = pole.clone().sub(a.clone().multiplyScalar(pole.dot(a)));
    if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
    perp.normalize();
    const thighDir = a.clone().multiplyScalar(Math.cos(alpha)).add(perp.clone().multiplyScalar(Math.sin(alpha)));
    // thigh basis: -Y along the bone, +Z toward the pole
    const yAx = thighDir.clone().negate();
    const zAx = pole.clone().sub(thighDir.clone().multiplyScalar(pole.dot(thighDir))).normalize();
    const xAx = new THREE.Vector3().crossVectors(yAx, zAx);
    _m.makeBasis(xAx, yAx, zAx);
    thigh.quaternion.setFromRotationMatrix(_m);
    // knee hinge
    const kneePos = thighDir.clone().multiplyScalar(L1);
    const shinDir = target.clone().sub(kneePos).normalize();
    _q.copy(thigh.quaternion).invert();
    const sl = shinDir.applyQuaternion(_q);
    knee.rotation.set(Math.atan2(-sl.z, -sl.y), 0, 0);

    // ankle / foot orientation in root space
    knee.updateMatrixWorld(true);
    const parentQ = knee.getWorldQuaternion(_q);
    if (spec.meta > 0) {
      // metatarsal along metaDir, then foot flat
      const desired = _q2.setFromUnitVectors(DOWN, metaDirRoot).premultiply(rig.root.quaternion);
      ankle.quaternion.copy(parentQ.clone().invert().multiply(desired));
      ankle.updateMatrixWorld(true);
      const pq = ankle.getWorldQuaternion(new THREE.Quaternion());
      rig.hock[side].quaternion.copy(pq.invert().multiply(rig.root.quaternion));
    } else {
      // flat foot: world orientation = root yaw (+ slight toe roll during swing)
      ankle.quaternion.copy(parentQ.invert().multiply(rig.root.quaternion));
    }
  }

  /* ------------------------------ arms ------------------------------ */

  private solveArms(src: AnimSource, dt: number, walkW: number, airW: number, ragW: number, aimW: number, hasAim: boolean) {
    const rig = this.model.rig;
    const mode = src.mode;
    const swing = Math.sin(this.phase * Math.PI * 2) * 0.75 * walkW;
    const rc = this.recoil.step(0, dt);
    for (const side of ['L', 'R'] as Side[]) {
      const sx = side === 'L' ? 1 : -1;
      // locomotion pose (euler on the shoulder): pitch, roll
      let px = (side === 'L' ? swing : -swing) * 1.0 + 0.08;
      let pz = sx * (0.18 + airW * 0.25);
      let elbow = 0.45 + walkW * 0.55;
      if (airW > 0.01) {
        px = THREE.MathUtils.lerp(px, src.vel.y > 0 ? 0.5 : -0.35, airW);
        elbow = THREE.MathUtils.lerp(elbow, 0.9, airW);
        if (src.hovering) {
          pz = sx * 0.55;
          px = 0.25;
        }
      }
      if (mode === 'dash' || mode === 'airdash') {
        px = 0.9;
        pz = sx * 0.35;
        elbow = 0.3;
      }
      if (ragW > 0.05) {
        px = THREE.MathUtils.lerp(px, -2.2, ragW);
        pz = THREE.MathUtils.lerp(pz, sx * 0.9, ragW);
        elbow = THREE.MathUtils.lerp(elbow, 0.4, ragW);
      }
      if (mode === 'getup') {
        px = -0.6;
        pz = sx * 0.4;
        elbow = 0.8;
      }
      if (mode === 'stagger') {
        px = 0.6;
        pz = sx * 0.5;
        elbow = 0.6;
      }
      if (mode === 'defeat') {
        px = 0.2;
        pz = sx * 0.1;
        elbow = side === 'L' ? 1.2 : 0.3;
      }
      if (mode === 'victory') {
        const t = src.modeTime;
        if (side === 'R') {
          // fist raised high with a little pump
          px = -2.8 + Math.sin(t * 6) * 0.08 * Math.max(0, 1 - t);
          pz = -0.25;
          elbow = 0.25 + Math.max(0, 0.6 - t) * 1.5;
        } else {
          px = 0.3;
          pz = 0.7;
          elbow = 1.9;
        }
      }
      if (mode === 'charge') {
        const ph = src.chargePhase;
        const st = this.chargeStyle;
        if (st === 'punch' || st === 'slash') {
          if (side === 'R') {
            if (ph === 0) {
              px = 0.9;
              pz = -0.3;
              elbow = 2.0;
            } else if (ph === 1) {
              px = st === 'slash' ? -1.4 : -1.55;
              pz = st === 'slash' ? 0.4 : -0.05;
              elbow = 0.05;
            } else {
              px = -0.6;
              elbow = 0.6;
            }
          } else {
            px = ph === 1 ? 0.8 : -0.4;
            pz = 0.4;
            elbow = 1.4;
          }
        } else if (st === 'ram') {
          px = -0.3;
          pz = sx * 0.2;
          elbow = 1.8;
        } else {
          px = 0.4;
          pz = sx * 0.7;
          elbow = 0.5;
        }
      }
      _q.setFromEuler(new THREE.Euler(-px, 0, pz, 'YXZ'));
      // blend in gun aim for the right arm
      if (side === 'R' && hasAim && aimW > 0.01 && mode !== 'charge' && mode !== 'victory') {
        const sh = rig.arm.R;
        rig.chest.updateMatrixWorld(true);
        const shWorld = sh.getWorldPosition(_v);
        const dirW = _v2.copy(src.aimTarget!).sub(shWorld).normalize();
        const chestQ = rig.chest.getWorldQuaternion(_q2).invert();
        const dirL = dirW.applyQuaternion(chestQ);
        const aimQ = new THREE.Quaternion().setFromUnitVectors(DOWN, dirL);
        // recoil: kick up around the arm's side axis
        const kick = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -rc * 0.045);
        aimQ.premultiply(kick);
        _q.slerp(aimQ, aimW);
        elbow = THREE.MathUtils.lerp(elbow, 0.12 + rc * 0.02, aimW);
      }
      if (!this.armInit) this.armPose[side].copy(_q);
      // spring-ish smoothing via slerp
      this.armPose[side].slerp(_q, 1 - Math.exp(-dt * (mode === 'charge' ? 28 : 18)));
      rig.arm[side].quaternion.copy(this.armPose[side]);
      rig.elbow[side].rotation.set(-this.elbowSp[side].step(elbow, dt), 0, 0);
      // pauldron follows the arm partially
      const e = new THREE.Euler().setFromQuaternion(this.armPose[side], 'YXZ');
      rig.pad[side].rotation.set(e.x * 0.25, 0, e.z * 0.4);
    }
    this.armInit = true;
    void UP;
  }
}

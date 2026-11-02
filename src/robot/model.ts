import * as THREE from 'three';
import { Rig, type RigSpec } from './rig';
import { PartBuilder, makeMaterials, type MatSet } from './kit';
import { buildFrame, FRAME_PROPS } from './frames';
import { buildLegs, legLengths } from './legs';
import { buildGun, buildBomb, buildPodDock } from './weapons';
import { buildSkill } from './skills';
import { DamageVisuals } from './damage';
import { Thruster } from '../vfx/thruster';
import { decalTexture } from '../render/textures';
import type { ResolvedLoadout } from '../data/parts';
import type { VisualPaint } from './paint';

const FRAME_SCALE = { striker: 1.0, ironclad: 0.97, wisp: 0.98, regent: 0.92 } as const;
const HEAD_SCALE = { striker: 0.88, ironclad: 0.9, wisp: 0.85, regent: 0.88 } as const;

export function rigSpecFor(lo: ResolvedLoadout): RigSpec {
  const fp = FRAME_PROPS[lo.body.frame];
  const ll = legLengths(lo.legs.model, fp.legLen);
  const hipY = ll.meta > 0 ? (ll.thigh + ll.shin) * 0.86 + ll.meta * 0.92 + ll.ankleH : (ll.thigh + ll.shin) * 0.95 + ll.ankleH;
  return {
    hipY,
    hipX: fp.hipX,
    thigh: ll.thigh,
    shin: ll.shin,
    ankleH: ll.ankleH,
    meta: ll.meta,
    footLen: ll.footLen,
    waistY: fp.waistY,
    chestY: fp.chestY,
    neckY: fp.neckY,
    shoulderX: fp.shoulderX,
    shoulderY: fp.shoulderY,
    upperArm: fp.upperArm,
    forearm: fp.forearm,
    scale: FRAME_SCALE[lo.body.frame],
  };
}

function emblemTexture(paint: VisualPaint) {
  const key = `emblem:${paint.emblem}:${paint.decal ?? "unit"}:${paint.secondary}:${paint.trim}`;
  return decalTexture((g, s) => {
    const c2 = '#' + new THREE.Color(paint.secondary).getHexString();
    const ct = '#' + new THREE.Color(paint.trim).getHexString();
    g.clearRect(0, 0, s, s);
    if (paint.decal === 'none') return;
    g.fillStyle = ct;
    g.beginPath();
    g.moveTo(s * 0.5, s * 0.06);
    g.lineTo(s * 0.92, s * 0.3);
    g.lineTo(s * 0.92, s * 0.7);
    g.lineTo(s * 0.5, s * 0.94);
    g.lineTo(s * 0.08, s * 0.7);
    g.lineTo(s * 0.08, s * 0.3);
    g.closePath();
    g.fill();
    g.strokeStyle = c2;
    g.lineWidth = s * 0.05;
    g.stroke();
    g.fillStyle = c2;
    g.font = `900 ${s * 0.46}px "Arial Black", Impact, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if(paint.decal==='chevron') {
      g.beginPath();g.moveTo(s*.22,s*.35);g.lineTo(s*.5,s*.6);g.lineTo(s*.78,s*.35);
      g.lineTo(s*.78,s*.52);g.lineTo(s*.5,s*.77);g.lineTo(s*.22,s*.52);g.closePath();g.fill();
    } else if(paint.decal==='cross') {
      g.fillRect(s*.42,s*.22,s*.16,s*.56);g.fillRect(s*.22,s*.42,s*.56,s*.16);
    } else g.fillText(paint.emblem, s * 0.5, s * 0.53);
  }, 256, key);
}

export class RobotModel {
  readonly rig: Rig;
  readonly root: THREE.Group;
  readonly mats: MatSet;
  readonly backThrusters: Thruster[] = [];
  readonly footThrusters: Thruster[] = [];
  readonly barrel: THREE.Group;
  readonly chargeGlow: THREE.Mesh | null;
  readonly launcher: THREE.Group;
  readonly podDock: THREE.Group;
  readonly skillEmitter: THREE.Group;
  private skillGlow: THREE.MeshStandardMaterial;
  readonly meshes: THREE.Mesh[] = [];
  private damageVisuals: DamageVisuals | null = null;
  private readonly ownedGeometry = new Set<THREE.BufferGeometry>();
  private readonly weaponMaterials: THREE.Material[] = [];
  private flashAmt = 0;
  private flashColor = new THREE.Color(1, 1, 1);
  private podShown = 1;
  private podTarget = 1;
  private weaponGlow: THREE.MeshStandardMaterial;
  private baseEmissive = new Map<THREE.Material, THREE.Color>();
  /** 0..1 power level for visor/glow (defeat powers down). */
  power = 1;

  constructor(readonly loadout: ResolvedLoadout, readonly paint: VisualPaint, opts: { shadows?: boolean } = {}) {
    const spec = rigSpecFor(loadout);
    this.rig = new Rig(spec);
    this.root = this.rig.root;
    this.mats = makeMaterials(paint, loadout.body.frame.length * 3 + 1);
    (this.mats.decal as THREE.MeshStandardMaterial).map = emblemTexture(paint);
    const b = new PartBuilder();
    buildFrame(loadout.body.frame, this.rig, b);
    buildLegs(loadout.legs.model, this.rig, b, FRAME_PROPS[loadout.body.frame].bulk);
    this.meshes.push(...b.build(this.mats, { castShadow: opts.shadows !== false }));
    this.rig.head.scale.setScalar(HEAD_SCALE[loadout.body.frame]);

    // Weapons use their own glow colors.
    const wcol = new THREE.Color(loadout.gun.color);
    this.weaponGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: wcol, emissiveIntensity: 6 });
    const wmats: MatSet = {
      ...this.mats,
      glowHot: this.weaponGlow,
      secondary: this.mats.secondary,
    };
    const wb = new PartBuilder();
    const gun = buildGun(loadout.gun, this.rig, wb, this.weaponGlow);
    this.barrel = gun.barrel;
    this.chargeGlow = gun.chargeGlow;
    const bombGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(loadout.bomb.color), emissiveIntensity: 5 });
    const bb = new PartBuilder();
    this.launcher = buildBomb(loadout.bomb, this.rig, bb);
    const podGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(loadout.pod.color), emissiveIntensity: 5 });
    this.podDock = buildPodDock(loadout.pod, this.rig, bb, podGlow);
    this.meshes.push(...wb.build(wmats), ...bb.build({ ...this.mats, glowHot: bombGlow }));
    const sb = new PartBuilder();
    this.skillGlow = new THREE.MeshStandardMaterial({ color: 0, emissive: loadout.skill.color, emissiveIntensity: 2 });
    this.skillEmitter = buildSkill(loadout.skill, this.rig, sb);
    this.meshes.push(...sb.build({ ...this.mats, glowHot: this.skillGlow }));

    // Cache owned resources while the full hierarchy is assembled. Garage thumbnails
    // detach joints before disposal; docked pods/charge glows are not in `meshes`.
    // Shared thruster geometry is attached afterward and retained by its own owner.
    this.root.traverse(o => { if ((o as THREE.Mesh).isMesh) this.ownedGeometry.add((o as THREE.Mesh).geometry); });
    this.weaponMaterials.push(this.weaponGlow, bombGlow, podGlow, this.skillGlow);

    // Thrusters
    for (const n of this.rig.backNozzles) {
      const t = new Thruster(paint.flame ?? paint.glow, 0.07, 0.55);
      n.add(t.group);
      this.backThrusters.push(t);
    }
    for (const n of this.rig.footNozzles) {
      const t = new Thruster(paint.flame ?? paint.glow, 0.045, 0.35);
      n.add(t.group);
      this.footThrusters.push(t);
    }
    for (const key of ['primary', 'secondary', 'trim', 'dark'] as const) {
      const m = this.mats[key] as THREE.MeshStandardMaterial;
      this.baseEmissive.set(m, m.emissive.clone());
    }
    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.userData.robot = this;
    });
  }

  get spec() {
    return this.rig.spec;
  }

  /** Remaining HP fraction: 1 = healthy, 0 = destroyed. Visual effects only. */
  setDamage(fraction: number) {
    const hp = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 1;
    if (hp < 0.5 && !this.damageVisuals) this.damageVisuals = new DamageVisuals(this);
    this.damageVisuals?.setFraction(hp);
  }

  setThrust(back: number, foot: number) {
    for (const t of this.backThrusters) t.intensity = back;
    for (const t of this.footThrusters) t.intensity = foot;
  }

  /** Brief emissive flash (hit feedback). */
  flash(amount = 1, color = 0xffffff) {
    this.flashAmt = Math.max(this.flashAmt, amount);
    this.flashColor.set(color);
  }

  setPodReady(ready: boolean) {
    this.podTarget = ready ? 1 : 0;
  }

  setCharge(v: number) {
    if (this.chargeGlow) this.chargeGlow.scale.set(1 + v * 1.5, Math.max(0.001, v), 1 + v * 1.5);
  }
  /** Presentation-only windup control for the auxiliary skill emitter. */
  setSkillCharge(v: number) {
    this.skillGlow.emissiveIntensity = 2 + Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)) * 4;
  }

  update(time: number, dt: number) {
    for (const t of this.backThrusters) t.update(time, dt);
    for (const t of this.footThrusters) t.update(time, dt);
    // hit flash decay
    if (this.flashAmt > 0.001 || this.power < 1) {
      this.flashAmt = Math.max(0, this.flashAmt - dt * 9);
      for (const [m, base] of this.baseEmissive) {
        const sm = m as THREE.MeshStandardMaterial;
        sm.emissive.copy(base).lerp(this.flashColor, Math.min(1, this.flashAmt));
        sm.emissiveIntensity = 1 + this.flashAmt * 0.8;
      }
    }
    const pw = this.power;
    (this.mats.glow as THREE.MeshStandardMaterial).emissiveIntensity = 1.8 * pw;
    (this.mats.glowHot as THREE.MeshStandardMaterial).emissiveIntensity = 2.8 * pw;
    (this.mats.visor as THREE.MeshPhysicalMaterial).emissiveIntensity = 0.18 * pw;
    this.damageVisuals?.update(time, dt);
    // pod dock pop-in
    this.podShown += (this.podTarget - this.podShown) * Math.min(1, dt * (this.podTarget > this.podShown ? 10 : 30));
    const s = this.podShown < 0.02 ? 0.0001 : this.podShown * (1 + Math.sin(Math.min(1, this.podShown) * Math.PI) * 0.25);
    this.podDock.scale.setScalar(s);
    this.podDock.position.y = this.loadout.pod.model === 'interceptor' ? this.podShown * (0.08 + Math.sin(time * 2.3) * 0.012) : 0;
    this.podDock.visible = this.podShown > 0.02;
  }

  dispose() {
    this.damageVisuals?.dispose();
    for (const g of this.ownedGeometry) g.dispose();
    this.ownedGeometry.clear();
    for (const m of Object.values(this.mats)) m.dispose();
    for (const m of this.weaponMaterials) m.dispose();
    for (const t of [...this.backThrusters, ...this.footThrusters]) t.dispose();
  }
}

import * as THREE from 'three';

/**
 * Joint hierarchy shared by all robots (robots face +Z, right hand at -X):
 *
 * root (feet origin, yaw)
 *  └ body (whole-body pivot at hip height: flips, knockdown)
 *     └ hips
 *        ├ waist → chest → neck → head → antenna[]
 *        │          ├ padL/padR (shoulder armor)
 *        │          ├ armL/armR (shoulder) → elbowL/R → handL/R
 *        │          │                         └ gunMount (right forearm)
 *        │          ├ bombMount (left shoulder top)
 *        │          └ back → podMount, thruster nozzles
 *        ├ thighL/R → kneeL/R → ankleL/R (→ hockL/R for reverse-joint legs)
 *        └ flapF / flapL / flapR (skirt armor, secondary motion)
 */
export interface RigSpec {
  hipY: number;
  hipX: number;
  thigh: number;
  shin: number;
  /** Ankle joint height above the sole. */
  ankleH: number;
  /** Reverse-joint: length of the metatarsal segment (0 = normal legs). */
  meta: number;
  waistY: number;
  chestY: number;
  neckY: number;
  shoulderX: number;
  shoulderY: number;
  upperArm: number;
  forearm: number;
  /** Visual scale of the whole robot. */
  scale: number;
  footLen: number;
}

export type Side = 'L' | 'R';

export class Rig {
  readonly root = new THREE.Group();
  readonly body = new THREE.Group();
  readonly hips = new THREE.Group();
  readonly waist = new THREE.Group();
  readonly chest = new THREE.Group();
  readonly neck = new THREE.Group();
  readonly head = new THREE.Group();
  readonly back = new THREE.Group();
  readonly pad: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly arm: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly elbow: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly hand: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly thigh: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly knee: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly ankle: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly hock: Record<Side, THREE.Group> = { L: new THREE.Group(), R: new THREE.Group() };
  readonly flapF = new THREE.Group();
  readonly flapL = new THREE.Group();
  readonly flapR = new THREE.Group();
  readonly gunMount = new THREE.Group();
  readonly muzzle = new THREE.Object3D();
  readonly bombMount = new THREE.Group();
  readonly bombMuzzle = new THREE.Object3D();
  readonly podMount = new THREE.Group();
  readonly skillMount = new THREE.Group();
  readonly skillMuzzle = new THREE.Object3D();
  readonly antennas: THREE.Group[] = [];
  /** Extra hanging parts for spring secondary motion (capes, tassets). */
  readonly danglers: THREE.Group[] = [];
  /** Nozzle anchors where thruster plumes attach (plume points down local -Y). */
  readonly backNozzles: THREE.Object3D[] = [];
  readonly footNozzles: THREE.Object3D[] = [];
  /** Tag point at head height for the lock-on reticle. */
  readonly lockPoint = new THREE.Object3D();

  constructor(readonly spec: RigSpec) {
    const s = spec;
    this.root.name = 'root';
    this.root.add(this.body);
    this.body.position.y = s.hipY;
    this.body.add(this.hips);
    this.hips.add(this.waist);
    this.waist.position.y = s.waistY;
    this.waist.add(this.chest);
    this.chest.position.y = s.chestY;
    this.chest.add(this.neck);
    this.neck.position.y = s.neckY;
    this.neck.add(this.head);
    this.chest.add(this.back);
    this.chest.add(this.skillMount);
    this.skillMount.name = 'skill';
    this.skillMount.add(this.skillMuzzle);
    this.chest.add(this.bombMount);
    this.bombMount.add(this.bombMuzzle);
    this.back.add(this.podMount);
    for (const side of ['L', 'R'] as Side[]) {
      const sx = side === 'L' ? 1 : -1;
      this.chest.add(this.pad[side]);
      this.pad[side].position.set(sx * s.shoulderX, s.shoulderY, 0);
      this.chest.add(this.arm[side]);
      this.arm[side].position.set(sx * s.shoulderX, s.shoulderY, 0);
      this.arm[side].add(this.elbow[side]);
      this.elbow[side].position.y = -s.upperArm;
      this.elbow[side].add(this.hand[side]);
      this.hand[side].position.y = -s.forearm;
      this.hips.add(this.thigh[side]);
      this.thigh[side].position.set(sx * s.hipX, 0, 0);
      this.thigh[side].add(this.knee[side]);
      this.knee[side].position.y = -s.thigh;
      this.knee[side].add(this.ankle[side]);
      this.ankle[side].position.y = -s.shin;
      if (s.meta > 0) {
        // Reverse-joint: ankle is the "hock" high above the foot; foot hangs below it.
        this.ankle[side].add(this.hock[side]);
        this.hock[side].position.y = -s.meta;
      }
      for (const o of [this.arm[side], this.elbow[side], this.thigh[side], this.knee[side], this.ankle[side], this.hock[side], this.pad[side]])
        o.rotation.order = 'YXZ';
    }
    this.elbow.R.add(this.gunMount);
    this.gunMount.add(this.muzzle);
    this.hips.add(this.flapF, this.flapL, this.flapR);
    this.head.add(this.lockPoint);
    this.waist.rotation.order = 'YXZ';
    this.chest.rotation.order = 'YXZ';
    this.head.rotation.order = 'YXZ';
    this.body.rotation.order = 'YXZ';
    this.root.scale.setScalar(s.scale);
    const names: [THREE.Object3D, string][] = [
      [this.body, 'body'], [this.hips, 'hips'], [this.waist, 'waist'], [this.chest, 'chest'], [this.neck, 'neck'], [this.head, 'head'], [this.back, 'back'],
      [this.arm.L, 'armL'], [this.arm.R, 'armR'], [this.elbow.L, 'elbowL'], [this.elbow.R, 'elbowR'], [this.hand.L, 'handL'], [this.hand.R, 'handR'],
      [this.thigh.L, 'thighL'], [this.thigh.R, 'thighR'], [this.knee.L, 'kneeL'], [this.knee.R, 'kneeR'], [this.ankle.L, 'ankleL'], [this.ankle.R, 'ankleR'],
      [this.hock.L, 'hockL'], [this.hock.R, 'hockR'], [this.pad.L, 'padL'], [this.pad.R, 'padR'], [this.gunMount, 'gun'], [this.bombMount, 'bomb'], [this.podMount, 'pod'],
      [this.flapF, 'flapF'], [this.flapL, 'flapL'], [this.flapR, 'flapR'],
    ];
    for (const [o, n] of names) o.name = n;
  }

  /** The joint the foot geometry hangs from. */
  foot(side: Side) {
    return this.spec.meta > 0 ? this.hock[side] : this.ankle[side];
  }

  addAntenna(parent: THREE.Object3D, pos: [number, number, number], rot: [number, number, number] = [0, 0, 0]) {
    const g = new THREE.Group();
    g.position.set(...pos);
    g.rotation.set(...rot);
    g.userData.rest = g.rotation.clone();
    parent.add(g);
    this.antennas.push(g);
    return g;
  }

  addDangler(parent: THREE.Object3D, pos: [number, number, number]) {
    const g = new THREE.Group();
    g.position.set(...pos);
    parent.add(g);
    this.danglers.push(g);
    return g;
  }

  addNozzle(parent: THREE.Object3D, pos: [number, number, number], rot: [number, number, number], list: 'back' | 'foot') {
    const o = new THREE.Object3D();
    o.position.set(...pos);
    o.rotation.set(...rot);
    parent.add(o);
    (list === 'back' ? this.backNozzles : this.footNozzles).push(o);
    return o;
  }
}

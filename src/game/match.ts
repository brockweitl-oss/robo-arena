import * as THREE from 'three';
import type { GameRenderer } from '../render/renderer';
import { keyName, padName, DEFAULT_BINDINGS, type Input } from '../core/input';
import type { Settings } from '../core/save';
import type { HUD } from '../ui/hud';
import { ARENA_FACTORIES } from '../arena';
import type { ArenaBuild } from '../arena/types';
import { resolveLoadout } from '../data/parts';
import { PLAYER_PAINT, PLAYER_ROBOT_NAME, rivalById, type Paint } from '../data/characters';
import { RobotModel } from '../robot/model';
import { Animator } from '../robot/animator';
import { Fighter, emptyInput, GUARD_DOT, type FighterInput } from './fighter';
import { World, SIM_DT, type GameEvent, type WorldSnapshot } from './world';
import { AIPilot } from './ai';
import { ChaseCamera } from './camera';
import { ReplayCamera } from '../render/replayCamera';
import { ReplayBar } from '../ui/replayBar';
import { Effects } from '../vfx/effects';
import { TacticsView } from '../vfx/tacticsView';
import { ObjectiveView } from '../vfx/objectiveView';
import { OBJECTIVE } from './tactics';
import { audio, type LoopHandle } from '../audio/audio';
import { objectiveEnabled, type MatchConfig, type MatchResult } from './types';
import { groundHeightBelow, segmentHit } from './collision';
import { track } from '../core/telemetry';
import { InputRecorder, InputPlayer, quantizeInput, quantizeBombTarget, RULESET_VERSION, type Replay } from './replay';
import { PadInput, connectedPads } from '../core/padInput';
import type { NetSession } from '../net/online';
import { EventLedger, NET_GO_TICK, ROLLBACK_WINDOW, predictInput, sameInput } from '../net/rollback';
import { plannedBomb } from './bombAim';
import { BombAimView } from '../vfx/bombAimView';
import { AimIndicator } from '../vfx/aimIndicator';
import { Guide } from './guide';
import { GuideView } from '../ui/guideView';

type Phase = 'intro' | 'ready' | 'fight' | 'ko' | 'timeup' | 'outro' | 'done';
/** KO: seconds of impact beat on the downed robot, then the KO camera shot length. */
const KO_BEAT = 0.5;
const KO_CAM = 1.6;

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();

/** Launch capsule used in the match intro. */
class Capsule {
  readonly group = new THREE.Group();
  private top: THREE.Group;
  private bottom: THREE.Group;
  private glowMat: THREE.MeshStandardMaterial;
  openT = -1;

  constructor(paint: Paint) {
    const shell = new THREE.MeshPhysicalMaterial({ color: paint.secondary, metalness: 0.4, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.1 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x1d2027, metalness: 0.8, roughness: 0.35 });
    this.glowMat = new THREE.MeshStandardMaterial({ color: 0, emissive: new THREE.Color(paint.glow), emissiveIntensity: 5 });
    const half = (up: boolean) => {
      const g = new THREE.Group();
      const dome = new THREE.Mesh(new THREE.SphereGeometry(1.25, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), shell);
      if (!up) dome.rotation.x = Math.PI;
      dome.castShadow = true;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(1.28, 1.28, 0.22, 32), dark);
      band.position.y = up ? 0.11 : -0.11;
      band.castShadow = true;
      const seam = new THREE.Mesh(new THREE.TorusGeometry(1.29, 0.035, 8, 48), this.glowMat);
      seam.rotation.x = Math.PI / 2;
      seam.position.y = up ? 0.2 : -0.2;
      g.add(dome, band, seam);
      // panel fins
      for (let i = 0; i < 4; i++) {
        const fin = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.5), dark);
        const a = (i / 4) * Math.PI * 2;
        fin.position.set(Math.cos(a) * 1.05, up ? 0.6 : -0.6, Math.sin(a) * 1.05);
        fin.rotation.y = -a;
        fin.castShadow = true;
        g.add(fin);
      }
      return g;
    };
    this.top = half(true);
    this.bottom = half(false);
    this.group.add(this.top, this.bottom);
  }

  /** Open animation (0..1 progress driven externally). */
  setOpen(t: number) {
    const e = 1 - Math.pow(1 - Math.min(1, t), 3);
    this.top.position.set(0, e * 3.5, -e * 1.5);
    this.top.rotation.x = -e * 1.8;
    this.bottom.position.set(0, -e * 0.4, 0);
    this.bottom.scale.setScalar(Math.max(0.001, 1 - e));
    this.top.scale.setScalar(Math.max(0.001, 1 - Math.max(0, t - 0.5) * 2));
    this.glowMat.emissiveIntensity = 5 + e * 20;
  }

  dispose() {
    disposeTree(this.group);
  }
}

/** Free the GPU geometry and materials of a match-owned object tree (nothing in it is shared). */
function disposeTree(root: THREE.Object3D) {
  root.removeFromParent();
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.geometry.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose();
  });
}

interface Side {
  fighter: Fighter;
  model: RobotModel;
  anim: Animator;
  paint: Paint;
  thruster: LoopHandle;
  prevPos: THREE.Vector3;
  capsule: Capsule;
  capStart: THREE.Vector3;
  capEnd: THREE.Vector3;
  wasHover: boolean;
  ghostT: number;
  shield: THREE.Mesh;
  shieldPulse: number;
}

export interface MatchHost {
  gr: GameRenderer;
  input: Input;
  hud: HUD;
  settings: Settings;
  /** The player's saved paint job (equipped cosmetics applied). */
  playerPaint?: Paint;
  /** Show the pause menu; resolves with the chosen action. */
  pause(): Promise<'resume' | 'restart' | 'quit'>;
}

export class Match {
  private readonly skillAnchors = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skillRoots = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly skillChests = [new THREE.Vector3(), new THREE.Vector3()];
  readonly scene = new THREE.Scene();
  readonly arena: ArenaBuild;
  readonly world: World;
  readonly cam: ChaseCamera;
  private replayCamera: ReplayCamera | null = null;
  private replayBar: ReplayBar | null = null;
  /** Replay transport: paused, and a fast-forward target (fight seconds, -1 = none). */
  private replayHold = false;
  private seekTo = -1;
  private seekMuted = false;
  readonly fx: Effects;
  private tactics!: TacticsView;
  private objectiveView: ObjectiveView | null = null;
  /** Local player first, opponent second (HUD + pad colours). */
  private static readonly OBJ_COLORS = ['#37e8ff', '#ff4a3a'] as const;
  private sides: [Side, Side];
  private ai: AIPilot;
  /** Testing: an AI also drives the player (?autoplay). */
  private autoPilot: AIPilot | null = null;
  private phase: Phase = 'intro';
  private phaseT = 0;
  private acc = 0;
  private timeLeft: number;
  private fightTime = 0;
  private paused = false;
  private resolve!: (r: MatchResult) => void;
  /** Tab toggles free camera orbit; default is the auto-tracking camera. */
  private freeCam = false;
  private pInput: FighterInput = emptyInput();
  private bombAimViews: BombAimView[];
  private bombCursor = new THREE.Vector2();
  private bombAimActive = false;
  private bombRay = new THREE.Raycaster();
  private aimView!: AimIndicator;
  private skillCursor = new THREE.Vector2();
  private skillAimActive = false;
  private skillGoal: THREE.Vector3 | null = null;
  private hazardWarned: boolean[] = [];
  private lowHpT = 0;
  private lowHpBeeps = 0;
  private renderTime = 0;
  private ambience: LoopHandle | null = null;
  private steer = new THREE.Vector3();
  private winner = -1;
  private finish: 'ko' | 'time' = 'ko';
  readonly done: Promise<MatchResult>;
  private disposed = false;
  private worldSeed: number;
  private readySteps = 0;
  private aimAssist = 1;
  private aiSeed: number;
  private recorders: InputRecorder[] | null = null;
  private players: InputPlayer[] | null = null;
  private p2: PadInput | null = null;
  /** World id of the local player (online guests are robot 1). */
  private me: 0 | 1 = 0;
  /**
   * Online rollback state. Ticks count from the first 'ready' step, identically on every machine.
   * `netTick` is the frontier (next tick to simulate); every remote input below `netConfirmed` is known.
   */
  private net: NetSession | null = null;
  /** Spectating a room: both players' inputs come from the session, ~1 s behind live. */
  private watching = false;
  private watchStarted = false;
  /** Spectating: this match's input buffers (the session swaps in new ones when the next match starts). */
  private watchIn: [Map<number, FighterInput>, Map<number, FighterInput>] = [new Map(), new Map()];
  private watchLatest: [number, number] = [-1, -1];
  private netTick = 0;
  private netConfirmed = 0;
  private netSent = 0;
  private netDelay = 2;
  private netStall = 0;
  /** Local final hashes waiting for the opponent's, and hashes of simulated (maybe predicted) ticks. */
  private netSums = new Map<number, number>();
  private netPendingSums = new Map<number, number>();
  private netDesync = false;
  private netLeft = false;
  private netChecks = 0;
  /** Remote input used for each unconfirmed tick, and the world before each unconfirmed tick. */
  private netUsed = new Map<number, FighterInput>();
  private netSnaps = new Map<number, WorldSnapshot>();
  private netLastRemote: FighterInput | undefined;
  /** Tick on which the fight ended in the current timeline (-1 = still on). */
  private netEndTick = -1;
  /** The end is confirmed: no more rollback; the world runs on locally (fighters are locked). */
  private netFrozen = false;
  private netFightTicks = 120 * 60;
  private netLedger = new EventLedger();
  /** Rollback counters (e2e checks and telemetry). */
  readonly netStats = { rollbacks: 0, maxDepth: 0, resimTicks: 0, stallFrames: 0, slowFrames: 0 };
  /** First-time tactic tips (once per player, single-player modes only). */
  private tipQ: [string, string][] = [];
  private tipAt = 0;
  private netLocal = new Map<number, FighterInput>();
  private p2In: FighterInput = emptyInput();
  private practiceMode: 'idle' | 'move' | 'shoot' | 'full' | 'evade' | 'tells' | null = null;
  private practiceLog: { t: number; dmg: number }[] = [];
  /** Guided first match (brand-new pilots): step machine + prompt card. */
  private guide: Guide | null = null;
  private guideView: GuideView | null = null;
  /** KO camera moment: any key / click / pad button skips to the outro (offline only). */
  private koSkip = false;
  private koPads: boolean[] = [];
  private koListen = () => { this.koSkip = true; };
  /** Play-test telemetry accumulators. */
  private tel = {
    used: { jump: 0, airjump: 0, dash: 0, airdash: 0, fire: 0, bomb: 0, pod: 0, charge: 0 } as Record<string, number>,
    dmgTaken: {} as Record<string, number>,
    dmgDealt: {} as Record<string, number>,
    deflects: 0, parries: 0, confirms: 0, perfect: 0, hitsTaken: 0, hitsDealt: 0, kdTaken: 0, kdDealt: 0, hazardHits: 0, dodges: 0, pauses: 0,
    airT: 0, hoverT: 0, lockT: 0, fightT: 0,
    distSum: 0, distN: 0, dist: [0, 0, 0, 0] as number[],
    fpsMin: 999, fpsSum: 0, fpsN: 0, fpsAcc: 0, fpsFrames: 0,
    timeline: [] as number[][], nextSample: 0,
    device: 'kbm' as string,
  };

  constructor(private host: MatchHost, readonly cfg: MatchConfig) {
    const q = host.settings.quality;
    this.arena = ARENA_FACTORIES[cfg.arenaId](  { quality: q, renderer: host.gr.renderer });
    const s = this.scene;
    s.add(this.arena.root);
    s.background = this.arena.background;
    s.environment = this.arena.environment;
    s.fog = this.arena.fog;
    host.gr.setScene(s);
    host.gr.setQuality(q);

    const rival = rivalById(cfg.rivalId);
    const on = cfg.online;
    if (on) {
      this.me = on.me;
      this.net = on.session;
      this.netDelay = on.session.delay;
      this.watching = !!on.spectate;
      if (this.watching) {
        this.watchIn = on.session.inputs;
        this.watchLatest = on.session.latest;
      }
      this.netFightTicks = Math.round((cfg.timeLimit ?? 120) * 60);
    }
    const foe = on ? on.players[1 - on.me] : null;
    const vs = cfg.versus ?? (foe ? { p2Loadout: foe.loadout, p2Paint: foe.paint, p2Name: foe.name } : undefined);
    const pLo = resolveLoadout(on ? on.players[on.me].loadout : cfg.playerLoadout);
    const rLo = resolveLoadout(vs ? vs.p2Loadout : cfg.rivalLoadout ?? rival.loadout);
    // world ids: the online host is robot 0 on both machines; sides[0] is always the local player
    const pf = new Fighter(this.me, pLo);
    const rf = new Fighter(1 - this.me, rLo);
    // seeds: from the replay being watched, the online room, or fresh (recorded for this match's replay)
    this.worldSeed = cfg.replay ? cfg.replay.worldSeed : on ? on.seed : 12345;
    this.aiSeed = cfg.replay ? cfg.replay.aiSeed : 7;
    this.world = new World(this.arena, ...((this.me === 0 ? [pf, rf] : [rf, pf]) as [Fighter, Fighter]), { arenaId: cfg.arenaId, pickups: !!cfg.pickups, objective: objectiveEnabled(cfg), seed: this.worldSeed });
    const practice = cfg.practice?.dummy;
    // training dummies: the evader and skill shooter are top-tier readers so the drills are honest
    this.ai = practice === 'evade' || practice === 'tells' ? new AIPilot('champion', practice === 'evade' ? 1 : 0.8, this.aiSeed) : new AIPilot(rival.ai, practice ? 0.5 : rival.skill, this.aiSeed);
    if (cfg.replay) {
      this.players = cfg.replay.streams.map((s) => new InputPlayer(s));
    } else if (cfg.mode !== 'practice' && !on) {
      this.recorders = vs ? [new InputRecorder(), new InputRecorder()] : [new InputRecorder()];
    }
    if (vs && !on) {
      // player 2 on a gamepad; with two pads, player 1 uses the first and player 2 the second
      const pads = connectedPads();
      this.p2 = new PadInput(pads.length >= 2 ? pads[1] : pads[0] ?? 0);
      host.input.ignorePad = pads.length >= 2 ? -1 : (pads[0] ?? -1);
    }
    if (cfg.survival) pf.hp = Math.max(1, Math.min(pf.maxHp, cfg.survival.startHp));
    if (practice) {
      // practice room: both robots refill; no clock
      rf.maxHp = rf.hp = 9999;
      this.practiceMode = practice;
    }
    // replays use the assist recorded with them, never the current setting (determinism)
    this.aimAssist = cfg.replay ? cfg.replay.aimAssist ?? 1 : vs ? 1 : host.settings.aimAssist ?? 1;
    pf.homingMul = this.aimAssist;
    // AI uses the same weapon rules as players; difficulty comes from reaction and decisions.
    if (on) pf.homingMul = 1;
    if (!vs) {
      rf.homingMul = 1;
      rf.aimJitter = 0;
    }
    this.timeLeft = practice ? Infinity : cfg.timeLimit ?? 120;
    if (new URLSearchParams(location.search).has('autoplay')) this.autoPilot = new AIPilot('champion', 1, 99);
    if (cfg.guided && !this.autoPilot && !on && !vs && !practice) {
      this.guide = new Guide();
      if (!cfg.replay) this.guideView = new GuideView(host.hud.el);
      // room to learn: the clock starts longer than a normal round
      if (!cfg.timeLimit) this.timeLeft = 180;
    }
    this.fx = new Effects(s, q);
    this.bombAimViews = Array.from({ length: 3 }, () => new BombAimView(s));
    this.aimView = new AimIndicator(s);
    this.cam = new ChaseCamera(host.gr.camera);
    this.cam.shakeEnabled = host.settings.cameraShake;

    const mkSide = (f: Fighter, lo: typeof pLo, paint: Paint, spawn: THREE.Vector3, other: THREE.Vector3): Side => {
      const model = new RobotModel(lo, paint, { shadows: q !== 'low' });
      s.add(model.root);
      model.root.visible = false;
      const anim = new Animator(model);
      const side: Side = {
        fighter: f, model, anim, paint, thruster: audio.loop('thruster', { pos: spawn, volume: 0 }), prevPos: spawn.clone(),
        capsule: new Capsule(paint), capStart: new THREE.Vector3(), capEnd: spawn.clone(), wasHover: false, ghostT: 0,
        shield: Match.makeShield(paint.glow), shieldPulse: 0,
      };
      side.thruster.set(0);
      s.add(side.shield);
      f.pos.copy(spawn);
      f.yaw = Math.atan2(other.x - spawn.x, other.z - spawn.z);
      f.locked = true;
      f.setMode('intro');
      const away = spawn.clone().sub(other).setY(0).normalize();
      side.capStart.copy(spawn).addScaledVector(away, 16).setY(15);
      side.capsule.group.position.copy(side.capStart);
      s.add(side.capsule.group);
      this.fx.registerRobot(model, paint.glow);
      anim.onStep = () => {
        audio.play('footstep', { pos: f.pos, volume: f.id === this.me ? 0.8 : 0.6 });
        this.fx.footDust(f.pos, 0.8);
      };
      return side;
    };
    const [a0, a1] = this.arena.spawns;
    const [sp0, sp1] = this.me === 0 ? [a0, a1] : [a1, a0];
    this.sides = [mkSide(pf, pLo, on ? on.players[on.me].paint : host.playerPaint ?? PLAYER_PAINT, sp0, sp1), mkSide(rf, rLo, vs ? vs.p2Paint : rival.paint, sp1, sp0)];
    this.cam.snapBehind(sp0, sp1);
    this.hazardWarned = this.arena.hazards.map(() => false);
    this.tactics = new TacticsView(this.world, this.fx, s);
    if (this.world.objective) {
      const [mine, theirs] = Match.OBJ_COLORS.map((c) => new THREE.Color(c).getHex());
      this.objectiveView = new ObjectiveView(this.world, this.fx, s, this.me === 0 ? [mine, theirs] : [theirs, mine]);
    }

    const names: [string, string, string, string] = vs
      ? on ? [on.players[on.me].name, on.spectate ? 'P1' : 'YOU', vs.p2Name, on.spectate ? 'P2 · LIVE' : on.ranked ? `RATED ${on.players[1 - on.me].rating ?? 1000}` : 'ONLINE'] : [PLAYER_ROBOT_NAME, 'P1', vs.p2Name, 'P2']
      : practice ? [PLAYER_ROBOT_NAME, 'YOU', 'Training Dummy', 'PRACTICE'] : [rival.robotName, rival.pilot, '', ''];
    if (!vs && !practice) {
      names[2] = names[0];
      names[3] = names[1];
      names[0] = PLAYER_ROBOT_NAME;
      names[1] = cfg.replay ? 'REPLAY' : cfg.survival ? `ROUND ${cfg.survival.round}` : 'YOU';
    }
    host.hud.setup(pf, rf, names, host.input.lastDevice === 'pad');
    host.hud.setPractice(!!practice);
    host.hud.damageNumbers = host.settings.damageNumbers;
    host.hud.show(true);
    host.hud.clearAnnounce();
    audio.playMusic(rival.id.startsWith('sable') ? 'champion' : (this.arena.info.music as any));
    const amb = ({ foundry: 'ambience_foundry', garden: 'ambience_garden', orbital: 'ambience_orbital' } as const)[cfg.arenaId as 'foundry'];
    if (amb) this.ambience = audio.loop(amb);
    audio.play('capsule_launch', { volume: 0.9 });

    host.input.enabled = false;
    host.input.onPause = () => this.togglePause();
    host.input.onLockToggle = () => {
      this.freeCam = !this.freeCam;
      this.cam.lock = !this.freeCam;
      host.hud.showHint(this.freeCam ? 'Free camera: mouse / right stick to look. Tab: back to auto camera' : 'Auto camera: tracks your opponent', 2.5);
      audio.play('ui_move');
    };
    this.done = new Promise((r) => (this.resolve = r));
    track('match_start', { mode: cfg.mode, rival: cfg.rivalId, arena: cfg.arenaId, ladderIndex: cfg.ladderIndex, loadout: cfg.playerLoadout, quality: q, timeLimit: this.timeLeft });
    // intro camera: wide establishing shot
    this.cam.cine = { pos: new THREE.Vector3(sp0.x * 0.2 + 14, 13, sp0.z * 1.6), look: new THREE.Vector3(0, 1, 0), k: 2 };
    host.gr.camera.position.copy(this.cam.cine.pos).add(new THREE.Vector3(6, 6, 6));
    // pre-compile every shader now (robots are hidden until their capsules open)
    for (const sd of this.sides) sd.model.root.visible = true;
    host.gr.precompile(s, host.gr.camera);
    for (const sd of this.sides) sd.model.root.visible = false;
    if (this.watching) {
      // spectating: broadcast-style camera, no controls
      this.replayCamera = new ReplayCamera(host.gr.camera, this.arena.colliders);
      this.replayCamera.attach(host.hud.el.parentElement!, host.gr.renderer.domElement);
    }
    if (cfg.replay) {
      this.replayCamera = new ReplayCamera(host.gr.camera, this.arena.colliders);
      this.replayCamera.attach(host.hud.el.parentElement!, host.gr.renderer.domElement);
      const total = cfg.replay.summary?.time ?? Math.max(1, cfg.replay.frames / 60 - 1.1);
      this.seekTo = cfg.replaySeek ?? -1;
      this.replayHold = !!cfg.replayPaused;
      cfg.replaySeek = undefined;
      this.replayBar = new ReplayBar(host.hud.el.parentElement!, total, {
        now: () => this.fightTime,
        toggle: () => { this.replayHold = !this.replayHold; },
        seek: (t) => {
          t = Math.max(0, Math.min(total, t));
          if (t >= this.fightTime) this.seekTo = t;
          else {
            // back: replay from the start and fast-forward (deterministic, lands on the same state)
            this.cfg.replaySeek = t;
            this.cfg.replayPaused = this.replayHold;
            this.end({ restart: true });
          }
        },
      });
    }
  }

  private get player() {
    return this.sides[0];
  }

  /** The presentation side for a world fighter id (sides[0] is always the local player). */
  private sideOf(id: number) {
    return this.sides[0].fighter.id === id ? this.sides[0] : this.sides[1];
  }

  private togglePause() {
    if (this.paused || this.phase === 'done' || this.phase === 'outro') return;
    this.paused = true;
    this.tel.pauses++;
    this.host.input.enabled = false;
    this.host.input.releaseLock();
    for (const s of this.sides) s.thruster.set(0);
    this.host.pause().then((a) => {
      if (this.disposed) return;
      this.paused = false;
      // online: restarting would desync the shared sim
      if (a === 'resume' || (a === 'restart' && this.cfg.online)) {
        this.host.input.clear();
        this.host.input.enabled = this.phase === 'fight' || this.phase === 'ready';
        if (this.host.input.enabled && !this.players) this.host.input.requestLock();
      } else this.end({ quit: a === 'quit', restart: a === 'restart' });
    });
  }

  /* ------------------------------------------------------------------ frame */

  /**
   * The tab is hidden, so requestAnimationFrame has stopped. An online player's sim and input
   * stream keep running here (nothing renders) so the opponent is not stalled into a false
   * "disconnected" forfeit by an alt-tab. Offline matches and spectating simply wait.
   */
  backgroundTick(dt: number) {
    if (this.disposed || !this.net || this.watching || this.phase === 'done') return;
    let left = Math.min(dt, 1);
    while (left > 1e-6 && this.net) {
      const d = Math.min(left, 1 / 60);
      left -= d;
      this.phaseT += d;
      this.renderTime += d;
      this.updatePhase(d);
      if (this.phase !== 'intro' && this.net) this.netFrame(d);
    }
  }

  frame(dtReal: number) {
    if (this.disposed) return;
    const host = this.host;
    host.input.pollPad();
    this.p2?.poll();
    const look = host.input.consumeLook(dtReal, host.settings.sensitivity);
    if (this.paused && !this.net) {
      host.gr.render(dtReal);
      return;
    }
    this.updateSkillAim(look);
    this.updateBombAim(look);
    // Competitive combat always advances in real time.
    const dt = dtReal;
    this.phaseT += dtReal + (this.seekTo >= 0 && this.phase === 'intro' ? 0.25 : 0);
    this.renderTime += dt;
    this.updatePhase(dtReal);

    // --- simulation ---
    const simming = this.phase !== 'intro';
    const seeking = this.seekTo >= 0;
    if (seeking !== this.seekMuted) {
      // fast-forward silently
      this.seekMuted = seeking;
      const st = host.settings;
      audio.setVolumes(seeking ? 0 : st.master, st.sfx, st.music);
    }
    if (simming && this.net) {
      if (this.watching) this.watchFrame(dtReal);
      else this.netFrame(dtReal);
    } else if (simming && !(this.replayHold && !seeking)) {
      this.acc += seeking ? SIM_DT * 600 : dt;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < (seeking ? 600 : 5)) {
        if (this.seekTo >= 0 && this.phase !== 'ready' && (this.fightTime >= this.seekTo || this.phase !== 'fight')) {
          this.seekTo = -1;
          this.acc = 0;
          break;
        }
        this.beginSimulationStep();
        for (const s of this.sides) s.prevPos.copy(s.fighter.pos);
        const pf = this.player.fighter;
        const rf = this.sides[1].fighter;
        host.input.sample(this.cam.moveYaw, false, this.pInput);
        if (this.autoPilot && !pf.locked) Object.assign(this.pInput, this.autoPilot.think(this.world, pf, rf));
        let aiIn: FighterInput;
        if (this.players) {
          // replay playback: recorded inputs; AI re-thinks deterministically from the recorded seed
          Object.assign(this.pInput, this.players[0].next());
          aiIn = this.players[1] ? this.players[1].next() : rf.locked ? emptyInput() : this.ai.think(this.world, rf, pf);
        } else if (this.p2) {
          aiIn = this.p2.sample(this.cam.moveYaw, this.p2In);
        } else if (this.practiceMode === 'idle' || rf.locked) {
          aiIn = emptyInput();
        } else {
          aiIn = this.ai.think(this.world, rf, pf);
          if (this.practiceMode === 'move') aiIn = { ...aiIn, gunPressed: false, gunHeld: false, bombPressed: false, podPressed: false, chargePressed: false, skillPressed: false };
          else if (this.practiceMode === 'shoot') aiIn = { ...aiIn, moveX: 0, moveZ: 0, dashPressed: false, jumpPressed: false, chargePressed: false };
          else if (this.practiceMode === 'evade') aiIn = { ...aiIn, gunPressed: false, gunHeld: false, bombPressed: false, podPressed: false, skillPressed: false };
          else if (this.practiceMode === 'tells') aiIn = { ...aiIn, gunPressed: false, gunHeld: false, bombPressed: false, podPressed: false, chargePressed: false };
        }
        if (this.guide && !this.guide.rivalArmed && !this.p2 && !(this.players && this.players[1])) {
          // guided match: the rival moves but holds its attacks until the guard lesson
          aiIn = { ...aiIn, gunPressed: false, gunHeld: false, bombPressed: false, podPressed: false, chargePressed: false, skillPressed: false };
        }
        if (this.recorders) {
          // the sim must see exactly what the replay stores
          quantizeInput(this.pInput);
          this.recorders[0].push(this.pInput);
          if (this.recorders[1]) {
            aiIn = quantizeInput({ ...aiIn });
            this.recorders[1].push(aiIn);
          }
        }
        this.world.step(this.me === 0 ? [this.pInput, aiIn] : [aiIn, this.pInput]);
        if (this.phase === 'ready') this.readySteps++;
        if (this.practiceMode) {
          for (const f of [pf, rf]) if (f.hp < f.maxHp * 0.5) f.hp = f.maxHp;
        }
        this.handleEvents(this.world.events);
        if (this.guide && this.phase === 'fight') this.guide.tick(SIM_DT, Math.hypot(pf.pos.x - this.player.prevPos.x, pf.pos.z - this.player.prevPos.z));
        if (this.phase === 'fight') {
          if (this.players && this.players[0].done) this.onTimeUp();
          this.fightTime += SIM_DT;
          this.timeLeft -= SIM_DT;
          if (this.timeLeft <= 0) this.onTimeUp();
        }
        this.acc -= SIM_DT;
        steps++;
      }
      if (steps === 5 || seeking) this.acc = 0;
    }
    const alpha = simming ? this.acc / SIM_DT : 1;

    // --- tips ---
    if (this.phase === 'fight') {
      const pk = this.host.input.lastDevice === 'pad';
      this.tip('skill', `Skill shot: hold ${pk ? 'Y' : 'R'} to aim the lane, release to fire. Your gun auto-aims; your skill does not.`);
      if (this.fightTime > 25) this.tip('chips', "Under the enemy's health bar: their skill, bomb, pod and guard cooldowns. Push in when they're spent.");
      if (this.fightTime > 45) this.tip('dashjump', 'Jump at the end of a dash to keep its speed (dash-jump). Heavier builds start and stop slower.');
      this.showTips();
    }
    if (this.guideView && this.guide) this.guideView.update(this.guide, this.phase === 'fight' && !this.paused, this.host.input.lastDevice === 'pad', host.settings.bindings, this.renderTime);

    this.replayBar?.update(this.fightTime, !this.replayHold, this.seekTo >= 0);

    // --- presentation ---
    this.arena.update(this.renderTime, dt);
    for (const s of this.sides) this.updateSide(s, dt, alpha);
    for (const s of this.sides) {
      const p = s.fighter.primer;
      const anchor = s.model.rig.lockPoint.getWorldPosition(_v2);
      this.skillChests[s.fighter.id].copy(anchor); anchor.y += .28;
      this.fx.updateComboMarker(s.fighter.id as 0 | 1, anchor, p?.remaining ?? 0, p?.duration ?? 2, p?.armed ? 0xffd36a : 0x5adfff);
      s.model.rig.skillMuzzle.getWorldPosition(this.skillAnchors[s.fighter.id]);
      s.model.root.getWorldPosition(this.skillRoots[s.fighter.id]);
    }
    this.fx.syncSkillStates(this.world.fighters, this.skillAnchors, this.skillRoots, this.skillChests);
    this.fx.syncProjectiles(this.world.projectiles, dt, this.skillAnchors);
    this.fx.syncBombs(this.world.bombs, dt);
    this.fx.syncPods(this.world.pods, dt);
    this.tactics.update(dt);
    this.objectiveView?.update(dt);
    this.aimView.update(this.player.fighter, this.sides[1].fighter, this.skillGoal, this.arena.colliders, this.renderTime);
    this.fx.update(dt);

    const pf = this.player.fighter;
    const rf = this.sides[1].fighter;
    const pPos = this.player.model.root.position;
    const rPos = this.sides[1].model.root.position;
    if (this.replayCamera) {
      this.replayCamera.update(dtReal, pPos, rPos);
    } else if (this.phase === 'intro') {
      this.cam.update(dtReal, this.player.capsule.group.position, this.sides[1].capsule.group.position, look, host.settings.invertY, this.arena.colliders, true);
    } else {
      this.cam.update(dtReal, pPos, rPos, this.phase === 'fight' || this.phase === 'ready' ? look : { dx: 0, dy: 0 }, host.settings.invertY, this.arena.colliders, !pf.grounded);
    }
    const cam = host.gr.camera;
    _v.set(1, 0, 0).applyQuaternion(cam.quaternion);
    audio.setListener(cam.position, _v);

    // HUD
    const lp = this.sides[1].model.rig.lockPoint.getWorldPosition(_v2);
    const proj = lp.clone().project(cam);
    const W = host.hud.el.clientWidth;
    const H = host.hud.el.clientHeight;
    const camDir = cam.getWorldDirection(new THREE.Vector3());
    const behind = lp.clone().sub(cam.position).dot(camDir) < 0;
    // off-screen threats: enemy bombs and pods that are not visible
    const threats: { x: number; y: number; behind: boolean; color: string }[] = [];
    if (this.phase === 'fight') {
      const add = (p: THREE.Vector3, color: number) => {
        const v = p.clone().project(cam);
        const bh = p.clone().sub(cam.position).dot(camDir) < 0;
        const sx = (v.x * 0.5 + 0.5) * W;
        const sy = (-v.y * 0.5 + 0.5) * H;
        if (bh || sx < 0 || sx > W || sy < 0 || sy > H) threats.push({ x: sx, y: sy, behind: bh, color: '#' + new THREE.Color(color).getHexString() });
      };
      for (const b of this.world.bombs) if (b.owner !== this.me) add(b.target, b.def.color);
      for (const p of this.world.pods) if (p.owner !== this.me && p.pos.distanceTo(pf.pos) < 14) add(p.pos, p.def.color);
    }
    const ob = this.world.objective;
    if (ob && this.phase !== 'intro') {
      const inSec = this.world.objectiveIn(), online = ob.untilTick >= 0;
      host.hud.objective({
        state: online ? 'online' : inSec <= OBJECTIVE.warn ? 'soon' : 'off', inSec, leftSec: online ? (ob.untilTick - ob.tick) * SIM_DT : 0,
        meters: [ob.meters[this.me] / OBJECTIVE.capture, ob.meters[1 - this.me] / OBJECTIVE.capture], contested: ob.contested, colors: [...Match.OBJ_COLORS],
      });
    } else host.hud.objective(null);
    host.hud.update(dtReal, [pf, rf], this.timeLeft, { x: (proj.x * 0.5 + 0.5) * W, y: (-proj.y * 0.5 + 0.5) * H, on: this.phase === 'fight' && rf.alive, behind }, !this.freeCam, threats);
    if (this.phase === 'fight') this.telFrame(dtReal, pf, rf);
    if (this.practiceMode) {
      const now = this.world.time;
      this.practiceLog = this.practiceLog.filter((h) => now - h.t < 6);
      const recent = this.practiceLog.filter((h) => now - h.t < 2.0);
      const last = this.practiceLog[this.practiceLog.length - 1];
      const dps = this.practiceLog.filter((h) => now - h.t < 5).reduce((a, h) => a + h.dmg, 0) / 5;
      const ps = pf.stats;
      host.hud.practiceInfo({ last: last ? last.dmg : 0, combo: recent.reduce((a, h) => a + h.dmg, 0), dps, down: Math.round((rf.down / rf.endurance) * 100),
        skill: `${ps.skillHits}/${ps.skillCasts}`, sweet: ps.sweetSpots, feints: ps.feints, dodged: `${rf.stats.skillCasts - rf.stats.skillHits}/${rf.stats.skillCasts}`, perfect: this.tel.perfect });
    }
    if (this.cfg.versus && !this.replayCamera && this.phase !== 'intro') this.versusCamera(pPos, rPos);
    if (this.phase === 'fight' && pf.hp / pf.maxHp < 0.25) {
      this.lowHpT -= dtReal;
      if (this.lowHpT <= 0) {
        // urgent while it is news, then a slower reminder instead of a 1.3 s alarm for the rest of the round
        this.lowHpBeeps++;
        audio.play('low_hp', { volume: this.lowHpBeeps <= 4 ? 0.7 : 0.45 });
        this.lowHpT = this.lowHpBeeps <= 4 ? 1.3 : 3.2;
      }
    }
    host.gr.render(dtReal);
  }

  private updateSide(s: Side, dt: number, alpha: number) {
    const f = s.fighter;
    const m = s.model;
    m.setSkillCharge(f.castT >= 0 ? .25 + .75 * (1 - Math.min(1, f.castT / f.lo.skill.cast)) : 0);
    if (s.capsule.openT >= 0 && s.capsule.group.visible) {
      s.capsule.openT += dt;
      s.capsule.setOpen(s.capsule.openT / 0.6);
      if (s.capsule.openT > 0.75) s.capsule.group.visible = false;
    }
    // render-interpolated position
    if (this.phase !== 'intro' || s.capsule.openT >= 0) {
      _v.copy(s.prevPos).lerp(f.pos, alpha);
      const frozen = f.hitstop > 0;
      const animDt = frozen ? 0 : dt;
      const savePos = f.pos.clone();
      f.pos.copy(_v);
      s.anim.update(f, animDt);
      f.pos.copy(savePos);
      if (frozen) {
        // hit-stop shudder
        m.root.position.x += (Math.random() - 0.5) * 0.08;
        m.root.position.z += (Math.random() - 0.5) * 0.08;
      }
    }
    // thrusters
    let back = 0;
    let foot = 0;
    const mode = f.mode;
    if (f.hovering) {
      back = 1;
      foot = 0.85;
    } else if (mode === 'dash' || mode === 'airdash') {
      back = 1.25;
      foot = mode === 'airdash' ? 0.6 : 0.2;
    } else if (mode === 'charge' && f.chargePhase === 1) back = 1.1;
    else if (mode === 'air' && f.vel.y > 4) {
      back = 0.45;
      foot = 0.9;
    } else if (mode === 'down' && !f.grounded) back = 0.3;
    m.setThrust(back, foot);
    const loudness = Math.max(back, foot * 0.8);
    s.thruster.set(Math.min(1, loudness), 0.9 + loudness * 0.25);
    s.thruster.setPos(f.pos);
    if (f.hovering) {
      for (const n of m.rig.footNozzles) if (Math.random() < 0.5) this.fx.thrusterPuff(n.getWorldPosition(_v), s.paint.glow, new THREE.Vector3(0, -1, 0), 0.8);
      // hover downwash dust
      const gh = groundHeightBelow(f.pos.x, f.pos.z, f.pos.y, this.arena.colliders);
      if (f.pos.y - gh < 3 && Math.random() < 0.3) this.fx.dustRing(new THREE.Vector3(f.pos.x, gh, f.pos.z), 0.6, 3);
    }
    if (mode === 'dash' || mode === 'airdash') {
      s.ghostT -= dt;
      if (s.ghostT <= 0) {
        this.fx.afterimage(m);
        s.ghostT = 0.045;
      }
      this.fx.dashTrail(f.pos, f.vel, s.paint.glow);
    } else s.ghostT = 0;
    m.setPodReady(f.podCd <= 0);
    (m as unknown as { setDamage?: (f: number) => void }).setDamage?.(f.hp / f.maxHp);
    // charge guard shield
    const sh = s.shield;
    const on = f.guarding ? 1 : 0;
    const mat = sh.material as THREE.ShaderMaterial;
    s.shieldPulse = Math.max(0, s.shieldPulse - dt * 4);
    mat.uniforms.uAlpha.value += (on * (0.75 + s.shieldPulse) - mat.uniforms.uAlpha.value) * Math.min(1, dt * 25);
    sh.visible = mat.uniforms.uAlpha.value > 0.01;
    if (sh.visible) {
      sh.position.set(f.pos.x + Math.sin(f.yaw) * 0.35, f.pos.y + 1.1, f.pos.z + Math.cos(f.yaw) * 0.35);
      sh.rotation.set(0, f.yaw, 0);
      sh.scale.setScalar(1 + s.shieldPulse * 0.25);
      mat.uniforms.uTime.value = this.renderTime;
    }
    // invulnerability blink
    m.root.visible = s.capsule.openT >= 0 && !(f.invuln > 0 && Math.floor(this.renderTime * 20) % 2 === 0);
    m.update(this.renderTime, dt);
  }

  /* ------------------------------------------------------------------ phases */

  /** Unlock on the exact recorded tick, regardless of render-frame batching. */
  private beginSimulationStep() {
    if (this.phase !== 'ready' || this.readySteps < 66) return;
    this.host.hud.announce('GO!', { color: '#ff6a1f' });
    audio.play('announce_go');
    for (const s of this.sides) s.fighter.locked = false;
    this.world.combatEnabled = true;
    this.setPhase('fight');
  }

  private updatePhase(dt: number) {
    const t = this.phaseT;
    const host = this.host;
    if (this.phase === 'intro') {
      const flight = 1.45;
      for (const s of this.sides) {
        const isP = s.fighter.id === this.me;
        if (isP && t < flight && !this.net) {
          // player can angle the landing a little
          const ax = host.input.moveAxes();
          const fx = Math.sin(this.cam.moveYaw);
          const fz = Math.cos(this.cam.moveYaw);
          this.steer.x = THREE.MathUtils.clamp(this.steer.x + (fx * ax.y - fz * ax.x) * dt * 4, -3, 3);
          this.steer.z = THREE.MathUtils.clamp(this.steer.z + (fz * ax.y + fx * ax.x) * dt * 4, -3, 3);
        }
        const end = s.capEnd.clone().add(isP ? this.steer : new THREE.Vector3());
        end.y = groundHeightBelow(end.x, end.z, 1, this.arena.colliders);
        const g = s.capsule.group;
        if (t < flight) {
          const k = t / flight;
          g.position.lerpVectors(s.capStart, end, k);
          g.position.y = THREE.MathUtils.lerp(s.capStart.y, end.y + 1.25, k) + Math.sin(k * Math.PI) * 6;
          g.rotation.set(k * 9, k * 4, 0);
          if (Math.random() < 0.8) this.fx.thrusterPuff(g.position, s.paint.glow, new THREE.Vector3(0, 1, 0), 0.5);
          this.fx.sparks.emit({ pos: g.position, count: 2, spread: 0.6, size: [0.6, 0.9], life: [0.2, 0.35], color: s.paint.glow, intensity: 1.6 });
        } else {
          // bounces: 2 hops decaying
          const bt = t - flight;
          const hops = [0.42, 0.26];
          let y = 0;
          let acc = 0;
          for (let i = 0; i < hops.length; i++) {
            if (bt >= acc && bt < acc + hops[i]) {
              const u = (bt - acc) / hops[i];
              y = Math.sin(u * Math.PI) * (i === 0 ? 1.6 : 0.6);
            }
            acc += hops[i];
          }
          g.position.set(end.x, end.y + 1.25 + y, end.z);
          g.rotation.x *= 0.85;
          g.rotation.z = Math.sin(bt * 20) * 0.15 * Math.max(0, 1 - bt * 2);
          s.fighter.pos.set(end.x, end.y, end.z);
          s.prevPos.copy(s.fighter.pos);
          const bounceAt = [0, hops[0], hops[0] + hops[1]];
          for (const ba of bounceAt) {
            if (bt - dt < ba && bt >= ba) {
              audio.play('capsule_bounce', { pos: g.position, volume: ba === 0 ? 1 : 0.6 });
              this.fx.dustRing(new THREE.Vector3(end.x, end.y, end.z), ba === 0 ? 2.2 : 1.2, ba === 0 ? 18 : 10);
            }
          }
          const openAt = hops[0] + hops[1] + 0.25;
          if (bt >= openAt && s.capsule.openT < 0) {
            s.capsule.openT = 0;
            audio.play('capsule_open', { pos: g.position });
            this.fx.burst(g.position.clone(), s.paint.glow, 1.1);
            s.model.root.visible = true;
            s.anim.event({ type: 'land', strength: 1 });
            s.fighter.setMode('ground');
          }
        }
      }
      // camera: from wide shot, follow the player's capsule, then swing behind
      const pc = this.player.capsule.group.position;
      if (t < flight) this.cam.cine = { pos: pc.clone().add(new THREE.Vector3(6, 5, 8)), look: pc.clone(), k: 2.5 };
      else this.cam.cine = null;
      if (t > flight + 1.05) this.setPhase('ready');
    } else if (this.phase === 'fight') {
      // hazard telegraphs
      this.arena.hazards.forEach((hz, i) => {
        const w = hz.isWarning(this.world.time);
        if (w && !this.hazardWarned[i]) audio.play('hazard_warn', { pos: hz.center, volume: 0.8 });
        this.hazardWarned[i] = w;
      });
    } else if (this.phase === 'ko') {
      const loser = this.sideOf(this.winner === 0 ? 1 : 0);
      const lf = loser.fighter;
      const koCam = this.koCamOn();
      if (koCam && t >= KO_BEAT) {
        // KO camera moment (real time, no slow-motion): a cut to a low angle that frames the
        // winner standing over the downed loser, slowly orbiting, then the outro
        this.koCamera(t);
        if (!this.koSkip) this.koSkip = this.koPadPressed();
        if (this.koSkip && !this.net && t > KO_BEAT + 0.15) { this.startOutro(); return; }
      } else if (t < 1.8) {
        // camera on the KO'd robot during the real-time result beat
        const c = loser.model.root.position;
        if (this.shotYaw === null) {
          const cp = host.gr.camera.position;
          this.shotYaw = this.clearShot(c, Math.atan2(cp.x - c.x, cp.z - c.z), 4.2, 2.0);
        }
        const y = this.shotYaw;
        this.cam.cine = { pos: c.clone().add(new THREE.Vector3(Math.sin(y) * this.shotDist, this.shotH, Math.cos(y) * this.shotDist)), look: c.clone().add(new THREE.Vector3(0, 0.8, 0)), k: 3 };
      }
      if (t > 1.8 && lf.grounded && lf.mode === 'down') {
        lf.setMode('defeat');
      }
      if (lf.mode === 'defeat') {
        loser.model.power = Math.max(0.1, loser.model.power - dt * 0.8) * (Math.random() < 0.1 ? 0.3 : 1);
        if (Math.random() < 0.15) this.fx.impact(loser.model.rig.chest.getWorldPosition(_v).clone(), new THREE.Vector3(0, 1, 0), 0xffa040, 0.4);
      }
      if (t > (koCam ? KO_BEAT + KO_CAM : 2.2)) this.startOutro();
    } else if (this.phase === 'timeup') {
      if (t > 2.0) this.startOutro();
    } else if (this.phase === 'outro') {
      const w = this.sideOf(this.winner >= 0 ? this.winner : this.me);
      const c = w.model.root.position;
      if (this.shotYaw === null) this.shotYaw = this.clearShot(c, w.fighter.yaw + 0.5, 3.4, 1.5);
      const yaw = this.shotYaw + Math.sin(t * 0.4) * 0.12;
      this.cam.cine = { pos: c.clone().add(new THREE.Vector3(Math.sin(yaw) * this.shotDist, this.shotH, Math.cos(yaw) * this.shotDist)), look: c.clone().add(new THREE.Vector3(0, 1.1, 0)), k: t < 0.1 ? 8 : 3 };
      if (t > 3.6) this.end({});
    }
  }

  private shotYaw: number | null = null;
  private koYaw: number | null = null;
  private koDist = 5;
  private koH = 0.5;

  /** The KO camera runs for clean single-winner KOs with the normal chase camera. */
  private koCamOn() {
    return this.winner >= 0 && this.finish === 'ko' && !this.replayCamera && this.seekTo < 0 && !this.practiceMode;
  }

  private koCamera(t: number) {
    const w = this.sideOf(this.winner);
    const l = this.sideOf(1 - this.winner);
    const W = w.model.root.position, L = l.model.root.position;
    const u = Math.min(1, (t - KO_BEAT) / KO_CAM);
    // close KOs: low behind the downed loser, looking across it at the winner standing over it.
    // long-range KOs: low behind the winner, which towers in the foreground over the distant loser.
    const near = Math.hypot(W.x - L.x, W.z - L.z) <= 9;
    const A = near ? L : W, B = near ? W : L;
    if (this.koYaw === null) {
      const away = Math.atan2(A.x - B.x, A.z - B.z);
      this.koYaw = this.clearShot(A, away + 0.75, near ? 5 : 4.8, near ? 0.75 : 0.4);
      this.koDist = this.shotDist;
      this.koH = this.shotH;
    }
    // ease-in-out orbit across the 1.6 s shot
    const e = u * u * (3 - 2 * u);
    const yaw = this.koYaw - 0.25 + e * 0.5;
    const pos = A.clone().add(new THREE.Vector3(Math.sin(yaw) * this.koDist, this.koH + e * 0.25, Math.cos(yaw) * this.koDist));
    // aim between the two directions so both robots stay in frame at any range
    const toW = W.clone().add(new THREE.Vector3(0, 1.4, 0)).sub(pos).normalize();
    const toL = L.clone().add(new THREE.Vector3(0, 0.5, 0)).sub(pos).normalize();
    const look = pos.clone().addScaledVector(toW.multiplyScalar(1.25).add(toL).normalize(), 8);
    this.cam.cine = { pos, look, k: u < 0.04 ? 60 : 7 };
    // the winner strikes its victory pose once it is standing (offline only: online keeps sim timing untouched)
    const wf = w.fighter;
    if (!this.net && wf.mode !== 'victory' && wf.grounded && (wf.mode === 'ground' || wf.mode === 'charge' || wf.mode === 'stagger')) wf.setMode('victory');
  }

  private koStartListen() {
    if (this.net || this.cfg.online || this.players) return;
    this.koSkip = false;
    this.koPads = this.padButtons();
    window.addEventListener('keydown', this.koListen, true);
    window.addEventListener('pointerdown', this.koListen, true);
  }

  private koStopListen() {
    window.removeEventListener('keydown', this.koListen, true);
    window.removeEventListener('pointerdown', this.koListen, true);
  }

  private padButtons(): boolean[] {
    const out: boolean[] = [];
    try { for (const p of navigator.getGamepads?.() ?? []) if (p) for (const b of p.buttons) out.push(b.pressed); } catch { /* no gamepad API */ }
    return out;
  }

  /** A gamepad button went down since the KO (held buttons from the fight don't count). */
  private koPadPressed() {
    if (this.net || this.cfg.online || this.players) return false;
    const now = this.padButtons();
    const hit = now.some((v, i) => v && !this.koPads[i]);
    this.koPads = now;
    return hit;
  }

  /** Shared side-on camera that frames both robots (local versus). */
  private versusCamera(a: THREE.Vector3, b: THREE.Vector3) {
    const mid = a.clone().lerp(b, 0.5);
    const sep = Math.hypot(a.x - b.x, a.z - b.z);
    const axis = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
    const side = new THREE.Vector3(-axis.z, 0, axis.x);
    if (side.dot(new THREE.Vector3(0, 0, 1)) < 0) side.negate();
    const dist = 9 + sep * 0.7;
    this.cam.cine = { pos: mid.clone().addScaledVector(side, dist).add(new THREE.Vector3(0, 5 + sep * 0.25, 0)), look: mid.clone().add(new THREE.Vector3(0, 1, 0)), k: 4 };
    // both players move relative to this camera
    const cp = this.host.gr.camera.position;
    this.cam.yaw = Math.atan2(mid.x - cp.x, mid.z - cp.z);
  }

  /** Chromatic punch, only when screen effects are enabled. */
  private punch(v: number) {
    if (this.host.settings.cameraShake) this.host.gr.punchChroma(v);
  }

  /** Curved hex-energy guard shield shown during the charge attack. */
  static makeShield(color: number) {
    const half = Math.acos(GUARD_DOT);
    const geo = new THREE.SphereGeometry(1.15, 32, 16, 0, Math.PI * 2, 0, half);
    // A circular polar cap exactly matches the shared 3D forward guard cone.
    geo.rotateX(Math.PI / 2);
    geo.translate(0, 0, -0.65);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(color) }, uAlpha: { value: 0 }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vP = position; vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){
          float f = pow(1.0 - abs(dot(vN, vV)), 1.6);
          vec2 g = vP.xy * 7.0; g.x += mod(floor(g.y), 2.0) * 0.5;
          vec2 c = abs(fract(g) - 0.5);
          float hex = smoothstep(0.42, 0.5, max(c.x, c.y));
          float scan = 0.5 + 0.5 * sin(vP.y * 18.0 - uTime * 9.0);
          float a = (0.12 + f * 0.9 + hex * 0.35 + scan * 0.08) * uAlpha;
          gl_FragColor = vec4(uColor * (1.4 + f * 2.5 + hex), a);
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.visible = false;
    m.renderOrder = 7;
    return m;
  }

  /** Find a camera yaw around `c` whose view line is not blocked by cover. */
  private shotDist = 0;
  private shotH = 0;

  private clearShot(c: THREE.Vector3, prefer: number, dist: number, h: number) {
    const look = c.clone().add(new THREE.Vector3(0, 1, 0));
    // try progressively closer / higher framings until one has a clear line of sight
    for (const [dk, hk] of [[1, 0], [0.75, 0.8], [0.55, 1.8], [0.45, 3]] as [number, number][]) {
      for (let k = 0; k < 12; k++) {
        const y = prefer + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.5;
        const d = dist * dk;
        const p = c.clone().add(new THREE.Vector3(Math.sin(y) * d, h + hk, Math.cos(y) * d));
        if (Math.abs(p.x) > this.arena.halfX + 2 || Math.abs(p.z) > this.arena.halfZ + 2) continue;
        if (!segmentHit(look, p, this.arena.colliders)) {
          this.shotDist = d;
          this.shotH = h + hk;
          return y;
        }
      }
    }
    this.shotDist = dist * 0.5;
    this.shotH = h + 3;
    return prefer;
  }

  private telFrame(dt: number, pf: Fighter, rf: Fighter) {
    const T = this.tel;
    T.fightT += dt;
    if (!pf.grounded) T.airT += dt;
    if (pf.hovering) T.hoverT += dt;
    if (!this.freeCam) T.lockT += dt;
    const d = Math.hypot(pf.pos.x - rf.pos.x, pf.pos.z - rf.pos.z);
    T.distSum += d;
    T.distN++;
    T.dist[d < 5 ? 0 : d < 10 ? 1 : d < 16 ? 2 : 3] += dt;
    T.fpsAcc += dt;
    T.fpsFrames++;
    if (T.fpsAcc >= 1) {
      const fps = T.fpsFrames / T.fpsAcc;
      T.fpsMin = Math.min(T.fpsMin, fps);
      T.fpsSum += fps;
      T.fpsN++;
      T.fpsAcc = 0;
      T.fpsFrames = 0;
    }
    if (this.fightTime >= T.nextSample) {
      T.timeline.push([+this.fightTime.toFixed(1), Math.round(pf.hp), Math.round(rf.hp), +d.toFixed(1)]);
      T.nextSample += 5;
    }
    T.device = this.host.input.lastDevice;
  }

  private setPhase(p: Phase) {
    this.shotYaw = null;
    this.phase = p;
    this.host.hud.el.classList.toggle('calm', p !== 'fight' && p !== 'ready');
    this.phaseT = 0;
    if (p === 'ready') {
      this.host.hud.announce('READY', { color: '#37e8ff' });
      audio.play('announce_ready');
      if (!this.guide) this.host.hud.showHint(this.watching ? 'Spectating live · 1/2 player views · 3 broadcast · 4 free camera · Drag to look · Esc menu' : this.players ? 'Replay · 1/2 player views · 3 broadcast · 4 free camera · Drag to look · Esc pause' : this.controlsHint(), 5);
      this.host.input.enabled = !this.watching;
      if (!this.players && !this.watching) this.host.input.requestLock();
    }
    if (p === 'fight') this.host.input.enabled = !this.watching;
  }

  /* ------------------------------------------------------------------ online (rollback) */

  /**
   * One online frame for a player. Confirmed remote inputs that differ from the prediction rewind
   * the world to that tick and re-simulate to the present; then the frontier advances in real time,
   * predicting the opponent, at most ROLLBACK_WINDOW ticks past their last confirmed input.
   */
  private netFrame(dt: number) {
    const net = this.net!;
    if (this.netFrozen) {
      this.netFreeRun(dt);
      // the final state hash is still being compared; the ranked report waits for it (briefly)
      this.netCheckSums();
      this.netTryReport();
      this.netWatch(dt);
      return;
    }
    let rollTo = -1;
    const before = this.netConfirmed;
    while (net.remote.has(this.netConfirmed)) {
      const t = this.netConfirmed;
      const ri = net.remote.get(t)!;
      const used = this.netUsed.get(t);
      if (rollTo < 0 && used && !sameInput(used, ri)) rollTo = t;
      this.netLastRemote = ri;
      this.netConfirmed++;
    }
    if (this.netConfirmed > before) this.netStall = 0;
    if (rollTo >= 0) this.netRollback(rollTo);
    this.netCheckSums();
    if (this.netEndTick >= 0 && this.netConfirmed > this.netEndTick && this.netTick > this.netEndTick) {
      this.netFinish();
      this.netPrune();
      return;
    }
    // time sync (GGPO-style frame advantage): running ahead of the opponent slows our sim clock a
    // little until both sides are even, so neither machine keeps predicting further than it must
    const adv = net.remoteFrontier >= 0 ? this.netTick - net.remoteFrontier : 0;
    if (net.remoteFrontier >= 0 && adv - net.remoteAdv >= 2) {
      this.acc -= dt * 0.1;
      this.netStats.slowFrames++;
    }
    this.acc += dt;
    let steps = 0;
    let blocked = false;
    while (this.acc >= SIM_DT && steps < 5) {
      if (this.netTick - this.netConfirmed >= ROLLBACK_WINDOW) { blocked = true; break; }
      this.netAdvance(adv);
      this.acc -= SIM_DT;
      steps++;
    }
    // never bank more than a couple of ticks while waiting on the opponent
    this.acc = Math.max(0, Math.min(this.acc, SIM_DT * 2));
    if (blocked) {
      this.netStall += dt;
      this.netStats.stallFrames++;
    }
    this.netPrune();
    this.netWatch(dt);
  }

  /** Simulate the frontier tick: send our input for tick + delay, snapshot, step with a prediction. */
  private netAdvance(adv: number) {
    const net = this.net!;
    const t = this.netTick;
    while (this.netSent <= t + this.netDelay) {
      // the first `delay` ticks are empty on both machines
      let li = this.netSent < this.netDelay ? emptyInput() : this.host.input.sample(this.cam.moveYaw, false, emptyInput());
      if (this.autoPilot && this.netSent >= this.netDelay && !this.player.fighter.locked) li = { ...li, ...this.autoPilot.think(this.world, this.player.fighter, this.sides[1].fighter) };
      li = quantizeInput(li);
      this.netLocal.set(this.netSent, li);
      net.sendInput(this.netSent, li, t, adv);
      this.netSent++;
    }
    const ri = net.remote.get(t) ?? predictInput(this.netLastRemote);
    if (t >= this.netConfirmed) {
      this.netSnaps.set(t, this.world.snapshot());
      this.netUsed.set(t, ri);
    }
    for (const s of this.sides) s.prevPos.copy(s.fighter.pos);
    if (t === NET_GO_TICK && this.phase === 'ready') {
      this.host.hud.announce('GO!', { color: '#ff6a1f' });
      audio.play('announce_go');
      this.setPhase('fight');
    }
    this.netSimTick(t, this.netLocal.get(t)!, ri);
    this.netTick = t + 1;
    this.handleEvents(this.netLedger.fresh(t, this.world.events));
    this.netClock();
  }

  /** A late input proved a prediction wrong: rewind to that tick and re-simulate to the frontier. */
  private netRollback(from: number) {
    const net = this.net!;
    const snap = this.netSnaps.get(from);
    if (!snap) return;
    const depth = this.netTick - from;
    this.netStats.rollbacks++;
    this.netStats.maxDepth = Math.max(this.netStats.maxDepth, depth);
    this.netStats.resimTicks += depth;
    this.world.restore(snap);
    if (this.netEndTick >= from) this.netEndTick = -1;
    // hashes of the abandoned timeline (e.g. a predicted end tick) must never be compared
    for (const k of this.netPendingSums.keys()) if (k >= from) this.netPendingSums.delete(k);
    for (let t = from; t < this.netTick; t++) {
      const ri = net.remote.get(t) ?? predictInput(this.netLastRemote);
      if (t < this.netConfirmed) this.netUsed.delete(t);
      else {
        if (t > from) this.netSnaps.set(t, this.world.snapshot());
        this.netUsed.set(t, ri);
      }
      this.netSimTick(t, this.netLocal.get(t)!, ri);
      // only events the prediction missed reach presentation (hits, KOs and HP always come from the sim)
      this.handleEvents(this.netLedger.fresh(t, this.world.events));
    }
  }

  /** The deterministic part of an online tick: the GO unlock, the step, and the end-of-fight lock. */
  private netSimTick(t: number, li: FighterInput, ri: FighterInput) {
    const w = this.world;
    if (t === NET_GO_TICK) {
      for (const f of w.fighters) f.locked = false;
      w.combatEnabled = true;
    }
    w.step(this.me === 0 ? [li, ri] : [ri, li]);
    if (w.combatEnabled && (w.koLoser >= 0 || t + 1 - NET_GO_TICK >= this.netFightTicks)) {
      w.combatEnabled = false;
      for (const f of w.fighters) f.locked = true;
      this.netEndTick = t;
      // the end state itself is hash-checked too: a desync in the last two seconds would otherwise
      // only show up as two different results
      this.netPendingSums.set(t, w.digest());
    }
    if (t % 120 === 0 && !(this.netEndTick >= 0 && t > this.netEndTick)) this.netPendingSums.set(t, w.digest());
  }

  /** Fight clock from the frontier tick (online). */
  private netClock() {
    if (this.phase !== 'fight') return;
    this.fightTime = Math.max(0, this.netTick - NET_GO_TICK) / 60;
    this.timeLeft = Math.max(0, this.netFightTicks / 60 - this.fightTime);
  }

  /** The KO / time-up tick is confirmed on this machine: show the result and stop rolling back. */
  private netFinish() {
    this.netFrozen = true;
    this.fightTime = Math.max(0, this.netEndTick + 1 - NET_GO_TICK) / 60;
    this.timeLeft = Math.max(0, this.netFightTicks / 60 - this.fightTime);
    if (this.phase !== 'fight') return;
    if (this.world.koLoser >= 0) this.onKO(this.world.koLoser);
    else this.onTimeUp();
    // ranked: report the confirmed result now (once the end-state hash is compared), not after the
    // outro. A winner who closes the tab during the victory pose must not be scored as a forfeit
    // (the server counts leaving an unreported ranked match as a loss).
    this.netReportBy = this.renderTime + 2.5;
    this.netTryReport();
  }

  /** Ranked report deadline (render time): sent when the end hash matched, or at the deadline. */
  private netReportBy = -1;
  private netTryReport() {
    const net = this.net;
    if (this.netReportBy < 0 || !net) return;
    const end = this.netEndTick;
    const pending = end >= 0 && (this.netSums.has(end) || this.netPendingSums.has(end));
    if (pending && !this.netDesync && this.renderTime < this.netReportBy) return;
    this.netReportBy = -1;
    if (this.cfg.online?.ranked && !this.watching && !net.reported) net.report(this.netDesync ? -2 : this.winner);
  }

  /** After the confirmed end both robots are locked: the world just runs on locally for the outro. */
  private netFreeRun(dt: number) {
    this.acc += dt;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 5) {
      for (const s of this.sides) s.prevPos.copy(s.fighter.pos);
      this.world.step([emptyInput(), emptyInput()]);
      this.handleEvents(this.world.events);
      this.acc -= SIM_DT;
      steps++;
    }
    if (steps === 5) this.acc = 0;
  }

  /** Exchange state hashes for confirmed ticks only (predicted ticks may legitimately differ). */
  private netCheckSums() {
    const net = this.net!;
    if (this.netDesync) return;
    const final = Math.min(this.netConfirmed, this.netTick);
    for (const [k, h] of this.netPendingSums) {
      if (k >= final) continue;
      this.netPendingSums.delete(k);
      this.netSums.set(k, h);
      net.sendSum(k, h);
    }
    for (const [k, v] of this.netSums) {
      const r = net.remoteSums.get(k);
      if (r === undefined) continue;
      this.netSums.delete(k);
      net.remoteSums.delete(k);
      this.netChecks++;
      if (r !== v) {
        this.netDesync = true;
        track('net_desync', { tick: k, arena: this.cfg.arenaId });
        this.host.hud.showHint('Connection desync detected. This match will not count.', 4);
      }
    }
  }

  /** Drop inputs, snapshots and event records that can no longer be rolled back to. */
  private netPrune() {
    const keep = Math.min(this.netConfirmed, this.netTick);
    for (const m of [this.netLocal, this.netUsed, this.netSnaps, this.net!.remote] as Map<number, unknown>[]) {
      for (const k of m.keys()) if (k < keep) m.delete(k);
    }
    this.netLedger.prune(keep);
  }

  /** Waiting on the opponent: a long stall or a closed socket ends the match as a forfeit. */
  private netWatch(dt: number) {
    const net = this.net!;
    // a confirmed result is final: the opponent closing the results screen is not a disconnect
    if (this.netFrozen || this.phase === 'done' || this.phase === 'outro') return;
    if (this.netStall > 1 && this.netStall - dt <= 1) this.host.hud.showHint('Waiting for opponent…', 2);
    if (!this.netLeft && (net.closed || this.netStall > 10)) {
      this.netLeft = true;
      this.host.hud.showHint('Opponent disconnected', 3);
      if (this.phase === 'fight' || this.phase === 'ready') this.onForfeit(1 - this.me);
    }
  }

  /**
   * Spectating: both inputs are confirmed, so there is no rollback. Play ~1 s behind the players
   * (buffered against jitter); a late joiner fast-forwards silently through the match so far.
   */
  private watchFrame(dt: number) {
    const ses = this.net!;
    if (this.netFrozen) {
      this.netFreeRun(dt);
      return;
    }
    const avail = Math.min(this.watchLatest[0], this.watchLatest[1]) + 1;
    if (!this.watchStarted) {
      if (avail - this.netTick < 60 && !ses.closed) return;
      this.watchStarted = true;
    }
    const behind = avail - this.netTick;
    const catchUp = behind > 150;
    // hold ~1 s of buffered input: drift the playback clock ±10% instead of stalling on jitter
    const rate = behind < 40 ? 0.9 : behind > 90 ? 1.1 : 1;
    this.acc += catchUp ? (behind - 60) * SIM_DT : dt * rate;
    let steps = 0;
    let starved = false;
    while (this.acc >= SIM_DT && steps < (catchUp ? 900 : 5)) {
      const t = this.netTick;
      const a = this.watchIn[0].get(t), b = this.watchIn[1].get(t);
      if (!a || !b) { starved = true; break; }
      for (const s of this.sides) s.prevPos.copy(s.fighter.pos);
      if (t === NET_GO_TICK && this.phase === 'ready') {
        if (!catchUp) {
          this.host.hud.announce('GO!', { color: '#ff6a1f' });
          audio.play('announce_go');
        }
        this.setPhase('fight');
      }
      this.netSimTick(t, a, b);
      this.netTick = t + 1;
      this.watchIn[0].delete(t);
      this.watchIn[1].delete(t);
      // fast-forwarding a late join: no sounds or effects for the part already played
      if (!catchUp) this.handleEvents(this.world.events);
      this.netClock();
      this.acc -= SIM_DT;
      steps++;
      if (this.netEndTick >= 0) {
        this.netFinish();
        break;
      }
    }
    this.acc = Math.max(0, Math.min(this.acc, SIM_DT * 2));
    if (starved) {
      this.netStall += dt;
      this.netStats.stallFrames++;
    } else this.netStall = 0;
    // the players left (or the stream stopped) before the end: stop watching
    if (!this.netFrozen && starved && (ses.closed ? this.netStall > 1.5 : this.netStall > 10) && this.phase !== 'done') {
      this.host.hud.showHint('The match ended early', 3);
      this.end({ quit: true });
    }
  }

  /** Opponent left: the local player wins (the machines stop agreeing here, so the sim stops). */
  private onForfeit(loser: number) {
    this.winner = 1 - loser;
    this.finish = 'ko';
    this.world.combatEnabled = false;
    for (const s of this.sides) s.fighter.locked = true;
    this.host.input.enabled = false;
    this.host.hud.announce('FORFEIT WIN', { color: '#ffd23a', long: true });
    this.net = null;
    this.startOutro();
  }

  /** Online: whether the result can count (no desync, no disconnect). */
  get netClean() { return !this.netDesync && !this.netLeft; }

  private tip(id: string, text: string) {
    if (this.cfg.online || this.players || this.autoPilot || this.cfg.versus || (this.guide && !this.guide.finished)) return;
    if (this.tipQ.some(([k]) => k === id)) return;
    try { if ((JSON.parse(localStorage.getItem('ra-tips') ?? '[]') as string[]).includes(id)) return; } catch { return; }
    this.tipQ.push([id, text]);
  }

  /** Show queued tips one at a time, after the opening controls hint has cleared. */
  private showTips() {
    if (!this.tipQ.length || this.phase !== 'fight' || this.fightTime < 6 || this.renderTime < this.tipAt) return;
    const [id, text] = this.tipQ.shift()!;
    try {
      const seen = JSON.parse(localStorage.getItem('ra-tips') ?? '[]') as string[];
      localStorage.setItem('ra-tips', JSON.stringify([...seen, id]));
    } catch { /* storage blocked: show it anyway */ }
    this.host.hud.showHint(`TIP · ${text}`, 5);
    this.tipAt = this.renderTime + 7;
  }

  private onKO(loser: number) {
    if (this.phase !== 'fight' || this.practiceMode) return;
    this.winner = 1 - loser;
    this.finish = 'ko';
    this.setPhase('ko');
    this.world.combatEnabled = false;
    for (const s of this.sides) s.fighter.locked = true;
    this.host.input.enabled = false;

    this.host.hud.announce(loser === 2 ? 'DOUBLE K.O.' : 'K.O.', { color: '#ff3b3b', long: true });
    audio.play('ko');
    audio.play('announce_ko');
    audio.duck(0.6, 2.5);
    this.koYaw = null;
    if (this.koCamOn()) this.koStartListen();
    this.cam.addTrauma(0.65);
    this.punch(0.006);
  }

  private onTimeUp() {
    if (this.phase !== 'fight') return;
    this.timeLeft = 0;
    const [a, b] = [0, 1].map((i) => this.sideOf(i).fighter.hp / this.sideOf(i).fighter.maxHp);
    this.winner = Math.abs(a - b) < 0.001 ? -1 : a > b ? 0 : 1;
    this.finish = 'time';
    this.setPhase('timeup');
    this.world.combatEnabled = false;
    for (const s of this.sides) s.fighter.locked = true;
    this.host.input.enabled = false;
    this.host.hud.announce('TIME UP', { color: '#ffd23a', long: true });
    audio.play('announce_timeup');
  }

  private startOutro() {
    this.koStopListen();
    this.setPhase('outro');
    audio.setTimeScale(1);
    this.host.input.releaseLock();
    const pw = this.winner === this.me;
    if (this.winner >= 0) {
      const w = this.sideOf(this.winner);
      w.fighter.setMode('victory');
      const l = this.sideOf(1 - this.winner);
      if (l.fighter.mode !== 'down') l.fighter.setMode('defeat');
    }
    this.host.hud.announce(this.winner < 0 ? 'DRAW' : pw ? 'VICTORY' : 'DEFEAT', { color: this.winner < 0 ? '#ffd23a' : pw ? '#37e8ff' : '#ff3b3b', long: true });
    audio.play(this.winner === this.me || this.winner < 0 ? 'victory' : 'defeat');
  }

  private buildReplay(php: number, rhp: number): Replay {
    const { replay: _drop, ...config } = this.cfg;
    void _drop;
    return {
      v: 1,
      rulesVersion: RULESET_VERSION,
      // record the objective explicitly: replays rename the mode, so the default could differ on playback
      config: { ...config, objective: !!this.world.objective },
      worldSeed: this.worldSeed,
      aiSeed: this.aiSeed,
      streams: this.recorders!.map((r) => r.encode()),
      frames: this.recorders![0].frames,
      date: new Date().toISOString(),
      aimAssist: this.aimAssist,
      summary: { outcome: this.winner < 0 ? 'draw' : this.winner === this.me ? 'win' : 'lose', finish: this.finish, time: +this.fightTime.toFixed(1), playerHp: Math.round(php), rivalHp: Math.round(rhp) },
    };
  }

  private end(o: { quit?: boolean; restart?: boolean }) {
    if (this.phase === 'done') return;
    this.setPhase('done');
    const [p, r] = this.sides.map((s) => s.fighter);
    const T = this.tel;
    const r1 = (v: number) => +v.toFixed(1);
    track('match_end', {
      rival: this.cfg.rivalId, arena: this.cfg.arenaId, mode: this.cfg.mode, ladderIndex: this.cfg.ladderIndex,
      outcome: o.quit ? 'quit' : o.restart ? 'restart' : this.winner < 0 ? 'draw' : this.winner === this.me ? 'win' : 'lose',
      finish: this.finish, fightTime: r1(this.fightTime), playerHp: Math.round(p.hp), playerMaxHp: p.maxHp, rivalHp: Math.round(r.hp), rivalMaxHp: r.maxHp,
      used: T.used, dmgDealtBy: T.dmgDealt, dmgTakenBy: T.dmgTaken, hitsDealt: T.hitsDealt, hitsTaken: T.hitsTaken,
      kdDealt: p.stats.knockdowns, kdTaken: p.stats.knockdownsTaken, hazardHits: T.hazardHits, dodges: T.dodges, deflects: T.deflects, parries: p.stats.parries, skills: p.stats.skillCasts, skillHits: p.stats.skillHits, skillDamage: p.stats.skillDamage, feints: p.stats.feints, sweetSpots: p.stats.sweetSpots, pauses: T.pauses,
      airPct: T.fightT ? r1((T.airT / T.fightT) * 100) : 0, hoverS: r1(T.hoverT), hardLockPct: T.fightT ? r1((T.lockT / T.fightT) * 100) : 0,
      avgDist: T.distN ? r1(T.distSum / T.distN) : 0, distSec: { '<5m': r1(T.dist[0]), '5-10m': r1(T.dist[1]), '10-16m': r1(T.dist[2]), '>16m': r1(T.dist[3]) },
      fpsAvg: T.fpsN ? r1(T.fpsSum / T.fpsN) : null, fpsMin: T.fpsN ? r1(T.fpsMin) : null, device: T.device,
      rivalStats: r.stats, playerStats: p.stats, timeline: T.timeline,
    });
    this.resolve({
      config: this.cfg,
      outcome: this.winner < 0 ? 'draw' : this.winner === this.me ? 'win' : 'lose',
      finish: this.finish,
      time: this.fightTime,
      playerHp: p.hp,
      playerMaxHp: p.maxHp,
      rivalHp: r.hp,
      rivalMaxHp: r.maxHp,
      player: { ...p.stats, deflects: T.deflects, parries: p.stats.parries, perfectDodges: T.perfect, podsUsed: T.used.pod, bombsUsed: T.used.bomb, chargesUsed: T.used.charge, damageBy: { ...T.dmgDealt } },
      rival: { ...r.stats, damageBy: { ...T.dmgTaken } },
      quit: o.quit,
      restart: o.restart,
      netClean: this.cfg.online ? this.netClean : undefined,
      replay: this.recorders && !o.quit && !o.restart ? this.buildReplay(p.hp, r.hp) : undefined,
    });
  }

  /**
   * Skill aim: while the skill button is held, the mouse / right stick moves a screen cursor;
   * the lane points from the robot toward the ground under it. Release fires toward that point.
   */
  private updateSkillAim(look: { dx: number; dy: number }) {
    const input = this.host.input;
    const aiming = input.skillAiming && this.phase === 'fight' && !this.autoPilot && !this.players;
    if (!aiming) {
      this.skillAimActive = false;
      this.skillGoal = null;
      return;
    }
    const camera = this.host.gr.camera;
    if (!this.skillAimActive) {
      const start = this.sides[1].fighter.pos.clone().project(camera);
      this.skillCursor.set(THREE.MathUtils.clamp(start.x, -.9, .9), THREE.MathUtils.clamp(start.y, -.85, .65));
      this.skillAimActive = true;
    }
    const width = Math.max(1, this.host.hud.el.clientWidth);
    const height = Math.max(1, this.host.hud.el.clientHeight);
    this.skillCursor.x = THREE.MathUtils.clamp(this.skillCursor.x + look.dx / .0022 * 2 / width, -.95, .95);
    this.skillCursor.y = THREE.MathUtils.clamp(this.skillCursor.y - look.dy / .0022 * 2 / height, -.9, .75);
    // mouse motion belongs to the aim cursor while aiming
    look.dx = look.dy = 0;
    this.bombRay.setFromCamera(this.skillCursor, camera);
    const ray = this.bombRay.ray;
    const hit = segmentHit(ray.origin, ray.at(160, new THREE.Vector3()), this.world.colliders);
    const f = this.player.fighter;
    let goal = hit?.point.clone() ?? ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -f.pos.y), new THREE.Vector3());
    if (!goal) goal = f.pos.clone().addScaledVector(ray.direction.clone().setY(0).normalize(), f.lo.skill.range);
    input.skillAimTarget = quantizeBombTarget([goal.x, goal.y, goal.z]);
    this.skillGoal = goal.fromArray(input.skillAimTarget!);
    const sk = f.lo.skill;
    this.host.hud.bombAimStatus(f.skillCd > 0 ? `${sk.name.toUpperCase()} · RELOADING ${f.skillCd.toFixed(1)}s` : `${sk.name.toUpperCase()} · RELEASE TO FIRE`);
  }

  private updateBombAim(look: { dx: number; dy: number }) {
    const input = this.host.input;
    const aiming = input.bombAiming && this.phase === 'fight' && !this.autoPilot && !this.players;
    if (!aiming) {
      this.bombAimActive = false;
      for (const view of this.bombAimViews) view.hide();
      if (!this.skillGoal) this.host.hud.bombAimStatus('');
      return;
    }
    const camera = this.host.gr.camera;
    if (!this.bombAimActive) {
      const start = this.sides[1].fighter.pos.clone().project(camera);
      this.bombCursor.set(THREE.MathUtils.clamp(start.x, -.9, .9), THREE.MathUtils.clamp(start.y, -.85, .65));
      this.bombAimActive = true;
    }
    const width = Math.max(1, this.host.hud.el.clientWidth);
    const height = Math.max(1, this.host.hud.el.clientHeight);
    this.bombCursor.x = THREE.MathUtils.clamp(this.bombCursor.x + look.dx / .0022 * 2 / width, -.95, .95);
    this.bombCursor.y = THREE.MathUtils.clamp(this.bombCursor.y - look.dy / .0022 * 2 / height, -.9, .75);
    // Mouse motion belongs to the landing cursor while aiming, including in free-camera mode.
    look.dx = look.dy = 0;
    this.bombRay.setFromCamera(this.bombCursor, camera);
    const ray = this.bombRay.ray;
    const end = ray.at(160, new THREE.Vector3());
    const hit = segmentHit(ray.origin, end, this.world.colliders);
    let goal = hit?.point.clone() ?? ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
    if (!goal) goal = this.player.fighter.pos.clone().addScaledVector(ray.direction.clone().setY(0).normalize(), this.player.fighter.lo.bomb.range);
    goal.x = THREE.MathUtils.clamp(goal.x, -this.arena.halfX + .5, this.arena.halfX - .5);
    goal.z = THREE.MathUtils.clamp(goal.z, -this.arena.halfZ + .5, this.arena.halfZ - .5);
    if (hit && hit.normal.y < .5) goal.y = groundHeightBelow(goal.x, goal.z, goal.y - .05, this.world.colliders);
    input.bombAimTarget = quantizeBombTarget([goal.x, goal.y, goal.z]);
    goal.fromArray(input.bombAimTarget!);
    const f = this.player.fighter;
    let blocked = false;
    for (let i = 0; i < this.bombAimViews.length; i++) {
      const view = this.bombAimViews[i];
      if (i >= f.lo.bomb.count) { view.hide(); continue; }
      const plan = plannedBomb(f, goal, this.world.colliders, i);
      blocked ||= plan.obstructed;
      view.show(plan.points, plan.firstImpact ?? plan.target, f.lo.bomb.model === 'bouncer' ? .5 : f.lo.bomb.blastRadius, plan.obstructed);
    }
    const action = f.bombCd > 0 ? `HOLD · RELOADING ${f.bombCd.toFixed(1)}s` : !f.canAct || f.landT > 0 ? 'HOLD · RECOVERING' : 'RELEASE TO THROW';
    this.host.hud.bombAimStatus(`${blocked ? 'COVER BLOCKS ARC · ' : ''}${action}${f.lo.bomb.model === 'bouncer' ? ' · FIRST BOUNCE' : f.lo.bomb.count > 1 ? ` · ${f.lo.bomb.count} LANDINGS` : ''}`);
  }

  /* ------------------------------------------------------------------ events */

  private worldToScreen(p: THREE.Vector3) {
    const v = p.clone().project(this.host.gr.camera);
    return { x: (v.x * 0.5 + 0.5) * this.host.hud.el.clientWidth, y: (-v.y * 0.5 + 0.5) * this.host.hud.el.clientHeight };
  }

  private handleEvents(events: GameEvent[]) {
    const fx = this.fx;
    const comboVictims = new Set(events.filter(e => e.type === 'combo').map(e => e.victim));
    for (const e of events) {
      switch (e.type) {
        case 'fighter': {
          const s = this.sideOf(e.who);
          const f = s.fighter;
          const isP = e.who === this.me;
          const ev = e.ev;
          if (isP && this.phase === 'fight') {
            this.guide?.onEvent(ev.type);
            const k = ev.type === 'dash' ? (ev.air ? 'airdash' : 'dash') : ev.type === 'chargeStart' ? 'charge' : ev.type;
            if (k in this.tel.used) this.tel.used[k]++;
            if (ev.type === 'knockdown') this.tel.kdTaken++;
          } else if (!isP && ev.type === 'knockdown') this.tel.kdDealt++;
          switch (ev.type) {
            case 'jump':
              audio.play('jump', { pos: f.pos });
              fx.dustRing(f.pos, 0.7, 8);
              s.anim.event({ type: 'jump' });
              break;
            case 'airjump':
              audio.play('double_jump', { pos: f.pos });
              fx.ring(f.pos.clone(), new THREE.Vector3(0, 1, 0), s.paint.glow, 0.3, 1.4, 0.25, 1);
              s.anim.event({ type: 'airjump' });
              break;
            case 'dash':
              audio.play('dash', { pos: f.pos });
              // speed read: a brief FOV push on your own dash (no time change)
              if (isP) this.cam.kickFov(0.3);
              fx.dashBurst(f.chestPoint(), f.dashDir, s.paint.glow, !ev.air);
              s.anim.event({ type: 'dash' });
              break;
            case 'skid':
              // planted reversal: a small kick of dust at the feet
              fx.dustRing(f.pos, 0.35 + Math.min(0.35, ev.speed / 30), 5);
              fx.footDust(f.pos, 1);
              break;
            case 'land': {
              const strength = Math.min(1, ev.speed / 22);
              if (ev.speed > 2) {
                audio.play(ev.speed > 16 ? 'land_heavy' : 'land', { pos: f.pos, volume: 0.5 + strength * 0.5 });
                fx.dustRing(f.pos, 0.8 + strength, Math.round(6 + strength * 12));
              }
              s.anim.event({ type: 'land', strength });
              break;
            }
            case 'fire': {
              const gun = f.lo.gun;
              audio.play(gun.sfx, { pos: f.pos, volume: isP ? 0.9 : 0.75 });
              s.anim.event({ type: 'fire' });
              s.model.root.updateMatrixWorld(true);
              const mp = s.model.rig.muzzle.getWorldPosition(new THREE.Vector3());
              const dir = f.chestPoint().sub(this.sideOf(1 - e.who).fighter.chestPoint()).negate().normalize();
              fx.weapons.muzzle(gun.model, mp, dir, gun.color);
              if (gun.model === 'rail') {
              }
              break;
            }
            case 'railCharge':
              // enemy tells cut through the mix (they are distance-attenuated from the camera)
              audio.play('gun_rail_charge', { pos: f.pos, volume: isP ? 0.85 : 1.25 });
              if (!isP) {
                // telegraph: bright glint at the enemy muzzle
                s.model.root.updateMatrixWorld(true);
                const gp = s.model.rig.muzzle.getWorldPosition(new THREE.Vector3());
                fx.chargeGlint(gp, f.lo.gun.color);
              }
              break;
            case 'bomb': {
              audio.play('bomb_throw', { pos: f.pos });
              s.anim.event({ type: 'bomb' });
              s.model.root.updateMatrixWorld(true);
              const bp = s.model.rig.bombMuzzle.getWorldPosition(new THREE.Vector3());
              fx.muzzle(bp, new THREE.Vector3(0, 1, 0), f.lo.bomb.color, true);
              fx.smoke.emit({ pos: bp, count: 6, speed: [0.5, 2], size: [0.3, 0.45], grow: 2.5, life: [0.6, 1], color: 0x8a8580, alpha: 0.5, drag: 2, gravity: -1 });
              break;
            }
            case 'pod':
              audio.play('pod_launch', { pos: f.pos });
              s.anim.event({ type: 'pod' });
              break;
            case 'feint':
              fx.dodgeFlash(f.chestPoint(), f.lo.skill.color);
              this.host.hud.popup(this.worldToScreen(f.chestPoint().add(new THREE.Vector3(0, 1.2, 0))), 'FEINT', 'tag', '#' + new THREE.Color(f.lo.skill.color).getHexString());
              break;
            case 'skillCast': {
              if (!isP) this.tip('tell', 'Red lane on the ground = the enemy is winding up a skill shot. Dash sideways to dodge it.');
              else if (f.stats.skillCasts >= 2 && !f.lo.skill.blink) this.tip('feint', 'Feint: press dash during your skill wind-up to cancel it. Half the cooldown comes back. Bait their dodge.');
              // telegraph: charge sound + glint (the enemy's lane shows on the ground during the cast)
              audio.play('gun_rail_charge', { pos: f.pos, volume: isP ? 0.8 : 1.2, pitch: 1.3 });
              s.model.root.updateMatrixWorld(true);
              fx.skillCharge(s.model.rig.skillMuzzle.getWorldPosition(_v2), f.lo.skill.color, !isP);
              break;
            }
            case 'skill': {
              const sk = f.lo.skill;
              if (sk.blink) { s.anim.event({ type: 'skill' }); break; }
              audio.play(sk.model === 'wave' ? 'gun_scatter' : 'gun_rail', { pos: f.pos, volume: 1, pitch: sk.model === 'hook' ? 0.7 : sk.model === 'frost' ? 1.3 : 1 });
              s.anim.event({ type: 'skill' });
              s.model.root.updateMatrixWorld(true);
              const mp = s.model.rig.skillMuzzle.getWorldPosition(_v2);
              fx.skillRelease(mp, new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), sk.color);
              break;
            }
            case 'chargeStart':
              audio.play('charge_windup', { pos: f.pos, volume: isP ? 0.9 : 1.3 });
              if (!isP) fx.chargeWarning(f.chestPoint(), new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)));
              if (ev.wakeup) this.host.hud.popup(this.worldToScreen(f.chestPoint().add(new THREE.Vector3(0, 1, 0))), 'WAKE-UP!', 'tag');
              fx.sparks.emit({ pos: f.chestPoint(), count: 16, speed: [1, 3], size: [0.1, 0.16], life: [0.2, 0.35], color: s.paint.glow, intensity: 2.6, drag: 2 });
              break;
            case 'chargeLunge':
              audio.play('charge_swing', { pos: f.pos });
              fx.dashBurst(f.chestPoint(), new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), s.paint.glow, f.grounded);
              fx.weapons.chargeStart(f.lo.body.frame, f.chestPoint(), new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), s.paint.glow);
              break;
            case 'parry':
              audio.play('shield_block', { pos: f.pos, pitch: 1.5 });
              audio.play('hit_heavy', { pos: f.pos, volume: 0.6 });
              fx.parry(f.chestPoint(), new THREE.Vector3(Math.sin(f.yaw), 0, Math.cos(f.yaw)), s.paint.glow);

              if (isP) this.tel.parries++;
              this.host.hud.popup(this.worldToScreen(f.chestPoint().add(new THREE.Vector3(0, 1.2, 0))), 'PARRY!', 'tag');
              this.sideOf(e.who).shieldPulse = 1.5;
              break;
            case 'guardBreak':
              audio.play('knockdown', { pos: f.pos, volume: 0.7, pitch: 1.3 });
              fx.guardBreak(f.chestPoint());
              this.host.hud.popup(this.worldToScreen(f.chestPoint().add(new THREE.Vector3(0, 1.2, 0))), 'GUARD BREAK', 'tag');
              break;
            case 'knockdown': {
              audio.play('knockdown', { pos: f.pos });
              fx.knockdownBurst(f.chestPoint(), s.paint.glow);
              this.cam.addTrauma(0.45);
              this.punch(0.004);
              if (f.alive && !comboVictims.has(f.id)) {

                this.host.hud.popup(this.worldToScreen(f.chestPoint().add(new THREE.Vector3(0, 1.2, 0))), 'DOWN!', 'big', '#ffd23a');
              }
              break;
            }
            case 'getup':
              audio.play('getup', { pos: f.pos });
              fx.ring(f.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), s.paint.glow, 0.4, 2.2, 0.4, 0.8);
              break;
            default:
              break;
          }
          break;
        }
        case 'prime':
          fx.comboPrime(e.pos, 0x5adfff);
          this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 1, 0))), 'PRIMED', 'tag', '#5adfff');
          audio.play('pod_seeker_ping', { pos: e.pos, volume: .45, pitch: 1.4 });
          break;
        case 'blink': {
          // snap (no interpolated slide), implode at the start, streak, burst at the arrival
          const bs = this.sideOf(e.who);
          bs.prevPos.copy(e.to);
          const col = bs.fighter.lo.skill.color;
          const up = new THREE.Vector3(0, 1, 0);
          const c0 = e.from.clone().add(new THREE.Vector3(0, 1.1, 0)), c1 = e.to.clone().add(new THREE.Vector3(0, 1.1, 0));
          fx.ring(c0, up, col, 1.4, 0.2, 0.22, 0.9);
          fx.burst(c1, col, 0.8);
          fx.ring(e.to.clone().add(new THREE.Vector3(0, 0.08, 0)), up, col, 0.3, 2.2, 0.3, 0.8);
          const n = Math.max(3, Math.round(e.from.distanceTo(e.to) * 2));
          for (let i = 0; i <= n; i++) fx.sparks.emit({ pos: c0.clone().lerp(c1, i / n), count: 2, spread: 0.25, size: [0.5, 0.8], life: [0.12, 0.25], color: col, intensity: 2 });
          audio.play('dash', { pos: e.to, volume: 0.9, pitch: 1.4 });
          if (e.who === this.me) this.cam.addTrauma(0.1);
          break;
        }
        case 'sweetSpot': {
          if (e.attacker === this.me) {
            const m = this.sideOf(this.me).fighter.lo.skill.model;
            this.tip('sweet', m === 'wave' ? 'Ion Wave hits 30% harder at point blank.' : 'Breaker Lance hits 30% harder at long range: the far third of its reach.');
          }
          fx.burst(e.pos, 0xffe27a, 0.5);
          this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 1.4, 0))), 'SWEET SPOT!', 'big', '#ffe27a');
          audio.play('hit_heavy', { pos: e.pos, volume: 0.7, pitch: 1.5 });
          break;
        }
        case 'combo': {
          fx.comboBurst(e.pos, 0xffd36a);
          this.sideOf(e.attacker).anim.event({ type: 'combo', role: 'trigger' });
          this.sideOf(e.victim).anim.event({ type: 'combo', role: 'target' });
          const at = this.worldToScreen(e.pos);
          at.y -= 82;
          this.host.hud.popup(at, `DETONATE +${Math.round(e.bonus)}`, 'big', '#ffd36a');
          audio.play('hit_heavy', { pos: e.pos, volume: .8, pitch: .85 });
          if (!this.players) track('combat_combo', { attacker: e.attacker, victim: e.victim, bonus: e.bonus, time: this.world.time, mode: this.cfg.mode, autoplay: !!this.autoPilot });
          break;
        }
        case 'primerClear':
          if (e.reason !== 'consumed' && ['dodge', 'parry', 'guard'].includes(e.reason)) {
            this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 1, 0))), 'PRIMER CLEARED', 'tag', '#8adfff');
          }
          break;
        case 'fireStart':
          audio.play('explosion_small', { pos: e.zone.pos, volume: 0.6, pitch: 0.8 });
          break;
        case 'intercept': {
          // point-defense laser: streak of particles from drone to target
          const n = 10;
          for (let i = 0; i <= n; i++) {
            const p = e.from.clone().lerp(e.to, i / n);
            fx.sparks.emit({ pos: p, count: 1, size: [0.12, 0.16], life: [0.08, 0.12], color: 0x9cc8ff, intensity: 3 });
          }
          fx.impact(e.to, new THREE.Vector3(0, 1, 0), 0x7aa8ff, 0.5);
          audio.play('gun_blaster', { pos: e.from, volume: 0.4, pitch: 1.8 });
          break;
        }
        case 'turretShot':
          fx.muzzle(e.pod.pos.clone().add(new THREE.Vector3(0, 0.35, 0)), e.proj.vel.clone().normalize(), e.pod.def.color, false);
          audio.play('gun_blaster', { pos: e.pod.pos, volume: 0.5, pitch: 1.3 });
          break;
        case 'crateHit':
          this.tactics.crateHit(e.crate);
          break;
        case 'crateBreak':
          this.tactics.crateBreak(e.crate);
          audio.play('explosion_small', { pos: e.crate.pos });
          break;
        case 'trapArm':
          audio.play('hazard_warn', { pos: e.trap.pos });
          if (e.by === this.me) this.host.hud.popup(this.worldToScreen(e.trap.sw.clone()), 'TRAP ARMED', 'tag');
          break;
        case 'trapFire':
          audio.play('hazard_zap', { pos: e.trap.pos });
          fx.weapons.explosion('trap', e.trap.pos.clone().add(new THREE.Vector3(0, 0.2, 0)), 2, 0xffd23a, false, true);
          break;
        case 'pickupSpawn':
          audio.play('ui_unlock', { pos: e.pickup.pos, volume: 0.6 });
          this.host.hud.popup(this.worldToScreen(e.pickup.pos.clone().add(new THREE.Vector3(0, 1.5, 0))), e.pickup.kind.toUpperCase(), 'tag');
          break;
        case 'objective': {
          const at = this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 2.4, 0)));
          if (e.phase === 'warn') {
            audio.play('countdown_tick', { volume: 0.9 });
            this.tip('objective', `Overcharge Core: stand on the glowing centre pad ALONE for ${OBJECTIVE.capture.toFixed(0)}s. Reward: skill instantly ready + ${OBJECTIVE.overdrive}s Overdrive. Both on it = frozen.`);
          } else if (e.phase === 'online') {
            audio.play('ui_unlock', { volume: 0.9 });
            this.host.hud.popup(at, 'CORE ONLINE', 'tag', '#ffd36a');
          } else if (e.phase === 'capture') {
            const mine = e.who === this.me;
            this.objectiveView?.captured(e.who);
            audio.play('announce_go', { volume: 0.8 });
            audio.play('getup', { pos: e.pos });
            this.host.hud.announce(mine ? 'OVERCHARGED' : 'RIVAL OVERCHARGED', { sub: `SKILL READY · OVERDRIVE ${OBJECTIVE.overdrive}s`, color: mine ? Match.OBJ_COLORS[0] : Match.OBJ_COLORS[1], small: true });
            this.replayBar?.mark({ t: this.fightTime, side: mine ? 0 : 1, big: true, text: `${mine ? 'P1' : 'P2'} core capture` });
          } else {
            this.host.hud.popup(at, 'CORE OFFLINE', 'tag', '#8a8f99');
          }
          break;
        }
        case 'pickupTake':
          this.tactics.pickupTaken(e.pickup);
          audio.play('getup', { pos: e.pickup.pos });
          this.host.hud.popup(this.worldToScreen(e.pickup.pos.clone().add(new THREE.Vector3(0, 1.2, 0))), `${e.who === this.me ? '' : 'RIVAL '}${e.pickup.kind.toUpperCase()}!`, 'tag');
          break;
        case 'impact':
          fx.weapons.impact(e.proj.spec.look, e.pos, e.normal, e.color);
          audio.play('hit_light', { pos: e.pos, volume: 0.35, pitch: 1.3 });
          break;
        case 'explosion': {
          fx.weapons.explosion(e.look, e.pos, e.radius, e.color, e.big, e.onGround);
          audio.play(e.big ? 'explosion_big' : 'explosion_small', { pos: e.pos });
          // blasts you can feel: shake falls off over ~3 blast radii from your robot
          const near = 1 - e.pos.distanceTo(this.player.fighter.pos) / Math.max(4, e.radius * 3);
          if (near > 0) this.cam.addTrauma(near * (e.big ? 0.32 : 0.18));
          break;
        }
        case 'hit': {
          const v = this.sideOf(e.victim);
          if (this.replayBar && e.damage > 0) {
            const src = e.source === 'skill' ? 'skill' : e.source;
            this.replayBar.mark({ t: this.fightTime, side: e.attacker === this.me ? 0 : 1, big: e.knockdown || e.ko,
              text: `${e.attacker === this.me ? 'P1' : 'P2'} ${src} ${Math.round(e.damage)}${e.ko ? ' K.O.' : e.knockdown ? ' DOWN' : e.blocked ? ' (blocked)' : ''}` });
          }
          if (e.source === 'skill' && e.damage > 0 && !e.blocked && !e.parried && this.sideOf(e.attacker)) {
            fx.skillImpact(e.skillLook ?? '', e.attacker, e.victim, e.pos, !!e.skillReflected || e.ko || e.knockdown);
          }
          if (e.victim === this.me) {
            this.tel.dmgTaken[e.source] = (this.tel.dmgTaken[e.source] ?? 0) + e.damage;
            this.tel.hitsTaken++;
            if (e.source === 'hazard') this.tel.hazardHits++;
          } else if (e.attacker === this.me) {
            this.tel.dmgDealt[e.source] = (this.tel.dmgDealt[e.source] ?? 0) + e.damage;
            this.tel.hitsDealt++;
          }
          const isPV = e.victim === this.me;
          fx.hitSpark(e.pos, e.dir, e.color, e.heavy);
          if (e.source !== 'skill' && !e.blocked && !e.parried) fx.weapons.hit(e.look, e.source, e.pos, e.dir, e.color, e.heavy);
          if (e.source === 'skill' && !e.blocked && !e.parried) fx.skillHit(e.pos, e.dir, e.color);
          audio.play(e.heavy ? 'hit_heavy' : 'hit_light', { pos: e.pos });
          v.anim.event({ type: 'hit', dir: e.dir, heavy: e.heavy });
          v.model.flash(e.heavy ? 1 : 0.7);
          this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 0.6, 0))), String(e.damage), e.damage >= 100 ? 'big' : '', isPV ? '#ff6a5a' : '#ffffff');
          if (e.blocked) {
            audio.play('shield_block', { pos: e.pos });
            this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 1.1, 0))), 'BLOCK', 'tag');
          }
          if (e.attacker === this.me && this.practiceMode) this.practiceLog.push({ t: this.world.time, dmg: e.damage });
          if (e.attacker === this.me && !e.parried) {
            this.host.hud.confirm(e.heavy);
            audio.play('ui_move', { volume: e.heavy ? 0.9 : 0.6, pitch: e.heavy ? 1.6 : 2.2 });
          }
          if (isPV) this.host.hud.hurtFlash(e.heavy ? 0.4 : e.blocked ? 0.08 : 0.18);
          // Hits used to move the camera only on knockdown/KO: taking a heavy shot or landing one had
          // no physical feedback. Burn ticks stay still (they would buzz the screen).
          if (e.source !== 'fire' && !e.parried && !e.knockdown && !e.ko) {
            if (isPV) this.cam.addTrauma(e.blocked ? 0.08 : e.heavy ? 0.38 : 0.12);
            else if (e.attacker === this.me && e.heavy) this.cam.addTrauma(0.16);
          }
          break;
        }
        case 'dodge':
          if (e.who === this.me) {
            this.tel.dodges++;
            if (e.perfect) this.tel.perfect++;
            this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 1, 0))), e.perfect ? 'PERFECT DODGE' : 'DODGE!', 'tag');
            fx.dodgeFlash(e.pos, 0x37e8ff);
            if (e.perfect) fx.ring(this.sides[0].fighter.pos.clone().add(new THREE.Vector3(0, 0.1, 0)), new THREE.Vector3(0, 1, 0), 0x37e8ff, 0.4, 2.6, 0.35, 1);

            audio.play('pod_seeker_ping', { volume: 0.6, pitch: e.perfect ? 2 : 1.6 });
          }
          break;
        case 'deflect': {
          fx.hitSpark(e.pos, new THREE.Vector3(0, 1, 0), e.color, false);
          fx.ring(e.pos, this.sideOf(e.who).model.root.getWorldDirection(new THREE.Vector3()), 0xffffff, 0.3, 1.8, 0.25, 1);
          audio.play('shield_block', { pos: e.pos });
          if (e.who === this.me) {
            this.tel.deflects++;
            if (e.parry) this.tel.parries++;
            this.host.hud.popup(this.worldToScreen(e.pos.clone().add(new THREE.Vector3(0, 0.8, 0))), e.parry ? 'PARRY!' : 'DEFLECT!', 'tag');

          }
          this.sideOf(e.who).shieldPulse = 1;
          break;
        }
        case 'clash':
          fx.knockdownBurst(e.pos, 0xffffff);
          audio.play('hit_heavy', { pos: e.pos });
          audio.play('shield_block', { pos: e.pos });

          break;
        case 'bombBounce':
          audio.play('bomb_bounce', { pos: e.bomb.pos });
          fx.dustRing(e.bomb.pos, 0.4, 5);
          break;
        case 'podTrigger':
          audio.play('pod_seeker_ping', { pos: e.pod.pos });
          break;
        case 'hazard':
          audio.play('hazard_zap', { pos: e.pos });
          break;
        case 'ko':
          // online: shown once the KO tick is confirmed (netFinish), never from a prediction
          if (!this.net) this.onKO(e.loser);
          break;
        default:
          break;
      }
    }
  }

  /** Match-start controls line, built from the player's own bindings. */
  private controlsHint(): string {
    const b = this.host.input.bindings ?? DEFAULT_BINDINGS;
    if (this.host.input.lastDevice === 'pad') {
      const p = (a: keyof typeof b.pad) => padName(b.pad[a]?.[0]);
      return `${p('gun')} fire · Hold ${p('skill')} + R-stick: aim skill · ${p('bomb')} bomb · ${p('pod')} pod · ${p('dash')} dash · ${p('charge')} charge`;
    }
    const k = (a: keyof typeof b.keys) => keyName(b.keys[a].find(Boolean) ?? '');
    return `Click to capture mouse · ${k('gun')} fire · Hold ${k('skill')}: aim skill · Hold ${k('bomb')}: aim bomb · ${k('pod')} pod · ${k('dash')} dash · ${k('charge')} charge`;
  }

  dispose() {
    this.disposed = true;
    this.replayCamera?.dispose();
    this.replayBar?.dispose();
    if (this.seekMuted) audio.setVolumes(this.host.settings.master, this.host.settings.sfx, this.host.settings.music);
    for (const s of this.sides) {
      s.thruster.stop();
      s.model.dispose();
      // the drop capsule and guard shield are built per match (they leaked ~30 GPU geometries a match)
      s.capsule.dispose();
      disposeTree(s.shield);
    }
    this.ambience?.stop();
    audio.setTimeScale(1);
    this.tactics.dispose();
    this.objectiveView?.dispose();
    this.fx.dispose();
    for (const view of this.bombAimViews) view.dispose();
    this.aimView.dispose();
    this.guideView?.dispose();
    this.koStopListen();
    this.arena.dispose();
    this.host.input.enabled = false;
    this.host.input.onPause = null;
    this.host.input.ignorePad = -1;
    this.host.input.onLockToggle = null;
    this.host.input.releaseLock();
    this.host.hud.show(false);
  }
}

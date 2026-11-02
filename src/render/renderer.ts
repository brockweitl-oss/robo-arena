import { DepthNormalsPass } from './depthNormals';
import * as THREE from 'three';
import {
  EffectComposer,
  SSAOEffect,
  RenderPass,
  EffectPass,
  BloomEffect,
  ToneMappingEffect,
  ToneMappingMode,
  SMAAEffect,
  SMAAPreset,
  VignetteEffect,
  ChromaticAberrationEffect,
  BlendFunction,
  NoiseEffect,
} from 'postprocessing';
import { GradeEffect } from './grade';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityProfile {
  pixelRatio: number;
  shadowMapSize: number;
  shadows: boolean;
  bloom: boolean;
  smaa: boolean;
  particleScale: number;
}

export const QUALITY: Record<Quality, QualityProfile> = {
  low: { pixelRatio: 0.75, shadowMapSize: 1024, shadows: false, bloom: true, smaa: false, particleScale: 0.5 },
  medium: { pixelRatio: 1, shadowMapSize: 2048, shadows: true, bloom: true, smaa: true, particleScale: 0.8 },
  high: { pixelRatio: 1.5, shadowMapSize: 2048, shadows: true, bloom: true, smaa: true, particleScale: 1 },
};

/**
 * Owns the WebGL renderer, the post-processing chain and the shared scene/camera.
 * The game swaps `scene` contents (arena, garage) but keeps one renderer alive.
 */
export class GameRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly composer: EffectComposer;
  readonly camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  quality: Quality = 'medium';
  profile: QualityProfile = QUALITY.medium;

  private renderPass: RenderPass;
  private normals: DepthNormalsPass;
  private aoPass: EffectPass;
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private vignette: VignetteEffect;
  // Post passes are allocated once and retained for the renderer's lifetime.
  // Quality changes only toggle blend functions / pass membership; they never
  // create new EffectPasses (which would leak fullscreen materials and leave
  // stale "change" listeners on the shared effects).
  private effectPass: EffectPass;
  private chromaPass: EffectPass;
  private gradePass: EffectPass;
  private smaaPass: EffectPass;
  private readonly bloomBlend: BlendFunction;
  private readonly grainBlend: BlendFunction;
  private smaa: SMAAEffect;
  private tone: ToneMappingEffect;
  private chromaAmount = 0;
  /** Cinematic grade after tone mapping (AgX alone reads flat). */
  private grade = new GradeEffect();
  private grain = new NoiseEffect({ premultiply: true });

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      stencil: false,
      depth: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping; // tone mapping happens in the composer
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 400);

    this.composer = new EffectComposer(this.renderer, { frameBufferType: THREE.HalfFloatType, multisampling: 0 });
    this.renderPass = new RenderPass(this.scene, this.camera);
    this.composer.addPass(this.renderPass);
    this.normals = new DepthNormalsPass(this.camera);
    this.composer.addPass(this.normals);
    const ao = new SSAOEffect(this.camera, this.normals.texture, {
      samples: 8, rings: 3, resolutionScale: 0.5, radius: 0.075, intensity: 1.15,
      luminanceInfluence: 0.65, worldDistanceThreshold: 60, worldDistanceFalloff: 20,
      worldProximityThreshold: 0.6, worldProximityFalloff: 0.4,
    });
    this.aoPass = new EffectPass(this.camera, ao);
    this.composer.addPass(this.aoPass);

    this.bloom = new BloomEffect({
      intensity: 1.15,
      luminanceThreshold: 0.82,
      luminanceSmoothing: 0.18,
      mipmapBlur: true,
      radius: 0.72,
    });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.52 });
    this.smaa = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
    this.chroma = new ChromaticAberrationEffect({
      offset: new THREE.Vector2(0, 0),
      radialModulation: true,
      modulationOffset: 0.25,
    });
    this.chroma.blendMode.blendFunction = BlendFunction.NORMAL;
    this.grain.blendMode.opacity.value = 0.35;
    this.bloomBlend = this.bloom.blendMode.blendFunction;
    this.grainBlend = this.grain.blendMode.blendFunction;
    this.effectPass = new EffectPass(this.camera, this.bloom, this.tone, this.vignette);
    // Grade on tone-mapped (display-range) colour, in its own pass.
    this.gradePass = new EffectPass(this.camera, this.grade, this.grain);
    // Chromatic aberration (convolution-free) + SMAA run after tone mapping.
    this.chromaPass = new EffectPass(this.camera, this.chroma);
    this.smaaPass = new EffectPass(this.camera, this.smaa);
    this.composer.addPass(this.effectPass);
    this.composer.addPass(this.gradePass);
    this.composer.addPass(this.chromaPass);
    this.applyPostProfile();

    window.addEventListener('resize', () => this.resize());
  }

  /**
   * Applies the current quality profile to the retained post passes.
   * Disabled effects use BlendFunction.DST, which EffectPass omits from the
   * compiled shader. SMAA is the only optional *pass*; it is always the last
   * pass, so removing / re-appending it lets the composer keep renderToScreen
   * on whichever pass is final (chromaPass or smaaPass).
   */
  private applyPostProfile() {
    const bloomFn = this.profile.bloom ? this.bloomBlend : BlendFunction.DST;
    if (this.bloom.blendMode.blendFunction !== bloomFn) this.bloom.blendMode.blendFunction = bloomFn;
    const grainFn = this.quality === 'low' ? BlendFunction.DST : this.grainBlend;
    if (this.grain.blendMode.blendFunction !== grainFn) this.grain.blendMode.blendFunction = grainFn;
    const passes = this.composer.passes;
    const hasSmaa = passes.includes(this.smaaPass);
    if (this.profile.smaa && !hasSmaa) this.composer.addPass(this.smaaPass);
    else if (!this.profile.smaa && hasSmaa) this.composer.removePass(this.smaaPass);
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.profile = QUALITY[q];
    this.normals.enabled = this.aoPass.enabled = q !== 'low';
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.profile.pixelRatio);
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.shadowMap.needsUpdate = true;
    this.scene.traverse((o) => {
      const l = o as THREE.DirectionalLight;
      if (l.isDirectionalLight && l.castShadow) {
        l.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
        l.shadow.map?.dispose();
        (l.shadow as any).map = null;
      }
      const m = (o as THREE.Mesh).material as THREE.Material | undefined;
      if (m) m.needsUpdate = true;
    });
    this.applyPostProfile();
    this.resize();
  }

  setScene(scene: THREE.Scene) {
    this.scene = scene;
    this.renderPass.mainScene = scene;
    (this.renderPass as any).scene = scene;
  }

  /** Kick chromatic aberration (decays automatically). */
  punchChroma(amount: number) {
    this.chromaAmount = Math.max(this.chromaAmount, amount);
  }

  setBloomStrength(v: number) {
    this.bloom.intensity = v;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2) * this.profile.pixelRatio);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  render(dt: number) {
    this.chromaAmount = Math.max(0, this.chromaAmount - dt * 0.02);
    const a = this.chromaAmount;
    this.chroma.offset.set(a, a * 0.6);
    this.composer.render(dt);
  }
}


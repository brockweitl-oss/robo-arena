import * as THREE from 'three';
import {
  EffectComposer,
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
} from 'postprocessing';

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
  private bloom: BloomEffect;
  private chroma: ChromaticAberrationEffect;
  private vignette: VignetteEffect;
  private effectPass!: EffectPass;
  private chromaPass!: EffectPass;
  private smaaPass: EffectPass | null = null;
  private smaa: SMAAEffect;
  private tone: ToneMappingEffect;
  private chromaAmount = 0;

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
    this.rebuildPasses();

    window.addEventListener('resize', () => this.resize());
  }

  private rebuildPasses() {
    if (this.effectPass) this.composer.removePass(this.effectPass);
    if (this.chromaPass) this.composer.removePass(this.chromaPass);
    if (this.smaaPass) this.composer.removePass(this.smaaPass);
    this.smaaPass = null;
    const effects: any[] = [];
    if (this.profile.bloom) effects.push(this.bloom);
    effects.push(this.tone, this.vignette);
    this.effectPass = new EffectPass(this.camera, ...effects);
    this.composer.addPass(this.effectPass);
    // Chromatic aberration (convolution-free) + SMAA run after tone mapping.
    this.chromaPass = new EffectPass(this.camera, this.chroma);
    this.composer.addPass(this.chromaPass);
    if (this.profile.smaa) {
      this.smaaPass = new EffectPass(this.camera, this.smaa);
      this.composer.addPass(this.smaaPass);
    }
  }

  setQuality(q: Quality) {
    this.quality = q;
    this.profile = QUALITY[q];
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
    this.rebuildPasses();
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

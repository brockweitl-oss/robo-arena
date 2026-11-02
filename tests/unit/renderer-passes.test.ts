import { beforeAll, describe, expect, it, vi } from 'vitest';
import { BlendFunction, EffectPass } from 'postprocessing';

// GameRenderer needs a WebGL context; swap in a minimal fake so the real
// postprocessing composer/pass lifecycle can be exercised under Node.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    domElement = { id: '' };
    shadowMap = { enabled: false, type: 0, needsUpdate: false };
    outputColorSpace = three.SRGBColorSpace;
    toneMapping = three.NoToneMapping;
    autoClear = true;
    capabilities = { maxSamples: 4, isWebGL2: true };
    private w = 800; private h = 600; private pr = 1;
    setSize(w: number, h: number) { this.w = w; this.h = h; }
    setPixelRatio(pr: number) { this.pr = pr; }
    getSize(v: InstanceType<typeof three.Vector2>) { return v.set(this.w, this.h); }
    getDrawingBufferSize(v: InstanceType<typeof three.Vector2>) { return v.set(this.w * this.pr, this.h * this.pr); }
    getContext() { return { getContextAttributes: () => ({ alpha: false }) }; }
  }
  return { ...three, WebGLRenderer: FakeWebGLRenderer };
});

beforeAll(() => {
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600, devicePixelRatio: 1, addEventListener() {} });
  vi.stubGlobal('Image', class { src = ''; complete = false; addEventListener() {} removeEventListener() {} });
});

type Listeners = { _listeners?: Record<string, unknown[]> };
const changeListeners = (o: unknown) => (o as Listeners)._listeners?.change?.length ?? 0;

async function makeRenderer() {
  const { GameRenderer } = await import('../../src/render/renderer');
  const r = new GameRenderer({ appendChild() {} } as unknown as HTMLElement);
  const priv = r as unknown as Record<string, any>;
  return { r, priv };
}

describe('GameRenderer post-processing lifecycle', () => {
  it('retains pass/material identities and listener counts across quality changes', async () => {
    const { r, priv } = await makeRenderer();
    const passes = ['effectPass', 'gradePass', 'chromaPass', 'smaaPass'].map((k) => priv[k] as EffectPass);
    const materials = passes.map((p) => p.fullscreenMaterial);
    const effects = ['bloom', 'tone', 'vignette', 'grade', 'grain', 'chroma', 'smaa'].map((k) => priv[k]);
    const baseline = effects.map(changeListeners);
    expect(baseline.every((n) => n === 1)).toBe(true);
    const passCount = r.composer.passes.length;

    for (let i = 0; i < 5; i++) {
      for (const q of ['low', 'medium', 'high', 'low', 'high'] as const) r.setQuality(q);
    }
    r.setQuality('medium');

    expect(['effectPass', 'gradePass', 'chromaPass', 'smaaPass'].map((k) => priv[k])).toEqual(passes);
    passes.forEach((p, i) => expect(p.fullscreenMaterial).toBe(materials[i]));
    expect(effects.map(changeListeners)).toEqual(baseline);
    expect(r.composer.passes.length).toBe(passCount);
    expect(r.composer.passes.filter((p) => p instanceof EffectPass).length).toBe(passCount - 2);
  });

  it('keeps pass ordering and renderToScreen on the final pass for each quality', async () => {
    const { r, priv } = await makeRenderer();
    const order = (smaa: boolean) => [
      priv.renderPass, priv.normals, priv.aoPass, priv.effectPass, priv.gradePass, priv.chromaPass,
      ...(smaa ? [priv.smaaPass] : []),
    ];
    for (const q of ['medium', 'low', 'high', 'low', 'low', 'medium', 'high', 'high'] as const) {
      r.setQuality(q);
      const smaa = q !== 'low';
      expect(r.composer.passes).toEqual(order(smaa));
      const toScreen = r.composer.passes.filter((p) => p.renderToScreen);
      expect(toScreen).toEqual([r.composer.passes[r.composer.passes.length - 1]]);
      expect(priv.smaaPass.renderToScreen).toBe(smaa);
      expect(priv.smaaPass.enabled).toBe(true);
    }
  });

  it('omits grain from the shader at low and restores it (and stays usable) otherwise', async () => {
    const { r, priv } = await makeRenderer();
    const grain = priv.grain;
    const original = grain.blendMode.blendFunction;
    expect(original).not.toBe(BlendFunction.DST);
    const shader = () => ((priv.gradePass as EffectPass).fullscreenMaterial as import('three').ShaderMaterial).fragmentShader;
    const withGrain = shader();

    r.setQuality('low');
    expect(grain.blendMode.blendFunction).toBe(BlendFunction.DST);
    const lowShader = shader();
    expect(lowShader).not.toBe(withGrain);
    expect(lowShader.length).toBeLessThan(withGrain.length);

    r.setQuality('high');
    expect(grain.blendMode.blendFunction).toBe(original);
    expect(shader()).toBe(withGrain);

    // Bloom profiles are all on: bloom must never be stripped.
    for (const q of ['low', 'medium', 'high'] as const) {
      r.setQuality(q);
      expect(priv.bloom.blendMode.blendFunction).not.toBe(BlendFunction.DST);
    }
    // Retained effects remain usable (not disposed) after churn.
    r.setBloomStrength(0.9);
    expect(priv.bloom.intensity).toBeCloseTo(0.9);
    r.punchChroma(0.01);
    expect(priv.chroma.offset).toBeDefined();
  });
});

import * as THREE from 'three';

/**
 * Procedural texture kit. Everything is canvas-generated at load and cached by key.
 * Height fields are drawn in grayscale and converted to tangent-space normal maps.
 */

const cache = new Map<string, THREE.Texture>();

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

function canvas(size: number) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

/** Convert a grayscale height canvas into a normal map canvas. */
export function heightToNormal(src: HTMLCanvasElement, strength = 2): HTMLCanvasElement {
  const w = src.width;
  const h = src.height;
  const sg = src.getContext('2d', { willReadFrequently: true })!;
  const data = sg.getImageData(0, 0, w, h).data;
  const { c, g } = canvas(w);
  const out = g.createImageData(w, h);
  const H = (x: number, y: number) => data[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (H(x + 1, y) - H(x - 1, y)) * strength;
      const dy = (H(x, y + 1) - H(x, y - 1)) * strength;
      const nx = -dx;
      const ny = dy;
      const nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (y * w + x) * 4;
      out.data[i] = ((nx / l) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  g.putImageData(out, 0, 0);
  return c;
}

function toTexture(c: HTMLCanvasElement, srgb: boolean, repeat = 1): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 8;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

function noiseFill(g: CanvasRenderingContext2D, size: number, r: () => number, amount: number, base: number) {
  const img = g.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * amount;
    const v = Math.max(0, Math.min(255, img.data[i] + n + base));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
}

/**
 * Armor-panel set: seams, rivets, small vents. Returns normal + roughness maps.
 * Use on robot armor and hard-surface props. Tiles seamlessly.
 */
export function panelMaps(seed = 1, size = 512, density = 1): { normal: THREE.Texture; rough: THREE.Texture } {
  const key = `panel:${seed}:${size}:${density}`;
  if (cache.has(key)) return { normal: cache.get(key)!, rough: cache.get(key + ':r')! };
  const r = rng(seed * 7919 + 13);
  const hc = canvas(size);
  const rc = canvas(size);
  const g = hc.g;
  const gr = rc.g;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  gr.fillStyle = '#6a6a6a';
  gr.fillRect(0, 0, size, size);

  // Recursive panel subdivision.
  const panels: [number, number, number, number][] = [];
  const split = (x: number, y: number, w: number, h: number, depth: number) => {
    if (depth > 3 + density || (w < size / 6 && h < size / 6) || (depth > 1 && r() < 0.25)) {
      panels.push([x, y, w, h]);
      return;
    }
    if (w > h) {
      const s = Math.round(w * (0.3 + r() * 0.4));
      split(x, y, s, h, depth + 1);
      split(x + s, y, w - s, h, depth + 1);
    } else {
      const s = Math.round(h * (0.3 + r() * 0.4));
      split(x, y, w, s, depth + 1);
      split(x, y + s, w, h - s, depth + 1);
    }
  };
  split(0, 0, size, size, 0);

  for (const [x, y, w, h] of panels) {
    // Slight per-panel height + roughness variation.
    const lift = 120 + Math.floor(r() * 20);
    g.fillStyle = `rgb(${lift},${lift},${lift})`;
    g.fillRect(x + 2, y + 2, w - 4, h - 4);
    const rv = 90 + Math.floor(r() * 50);
    gr.fillStyle = `rgb(${rv},${rv},${rv})`;
    gr.fillRect(x + 2, y + 2, w - 4, h - 4);
    // Seam (dark groove)
    g.strokeStyle = '#303030';
    g.lineWidth = 2;
    g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    // Rivets in corners of larger panels
    if (w > size / 5 && h > size / 5) {
      g.fillStyle = '#c8c8c8';
      const inset = 7;
      for (const [px, py] of [
        [x + inset, y + inset],
        [x + w - inset, y + inset],
        [x + inset, y + h - inset],
        [x + w - inset, y + h - inset],
      ]) {
        g.beginPath();
        g.arc(px, py, 2.4, 0, Math.PI * 2);
        g.fill();
      }
    }
    // Occasional vent slots
    if (r() < 0.18 && w > size / 6 && h > size / 8) {
      const n = 3 + Math.floor(r() * 4);
      const vw = w * 0.5;
      const vx = x + (w - vw) / 2;
      for (let i = 0; i < n; i++) {
        const vy = y + h * 0.25 + (i * h * 0.5) / n;
        g.fillStyle = '#404040';
        g.fillRect(vx, vy, vw, Math.max(2, h * 0.04));
      }
    }
  }
  // Fine noise for micro-surface
  noiseFill(g, size, r, 6, 0);
  noiseFill(gr, size, r, 28, 0);
  // Edge wear / scratches into roughness
  gr.strokeStyle = 'rgba(40,40,40,0.5)';
  for (let i = 0; i < 60 * density; i++) {
    gr.lineWidth = 0.5 + r();
    gr.beginPath();
    const sx = r() * size;
    const sy = r() * size;
    gr.moveTo(sx, sy);
    gr.lineTo(sx + (r() - 0.5) * 30, sy + (r() - 0.5) * 30);
    gr.stroke();
  }
  const normal = toTexture(heightToNormal(hc.c, 3), false);
  const rough = toTexture(rc.c, false);
  cache.set(key, normal);
  cache.set(key + ':r', rough);
  return { normal, rough };
}

/** Fine knurled / rubber texture for joints and grips. */
export function rubberMaps(size = 256): { normal: THREE.Texture; rough: THREE.Texture } {
  const key = `rubber:${size}`;
  if (cache.has(key)) return { normal: cache.get(key)!, rough: cache.get(key + ':r')! };
  const r = rng(99);
  const hc = canvas(size);
  const g = hc.g;
  g.fillStyle = '#808080';
  g.fillRect(0, 0, size, size);
  const step = size / 32;
  for (let y = 0; y < 32; y++) {
    g.fillStyle = y % 2 ? '#a0a0a0' : '#5a5a5a';
    g.fillRect(0, y * step, size, step * 0.55);
  }
  noiseFill(g, size, r, 24, 0);
  const rc = canvas(size);
  rc.g.fillStyle = '#d8d8d8';
  rc.g.fillRect(0, 0, size, size);
  noiseFill(rc.g, size, r, 30, 0);
  const normal = toTexture(heightToNormal(hc.c, 2), false, 1);
  const rough = toTexture(rc.c, false, 1);
  cache.set(key, normal);
  cache.set(key + ':r', rough);
  return { normal, rough };
}

/** Generic grime/noise roughness map (seamless-ish via wrap noise). */
export function grimeMap(seed = 3, size = 512, contrast = 1): THREE.Texture {
  const key = `grime:${seed}:${size}:${contrast}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = rng(seed);
  const { c, g } = canvas(size);
  g.fillStyle = '#909090';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 400; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 4 + r() * 40;
    const v = Math.floor(80 + r() * 120);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, `rgba(${v},${v},${v},${0.25 * contrast})`);
    grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = grd;
    for (const ox of [-size, 0, size])
      for (const oy of [-size, 0, size]) {
        g.save();
        g.translate(ox, oy);
        g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
        g.restore();
      }
  }
  noiseFill(g, size, r, 20 * contrast, 0);
  const t = toTexture(c, false);
  cache.set(key, t);
  return t;
}

/** Floor tile set: large tiles with grooves; returns albedo-tint, normal, roughness. */
export function tileMaps(opts: {
  seed?: number;
  size?: number;
  tiles?: number;
  base: string;
  alt?: string;
  line?: string;
  stripe?: string | null;
}): { map: THREE.Texture; normal: THREE.Texture; rough: THREE.Texture } {
  const { seed = 5, size = 1024, tiles = 4, base, alt = base, line = '#1a1a1a', stripe = null } = opts;
  const key = `tile:${seed}:${size}:${tiles}:${base}:${alt}:${line}:${stripe}`;
  if (cache.has(key))
    return { map: cache.get(key)!, normal: cache.get(key + ':n')!, rough: cache.get(key + ':r')! };
  const r = rng(seed);
  const ac = canvas(size);
  const hc = canvas(size);
  const rc = canvas(size);
  const s = size / tiles;
  for (let ty = 0; ty < tiles; ty++)
    for (let tx = 0; tx < tiles; tx++) {
      ac.g.fillStyle = (tx + ty) % 2 ? alt : base;
      ac.g.fillRect(tx * s, ty * s, s, s);
      const lv = 130 + Math.floor(r() * 16);
      hc.g.fillStyle = `rgb(${lv},${lv},${lv})`;
      hc.g.fillRect(tx * s, ty * s, s, s);
      const rv = 100 + Math.floor(r() * 60);
      rc.g.fillStyle = `rgb(${rv},${rv},${rv})`;
      rc.g.fillRect(tx * s, ty * s, s, s);
      // inner bevel highlight
      hc.g.strokeStyle = '#9a9a9a';
      hc.g.lineWidth = 6;
      hc.g.strokeRect(tx * s + 6, ty * s + 6, s - 12, s - 12);
    }
  // grooves
  for (let i = 0; i <= tiles; i++) {
    for (const cv of [ac, hc]) {
      cv.g.fillStyle = cv === ac ? line : '#202020';
      cv.g.fillRect(i * s - 3, 0, 6, size);
      cv.g.fillRect(0, i * s - 3, size, 6);
    }
  }
  if (stripe) {
    ac.g.fillStyle = stripe;
    for (let i = -size; i < size * 2; i += 48) {
      ac.g.beginPath();
      ac.g.moveTo(i, size - 30);
      ac.g.lineTo(i + 24, size - 30);
      ac.g.lineTo(i + 54, size);
      ac.g.lineTo(i + 30, size);
      ac.g.fill();
    }
  }
  // dirt overlay on albedo
  for (let i = 0; i < 300; i++) {
    const x = r() * size;
    const y = r() * size;
    const rad = 10 + r() * 80;
    const grd = ac.g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(0,0,0,0.08)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    ac.g.fillStyle = grd;
    ac.g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  noiseFill(hc.g, size, r, 8, 0);
  noiseFill(rc.g, size, r, 30, 0);
  const map = toTexture(ac.c, true);
  const normal = toTexture(heightToNormal(hc.c, 3), false);
  const rough = toTexture(rc.c, false);
  cache.set(key, map);
  cache.set(key + ':n', normal);
  cache.set(key + ':r', rough);
  return { map, normal, rough };
}

/** Soft radial sprite (for particles/glows). */
export function glowSprite(size = 128, hardness = 0.25): THREE.Texture {
  const key = `glow:${size}:${hardness}`;
  if (cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(size);
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(hardness, 'rgba(255,255,255,0.8)');
  grd.addColorStop(0.6, 'rgba(255,255,255,0.18)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Puffy smoke sprite with noisy edge. */
export function smokeSprite(size = 128): THREE.Texture {
  const key = `smoke:${size}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = rng(42);
  const { c, g } = canvas(size);
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * size * 0.22;
    const x = size / 2 + Math.cos(a) * d;
    const y = size / 2 + Math.sin(a) * d;
    const rad = size * (0.12 + r() * 0.2);
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(255,255,255,0.35)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Scorch decal (dark burnt splat with soft edge). */
export function scorchSprite(size = 256): THREE.Texture {
  const key = `scorch:${size}`;
  if (cache.has(key)) return cache.get(key)!;
  const r = rng(77);
  const { c, g } = canvas(size);
  const cx = size / 2;
  for (let i = 0; i < 40; i++) {
    const a = r() * Math.PI * 2;
    const d = r() * size * 0.3;
    const rad = size * (0.05 + r() * 0.18);
    const x = cx + Math.cos(a) * d;
    const y = cx + Math.sin(a) * d;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, 'rgba(10,8,6,0.55)');
    grd.addColorStop(1, 'rgba(10,8,6,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, size, size);
  }
  // radial streaks
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  for (let i = 0; i < 30; i++) {
    const a = r() * Math.PI * 2;
    g.lineWidth = 1 + r() * 3;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * size * 0.1, cx + Math.sin(a) * size * 0.1);
    g.lineTo(cx + Math.cos(a) * size * (0.3 + r() * 0.18), cx + Math.sin(a) * size * (0.3 + r() * 0.18));
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, t);
  return t;
}

/** Studio-style environment map from a procedural "softbox" scene. Good default reflections. */
export function studioEnvironment(
  renderer: THREE.WebGLRenderer,
  opts: { top?: number; bottom?: number; key?: number; rim?: number; fill?: number; intensity?: number } = {},
): THREE.Texture {
  const { top = 0x8899aa, bottom = 0x1a1a22, key = 0xfff2e0, rim = 0x66ccff, fill = 0xff9955, intensity = 1 } = opts;
  const k = `env:${top}:${bottom}:${key}:${rim}:${fill}:${intensity}`;
  if (cache.has(k)) return cache.get(k)!;
  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: { top: { value: new THREE.Color(top) }, bottom: { value: new THREE.Color(bottom) } },
    vertexShader: 'varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader:
      'uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ float h = normalize(vP).y*0.5+0.5; gl_FragColor = vec4(mix(bottom, top, smoothstep(0.2,0.9,h)),1.); }',
  });
  scene.add(new THREE.Mesh(geo, mat));
  const panel = (color: number, power: number, w: number, h: number, pos: THREE.Vector3) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(power * intensity), side: THREE.DoubleSide }),
    );
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  panel(key, 6, 20, 14, new THREE.Vector3(20, 30, 18));
  panel(rim, 4, 8, 30, new THREE.Vector3(-30, 10, -20));
  panel(fill, 2.5, 18, 10, new THREE.Vector3(-25, 5, 25));
  panel(0xffffff, 3, 40, 6, new THREE.Vector3(0, 45, 0));
  const pmrem = new THREE.PMREMGenerator(renderer);
  const rt = pmrem.fromScene(scene, 0.03);
  pmrem.dispose();
  geo.dispose();
  cache.set(k, rt.texture);
  return rt.texture;
}

/** Text/emblem decal canvas, used for numbers/stripes on robots and arena signage. */
export function decalTexture(draw: (g: CanvasRenderingContext2D, size: number) => void, size = 256, key?: string): THREE.Texture {
  if (key && cache.has(key)) return cache.get(key)!;
  const { c, g } = canvas(size);
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (key) cache.set(key, t);
  return t;
}

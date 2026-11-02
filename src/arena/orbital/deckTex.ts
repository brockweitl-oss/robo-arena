import * as THREE from 'three';
import { heightToNormal, rng } from '../../render/textures';
import {
  TEX_EXTENT,
  COILS,
  COIL_R,
  SPAWN_Z,
  ELEV,
  RAIL_SIDE,
  RAIL_CUT,
  DAIS_HALF,
  chamferPoly,
  octPoly,
} from './layout';

type G = CanvasRenderingContext2D;

function cv(size: number, w = size) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  return { c, g };
}

function tex(c: HTMLCanvasElement, srgb: boolean): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  t.needsUpdate = true;
  return t;
}

const polyPath = (g: G, pts: [number, number][]) => {
  g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath();
};

/** Layered painter: same path drawn into albedo / height / emissive / orm canvases. */
interface Style {
  a?: string;
  h?: string;
  e?: string;
  r?: string; // orm: rgb(ao, rough, metal)
}

export interface DeckTextures {
  map: THREE.Texture;
  emissive: THREE.Texture;
  normal: THREE.Texture;
  orm: THREE.Texture;
}

const CERAMIC = '#8e97a3';
const CERAMIC_ORM = 'rgb(255,78,8)';
const METAL_ORM = 'rgb(255,112,190)';
const CYAN = '#36d9ff';
const VIOLET = '#8a4dff';

export function paintDeck(size: number): DeckTextures {
  const A = cv(size);
  const H = cv(size);
  const E = cv(size);
  const R = cv(size);
  const all = [A.g, H.g, E.g, R.g];
  const s = size / (TEX_EXTENT * 2);
  for (const g of all) g.setTransform(s, 0, 0, s, size / 2, size / 2);
  const px = 1 / s; // one pixel in meters
  const r = rng(808);

  const paint = (path: (g: G) => void, st: Style, mode: 'fill' | 'stroke' = 'fill', lw = 0.05, rule: CanvasFillRule = 'nonzero') => {
    const pairs: [G, string | undefined][] = [
      [A.g, st.a],
      [H.g, st.h],
      [E.g, st.e],
      [R.g, st.r],
    ];
    for (const [g, col] of pairs) {
      if (!col) continue;
      g.beginPath();
      path(g);
      if (mode === 'fill') {
        g.fillStyle = col;
        g.fill(rule);
      } else {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.stroke();
      }
    }
  };
  const rect = (x: number, z: number, w: number, h: number) => (g: G) => g.rect(x, z, w, h);
  const circle = (x: number, z: number, rad: number) => (g: G) => g.arc(x, z, rad, 0, Math.PI * 2);
  const ring = (x: number, z: number, r0: number, r1: number) => (g: G) => {
    g.arc(x, z, r1, 0, Math.PI * 2);
    g.moveTo(x + r0, z);
    g.arc(x, z, r0, 0, Math.PI * 2, true);
  };
  const octRing = (a0: number, a1: number) => (g: G) => {
    polyPath(g, octPoly(a1));
    polyPath(g, octPoly(a0).reverse());
  };

  // 1. base
  const E0 = TEX_EXTENT;
  paint(rect(-E0, -E0, E0 * 2, E0 * 2), { a: '#262c34', h: '#808080', e: '#000000', r: METAL_ORM });

  // 2. 2 m tile grid with per-tile variation
  for (let tz = -11; tz < 11; tz++)
    for (let tx = -11; tx < 11; tx++) {
      const x = tx * 2;
      const z = tz * 2;
      const j = Math.floor(r() * 6) - 2;
      const lift = 126 + Math.floor(r() * 10);
      const rough = 100 + Math.floor(r() * 30);
      paint(rect(x, z, 2, 2), {
        a: `rgb(${37 + j},${43 + j},${51 + j})`,
        h: `rgb(${lift},${lift},${lift})`,
        r: `rgb(255,${rough},${180 + Math.floor(r() * 30)})`,
      });
      // inner bevel highlight
      paint(rect(x + 0.08, z + 0.08, 1.84, 1.84), { h: 'rgb(150,150,150)' }, 'stroke', 0.05);
      if (r() < 0.16) {
        // inset hatch with bolts
        paint(rect(x + 0.45, z + 0.45, 1.1, 1.1), { a: `rgb(${30 + j},${35 + j},${42 + j})`, h: 'rgb(110,110,110)' });
        for (const [bx, bz] of [
          [0.3, 0.3],
          [1.7, 0.3],
          [0.3, 1.7],
          [1.7, 1.7],
        ])
          paint(circle(x + bx, z + bz, 0.045), { h: '#d0d0d0', a: '#4a525c' });
      } else if (r() < 0.12) {
        for (let i = 0; i < 5; i++) paint(rect(x + 0.5, z + 0.5 + i * 0.22, 1.0, 0.08), { h: '#404040', a: '#1a1e23' });
      }
    }
  // grid seams
  for (let i = -11; i <= 11; i++) {
    paint(rect(i * 2 - 0.025, -E0, 0.05, E0 * 2), { a: '#13161a', h: '#383838', r: 'rgb(255,170,150)' });
    paint(rect(-E0, i * 2 - 0.025, E0 * 2, 0.05), { a: '#13161a', h: '#383838', r: 'rgb(255,170,150)' });
  }

  // 3. outer zone darker (outside main ring)
  paint(
    (g) => {
      g.rect(-E0, -E0, E0 * 2, E0 * 2);
      polyPath(g, octPoly(16.0));
    },
    { a: 'rgba(5,6,10,0.32)' },
    'fill',
    0,
    'evenodd',
  );

  // 4. dais plaza
  paint((g) => polyPath(g, octPoly(5.4)), { a: '#1c2027', h: '#7a7a7a', r: 'rgb(255,95,200)' });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    paint(
      (g) => {
        g.moveTo(Math.cos(a) * 3.6, Math.sin(a) * 3.6);
        g.lineTo(Math.cos(a) * 5.0, Math.sin(a) * 5.0);
      },
      { h: '#4a4a4a', a: '#121519' },
      'stroke',
      0.04,
    );
  }
  paint(octRing(5.4, 5.85), { a: CERAMIC, h: '#a8a8a8', r: CERAMIC_ORM });
  paint((g) => polyPath(g, octPoly(5.95)), { e: CYAN, a: '#7fe4ff' }, 'stroke', 0.06);
  paint((g) => polyPath(g, octPoly(4.4)), { e: '#4a2a88' }, 'stroke', 0.05);

  // 5. main ceramic ring
  paint(octRing(15.1, 16.0), { a: CERAMIC, h: '#a6a6a6', r: CERAMIC_ORM });
  // ring segment seams
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const k = 1 / Math.cos(((a + Math.PI / 8) % (Math.PI / 4)) - Math.PI / 8);
    paint(
      (g) => {
        g.moveTo(c * 15.1 * k, sn * 15.1 * k);
        g.lineTo(c * 16.0 * k, sn * 16.0 * k);
      },
      { a: '#3b414a', h: '#404040' },
      'stroke',
      0.05,
    );
  }
  paint((g) => polyPath(g, octPoly(14.98)), { e: CYAN, a: '#86e8ff' }, 'stroke', 0.07);
  paint((g) => polyPath(g, octPoly(16.12)), { e: CYAN, a: '#86e8ff' }, 'stroke', 0.07);

  // 6. axis spokes (ceramic strips with cyan dashes)
  const spoke = (dirX: number, dirZ: number, from: number, to: number) => {
    const w = 0.32;
    const x0 = dirX ? Math.min(from * dirX, to * dirX) : -w;
    const z0 = dirZ ? Math.min(from * dirZ, to * dirZ) : -w;
    const ww = dirX ? Math.abs(to - from) : w * 2;
    const hh = dirZ ? Math.abs(to - from) : w * 2;
    paint(rect(x0, z0, ww, hh), { a: '#5f6772', h: '#9c9c9c', r: CERAMIC_ORM });
    for (let d = from + 0.4; d < to - 0.6; d += 1.2) {
      for (const side of [-0.42, 0.42]) {
        const cx = dirX ? d * dirX : side;
        const cz = dirZ ? d * dirZ : side;
        const lx = dirX ? 0.6 : 0.05;
        const lz = dirZ ? 0.6 : 0.05;
        paint(rect(cx - (dirX ? (dirX > 0 ? 0 : lx) : lx / 2), cz - (dirZ ? (dirZ > 0 ? 0 : lz) : lz / 2), lx, lz), { e: '#1f9fd0' });
      }
    }
  };
  spoke(0, 1, 5.85, 15.1);
  spoke(0, -1, 5.85, 15.1);
  spoke(1, 0, 9.5, 15.1);
  spoke(-1, 0, 9.5, 15.1);

  // 7. diagonal conduits toward the coils
  for (const c of COILS) {
    const dx = Math.sign(c.x);
    const dz = Math.sign(c.z);
    const d0 = 5.9 * Math.SQRT2 * 0.72;
    const d1 = Math.hypot(c.x, c.z) - COIL_R - 0.2;
    const a = Math.atan2(dz, dx);
    for (const g of all) {
      g.save();
      g.rotate(a);
    }
    paint(rect(d0, -0.38, d1 - d0, 0.76), { a: '#15181d', h: '#5a5a5a', r: 'rgb(255,140,220)' });
    paint(rect(d0, -0.38, d1 - d0, 0.07), { a: '#6e4a35', h: '#a0a0a0', r: 'rgb(255,70,255)' });
    paint(rect(d0, 0.31, d1 - d0, 0.07), { a: '#6e4a35', h: '#a0a0a0', r: 'rgb(255,70,255)' });
    for (let d = d0 + 0.3; d < d1; d += 0.5) paint(rect(d, -0.3, 0.06, 0.6), { h: '#707070', a: '#1d2026' });
    paint(rect(d0, -0.045, d1 - d0, 0.09), { e: '#5a2fb0', a: '#3a2a60' });
    for (const g of all) g.restore();
  }

  // 8. spawn pads
  for (const sz of [SPAWN_Z, -SPAWN_Z]) {
    const hw = 1.7;
    paint(rect(-hw, sz - hw, hw * 2, hw * 2), { a: '#1b1f25', h: '#787878' });
    paint(rect(-hw, sz - hw, hw * 2, hw * 2), { a: CERAMIC, h: '#a0a0a0' }, 'stroke', 0.1);
    // corner brackets
    for (const [cx, cz] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      paint(
        (g) => {
          const x = cx * (hw + 0.25);
          const z = sz + cz * (hw + 0.25);
          g.moveTo(x - cx * 0.7, z);
          g.lineTo(x, z);
          g.lineTo(x, z - cz * 0.7);
        },
        { e: CYAN, a: '#86e8ff' },
        'stroke',
        0.08,
      );
    }
    // chevrons toward the center
    const dir = -Math.sign(sz);
    for (let i = 0; i < 3; i++) {
      const z = sz + dir * (hw + 0.7 + i * 0.55);
      paint(
        (g) => {
          g.moveTo(-0.55, z - dir * 0.0);
          g.lineTo(0, z + dir * 0.35);
          g.lineTo(0.55, z);
        },
        { e: i === 0 ? '#2ab8e8' : '#167aa0', a: '#6f7884' },
        'stroke',
        0.09,
      );
    }
    // emblem dot
    paint(ring(0, sz, 0.55, 0.7), { a: '#5f6772', h: '#a0a0a0' });
    paint(circle(0, sz, 0.18), { e: '#2ab8e8' });
  }

  // 9. coil zones
  for (const c of COILS) {
    paint(circle(c.x, c.z, COIL_R + 0.3), { a: '#14161b', h: '#5c5c5c', r: 'rgb(255,150,210)' });
    // hex grate
    for (const g of [A.g, H.g]) {
      g.save();
      g.beginPath();
      g.arc(c.x, c.z, COIL_R - 0.05, 0, Math.PI * 2);
      g.clip();
    }
    const hs = 0.34;
    for (let iy = -12; iy <= 12; iy++)
      for (let ix = -12; ix <= 12; ix++) {
        const hx = c.x + ix * hs * 1.5;
        const hz = c.z + iy * hs * Math.sqrt(3) + (ix & 1 ? (hs * Math.sqrt(3)) / 2 : 0);
        if (Math.hypot(hx - c.x, hz - c.z) > COIL_R + 0.4) continue;
        const hex = (g: G) => {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            const x = hx + Math.cos(a) * hs * 0.82;
            const z = hz + Math.sin(a) * hs * 0.82;
            if (k) g.lineTo(x, z);
            else g.moveTo(x, z);
          }
          g.closePath();
        };
        paint(hex, { a: '#0b0c0f', h: '#2c2c2c' });
      }
    for (const g of [A.g, H.g]) g.restore();
    // radial ribs + rings (copper)
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      paint(
        (g) => {
          g.moveTo(c.x + Math.cos(a) * 0.9, c.z + Math.sin(a) * 0.9);
          g.lineTo(c.x + Math.cos(a) * COIL_R, c.z + Math.sin(a) * COIL_R);
        },
        { a: '#5e3f2e', h: '#a8a8a8', r: 'rgb(255,80,255)' },
        'stroke',
        0.1,
      );
    }
    paint(ring(c.x, c.z, 0.75, 0.95), { a: '#7a5038', h: '#b0b0b0', r: 'rgb(255,65,255)' });
    paint(circle(c.x, c.z, 0.75), { a: '#20232a', h: '#909090' });
    paint(ring(c.x, c.z, COIL_R - 0.02, COIL_R + 0.28), { a: '#7a5038', h: '#b4b4b4', r: 'rgb(255,60,255)' });
    paint(ring(c.x, c.z, COIL_R + 0.1, COIL_R + 0.14), { a: '#3a2418', h: '#606060' });
    paint(circle(c.x, c.z, COIL_R + 0.42), { e: '#3c1f78' }, 'stroke', 0.05);
    // hazard ticks
    for (let i = 0; i < 28; i++) {
      const a0 = (i / 28) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / 56;
      paint(
        (g) => {
          g.arc(c.x, c.z, COIL_R + 0.85, a0, a1);
          g.arc(c.x, c.z, COIL_R + 0.55, a1, a0, true);
          g.closePath();
        },
        { a: '#4a3a6a', h: '#8c8c8c' },
      );
    }
    paint(circle(c.x, c.z, 0.3), { e: '#6a3cd0' });
  }

  // 10. elevator pad
  {
    const hw = ELEV.half + 0.45;
    paint(rect(ELEV.cx - hw, ELEV.cz - hw, hw * 2, hw * 2), { a: '#16191e', h: '#606060' });
    for (const g of [A.g, H.g]) {
      g.save();
      g.beginPath();
      g.rect(ELEV.cx - hw, ELEV.cz - hw, hw * 2, hw * 2);
      g.rect(ELEV.cx - ELEV.half - 0.05, ELEV.cz - ELEV.half - 0.05, ELEV.half * 2 + 0.1, ELEV.half * 2 + 0.1);
      g.clip('evenodd');
    }
    for (let d = -8; d < 8; d += 0.5)
      paint(
        (g) => {
          g.moveTo(ELEV.cx + d, ELEV.cz - hw - 0.2);
          g.lineTo(ELEV.cx + d + 0.25, ELEV.cz - hw - 0.2);
          g.lineTo(ELEV.cx + d + 0.25 + hw * 2 + 0.4, ELEV.cz + hw + 0.2);
          g.lineTo(ELEV.cx + d + hw * 2 + 0.4, ELEV.cz + hw + 0.2);
          g.closePath();
        },
        { a: '#7c8591', h: '#9a9a9a' },
      );
    for (const g of [A.g, H.g]) g.restore();
    paint(rect(ELEV.cx - hw - 0.05, ELEV.cz - hw - 0.05, hw * 2 + 0.1, hw * 2 + 0.1), { e: CYAN, a: '#86e8ff' }, 'stroke', 0.06);
  }

  // 11. rail warning band + apron
  const rail = chamferPoly(RAIL_SIDE, RAIL_CUT);
  const railIn = chamferPoly(RAIL_SIDE - 0.75, RAIL_CUT - 0.75 * 1.2);
  paint(
    (g) => {
      g.rect(-E0, -E0, E0 * 2, E0 * 2);
      polyPath(g, rail);
    },
    { a: 'rgba(4,5,8,0.45)', r: 'rgb(255,140,170)' },
    'fill',
    0,
    'evenodd',
  );
  for (const g of [A.g, H.g, R.g]) {
    g.save();
    g.beginPath();
    polyPath(g, rail);
    polyPath(g, railIn);
    g.clip('evenodd');
  }
  for (let d = -60; d < 60; d += 0.7)
    paint(
      (g) => {
        g.moveTo(d, -E0);
        g.lineTo(d + 0.32, -E0);
        g.lineTo(d + 0.32 + E0 * 2, E0);
        g.lineTo(d + E0 * 2, E0);
        g.closePath();
      },
      { a: '#4c535d', h: '#959595', r: CERAMIC_ORM },
    );
  for (const g of [A.g, H.g, R.g]) g.restore();
  paint((g) => polyPath(g, railIn), { e: '#1a8fc0', a: '#5ab8d8' }, 'stroke', 0.05);

  // 12. floor lettering (side lanes, low contrast)
  for (const side of [-1, 1]) {
    for (const g of [A.g, H.g]) {
      g.save();
      g.translate(side * 17.1, 0);
      g.rotate(side * -Math.PI / 2);
      g.font = 'bold 0.9px Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillStyle = g === A.g ? '#4d5560' : '#9a9a9a';
      g.fillText('HALO DECK', 0, 0);
      g.font = 'bold 0.32px Arial, sans-serif';
      g.fillText('GRAND CIRCUIT  ·  STAGE 08', 0, 0.75);
      g.restore();
    }
  }

  // micro noise in height + roughness
  const noise = (g: G, amt: number, chans: 'gray' | 'g') => {
    g.setTransform(1, 0, 0, 1, 0, 0);
    const img = g.getImageData(0, 0, size, size);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const n = (r() - 0.5) * amt;
      if (chans === 'gray') d[i] = d[i + 1] = d[i + 2] = Math.max(0, Math.min(255, d[i] + n));
      else d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    }
    g.putImageData(img, 0, 0);
  };
  noise(H.g, 5, 'gray');
  noise(R.g, 18, 'g');
  void px;

  const normal = tex(heightToNormal(H.c, 2.4), false);
  return { map: tex(A.c, true), emissive: tex(E.c, true), normal, orm: tex(R.c, false) };
}

/** Ramp top: grip ribs + up-chevrons. uv.x across width, uv.y along slope (0 low, 1 high). */
export function paintRamp(): { map: THREE.Texture; emissive: THREE.Texture; normal: THREE.Texture } {
  const W = 256;
  const Hh = 512;
  const A = cv(Hh, W);
  const H = cv(Hh, W);
  const E = cv(Hh, W);
  A.g.fillStyle = '#2b3139';
  A.g.fillRect(0, 0, W, Hh);
  H.g.fillStyle = '#808080';
  H.g.fillRect(0, 0, W, Hh);
  E.g.fillStyle = '#000';
  E.g.fillRect(0, 0, W, Hh);
  // edge ceramic bands
  A.g.fillStyle = '#8e97a3';
  A.g.fillRect(0, 0, 22, Hh);
  A.g.fillRect(W - 22, 0, 22, Hh);
  H.g.fillStyle = '#a0a0a0';
  H.g.fillRect(0, 0, 22, Hh);
  H.g.fillRect(W - 22, 0, 22, Hh);
  E.g.fillStyle = CYAN;
  E.g.fillRect(22, 0, 4, Hh);
  E.g.fillRect(W - 26, 0, 4, Hh);
  // grip ribs
  for (let y = 6; y < Hh; y += 16) {
    A.g.fillStyle = '#1a1e24';
    A.g.fillRect(30, y, W - 60, 5);
    H.g.fillStyle = '#d0d0d0';
    H.g.fillRect(30, y + 5, W - 60, 6);
    H.g.fillStyle = '#404040';
    H.g.fillRect(30, y, W - 60, 5);
  }
  // chevrons (pointing toward the high end = canvas top, since v=1 is top)
  for (let i = 0; i < 4; i++) {
    const y = 90 + i * 100;
    E.g.strokeStyle = i % 2 ? '#1a7fae' : '#2ab8e8';
    E.g.lineWidth = 9;
    E.g.beginPath();
    E.g.moveTo(W / 2 - 50, y + 30);
    E.g.lineTo(W / 2, y);
    E.g.lineTo(W / 2 + 50, y + 30);
    E.g.stroke();
    A.g.strokeStyle = '#7d8a96';
    A.g.lineWidth = 9;
    A.g.beginPath();
    A.g.moveTo(W / 2 - 50, y + 30);
    A.g.lineTo(W / 2, y);
    A.g.lineTo(W / 2 + 50, y + 30);
    A.g.stroke();
  }
  const mk = (c: HTMLCanvasElement, srgb: boolean) => {
    const t = tex(c, srgb);
    return t;
  };
  return { map: mk(A.c, true), emissive: mk(E.c, true), normal: mk(heightToNormal(H.c, 2), false) };
}

/** Championship crest: winged ring around a planet with an octagonal frame. */
export function drawCrest(g: G, cx: number, cy: number, R: number, mono = false) {
  g.save();
  g.translate(cx, cy);
  const cy1 = mono ? '#bfefff' : '#6fe3ff';
  const vi = mono ? '#bfefff' : '#a77bff';
  g.lineJoin = 'round';
  // octagon frame
  g.strokeStyle = cy1;
  g.lineWidth = R * 0.06;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Math.cos(a) * R;
    const y = Math.sin(a) * R;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.stroke();
  g.lineWidth = R * 0.02;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    const x = Math.cos(a) * R * 0.88;
    const y = Math.sin(a) * R * 0.88;
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
  g.stroke();
  // planet
  const pg = g.createRadialGradient(-R * 0.1, -R * 0.12, 0, 0, 0, R * 0.36);
  pg.addColorStop(0, mono ? '#ffffff' : '#c9f4ff');
  pg.addColorStop(1, mono ? '#9fdfff' : '#3a7dff');
  g.fillStyle = pg;
  g.beginPath();
  g.arc(0, 0, R * 0.32, 0, Math.PI * 2);
  g.fill();
  // halo ring (tilted ellipse)
  g.strokeStyle = vi;
  g.lineWidth = R * 0.07;
  g.beginPath();
  g.ellipse(0, 0, R * 0.62, R * 0.17, -0.32, 0, Math.PI * 2);
  g.stroke();
  // wings
  g.fillStyle = cy1;
  for (const s of [-1, 1]) {
    g.beginPath();
    g.moveTo(s * R * 0.38, -R * 0.05);
    g.lineTo(s * R * 0.82, -R * 0.42);
    g.lineTo(s * R * 0.72, -R * 0.12);
    g.lineTo(s * R * 0.86, -R * 0.2);
    g.lineTo(s * R * 0.66, R * 0.1);
    g.lineTo(s * R * 0.42, R * 0.12);
    g.closePath();
    g.fill();
  }
  // three stars
  g.fillStyle = vi;
  for (let i = -1; i <= 1; i++) {
    const x = i * R * 0.22;
    const y = -R * 0.6 + Math.abs(i) * R * 0.06;
    const rr = R * (i === 0 ? 0.09 : 0.065);
    g.beginPath();
    for (let k = 0; k < 8; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 4;
      const rad = k % 2 ? rr * 0.42 : rr;
      g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
    }
    g.closePath();
    g.fill();
  }
  g.restore();
}

/** Dais top: dark panel with ceramic border and glowing crest. */
export function paintDaisTop(): { map: THREE.Texture; emissive: THREE.Texture; normal: THREE.Texture } {
  const S = 1024;
  const A = cv(S);
  const H = cv(S);
  const E = cv(S);
  A.g.fillStyle = '#232930';
  A.g.fillRect(0, 0, S, S);
  H.g.fillStyle = '#808080';
  H.g.fillRect(0, 0, S, S);
  E.g.fillStyle = '#000';
  E.g.fillRect(0, 0, S, S);
  const m = S / 7; // px per meter
  // panel grid 1 m
  for (let i = 1; i < 7; i++) {
    for (const [g, c] of [
      [A.g, '#14171b'],
      [H.g, '#3c3c3c'],
    ] as const) {
      g.fillStyle = c;
      g.fillRect(i * m - 2, 0, 4, S);
      g.fillRect(0, i * m - 2, S, 4);
    }
  }
  // border
  A.g.strokeStyle = '#8e97a3';
  A.g.lineWidth = 0.3 * m;
  A.g.strokeRect(0.15 * m, 0.15 * m, S - 0.3 * m, S - 0.3 * m);
  H.g.strokeStyle = '#a8a8a8';
  H.g.lineWidth = 0.3 * m;
  H.g.strokeRect(0.15 * m, 0.15 * m, S - 0.3 * m, S - 0.3 * m);
  E.g.strokeStyle = CYAN;
  E.g.lineWidth = 0.05 * m;
  E.g.strokeRect(0.36 * m, 0.36 * m, S - 0.72 * m, S - 0.72 * m);
  // central disk
  A.g.fillStyle = '#181b21';
  A.g.beginPath();
  A.g.arc(S / 2, S / 2, 2.3 * m, 0, Math.PI * 2);
  A.g.fill();
  H.g.strokeStyle = '#a0a0a0';
  H.g.lineWidth = 6;
  H.g.beginPath();
  H.g.arc(S / 2, S / 2, 2.3 * m, 0, Math.PI * 2);
  H.g.stroke();
  E.g.globalAlpha = 0.85;
  drawCrest(E.g, S / 2, S / 2, 1.9 * m);
  E.g.globalAlpha = 1;
  A.g.globalAlpha = 0.45;
  drawCrest(A.g, S / 2, S / 2, 1.9 * m, true);
  A.g.globalAlpha = 1;
  // corner triangles
  for (const [x, y] of [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    const cx = x ? S - 0.7 * m : 0.7 * m;
    const cy = y ? S - 0.7 * m : 0.7 * m;
    E.g.fillStyle = VIOLET;
    E.g.beginPath();
    E.g.arc(cx, cy, 0.09 * m, 0, Math.PI * 2);
    E.g.fill();
  }
  return { map: tex(A.c, true), emissive: tex(E.c, true), normal: tex(heightToNormal(H.c, 2), false) };
}

/** Hologram banner textures (RGBA). */
export function paintBanner(kind: 'wide' | 'tall'): THREE.Texture {
  const W = kind === 'wide' ? 1024 : 256;
  const Hh = kind === 'wide' ? 320 : 640;
  const { c, g } = cv(Hh, W);
  g.clearRect(0, 0, W, Hh);
  // soft panel fill
  const bg = g.createLinearGradient(0, 0, 0, Hh);
  bg.addColorStop(0, 'rgba(60,140,255,0.22)');
  bg.addColorStop(0.5, 'rgba(90,60,220,0.12)');
  bg.addColorStop(1, 'rgba(60,140,255,0.22)');
  g.fillStyle = bg;
  g.fillRect(0, 0, W, Hh);
  g.strokeStyle = 'rgba(120,220,255,0.9)';
  g.lineWidth = 4;
  g.strokeRect(6, 6, W - 12, Hh - 12);
  g.lineWidth = 1.5;
  g.strokeRect(16, 16, W - 32, Hh - 32);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (kind === 'wide') {
    drawCrest(g, 160, Hh / 2, 120);
    drawCrest(g, W - 160, Hh / 2, 120);
    g.fillStyle = '#e8fbff';
    g.font = 'bold 104px Arial Black, Arial, sans-serif';
    g.fillText('HALO CUP', W / 2, Hh / 2 - 34);
    g.fillStyle = '#b79aff';
    g.font = 'bold 40px Arial, sans-serif';
    g.fillText('G R A N D   F I N A L', W / 2, Hh / 2 + 50);
    g.fillStyle = 'rgba(120,220,255,0.9)';
    g.fillRect(W / 2 - 230, Hh / 2 + 88, 460, 4);
    g.font = 'bold 22px Arial, sans-serif';
    g.fillText('ORBITAL CIRCUIT  ·  SEASON VII', W / 2, Hh / 2 + 114);
  } else {
    drawCrest(g, W / 2, 130, 92);
    g.save();
    g.translate(W / 2, 410);
    g.rotate(-Math.PI / 2);
    g.fillStyle = '#e8fbff';
    g.font = 'bold 64px Arial Black, Arial, sans-serif';
    g.fillText('CHAMPION', 0, -10);
    g.fillStyle = '#b79aff';
    g.font = 'bold 26px Arial, sans-serif';
    g.fillText('HALO CUP VII', 0, 48);
    g.restore();
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(120,220,255,${0.9 - i * 0.12})`;
      g.fillRect(40, Hh - 40 - i * 14, W - 80, 6);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** Window lights strip for the ring station (tiles around the ring). */
export function paintRingWindows(): { emissive: THREE.Texture; map: THREE.Texture } {
  const W = 1024;
  const Hh = 256;
  const A = cv(Hh, W);
  const E = cv(Hh, W);
  const r = rng(4242);
  A.g.fillStyle = '#6c7380';
  A.g.fillRect(0, 0, W, Hh);
  E.g.fillStyle = '#000';
  E.g.fillRect(0, 0, W, Hh);
  // structural bands
  for (let x = 0; x < W; x += 64) {
    A.g.fillStyle = r() < 0.5 ? '#4b525c' : '#8a919c';
    A.g.fillRect(x, 0, 64, Hh);
    A.g.fillStyle = '#2a2e35';
    A.g.fillRect(x, 0, 3, Hh);
  }
  for (const y of [40, 128, 216]) {
    A.g.fillStyle = '#2c3038';
    A.g.fillRect(0, y - 6, W, 12);
  }
  // window rows
  for (let row = 0; row < 18; row++) {
    const y = 12 + row * 13.5;
    if (Math.abs(y - 40) < 9 || Math.abs(y - 128) < 9 || Math.abs(y - 216) < 9) continue;
    let x = 0;
    while (x < W) {
      const run = 4 + Math.floor(r() * 30);
      const on = r() < 0.55;
      if (on) {
        const warm = r() < 0.7;
        E.g.fillStyle = warm ? `rgba(255,${190 + Math.floor(r() * 40)},${120 + Math.floor(r() * 60)},${0.6 + r() * 0.4})` : `rgba(140,210,255,${0.6 + r() * 0.4})`;
        for (let k = 0; k < run; k++) E.g.fillRect(x + k * 4, y, 2.4, 4);
      }
      x += run * 4 + 4;
    }
  }
  // a few bright beacon strips
  E.g.fillStyle = '#7fdcff';
  E.g.fillRect(0, 126, W, 3);
  const em = tex(E.c, true);
  const map = tex(A.c, true);
  for (const t of [em, map]) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.ClampToEdgeWrapping;
  }
  return { emissive: em, map };
}

/** Decal atlas (4 x 2 cells): sector labels for cover plates. Transparent background. */
export function paintDecals(): THREE.Texture {
  const C = 256;
  const { c, g } = cv(C * 2, C * 4);
  g.clearRect(0, 0, C * 4, C * 2);
  const labels = ['A1', 'A2', 'B1', 'B2', 'C3', 'D3', 'E5', 'F5'];
  labels.forEach((t, i) => {
    const x = (i % 4) * C;
    const y = Math.floor(i / 4) * C;
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(28,32,40,0.92)';
    g.font = 'bold 120px Arial Black, Arial, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillText(t, 18, 150);
    g.fillRect(18, 170, 200, 10);
    for (let k = 0; k < 9; k++) g.fillRect(18 + k * 22, 192, k % 3 === 0 ? 12 : 6, 36);
    g.fillStyle = 'rgba(60,200,255,0.95)';
    g.fillRect(196, 192, 22, 36);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

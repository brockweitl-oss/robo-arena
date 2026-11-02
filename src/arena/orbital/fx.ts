import * as THREE from 'three';

const HEX_GLSL = /* glsl */ `
float hexEdge(vec2 uv){
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r*0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a,a) < dot(b,b) ? a : b;
  vec2 p = abs(gv);
  return max(dot(p, vec2(0.5, 0.8660254)), p.x); // 0 center .. 0.5 edge
}
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
`;

/** Floor overlay for one arc coil zone: telegraph rings + discharge flash. */
export function coilOverlayMaterial(radius: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: {
      uTime: { value: 0 },
      uWarn: { value: 0 }, // 0..1 progress through telegraph
      uAct: { value: 0 }, // 0..1 discharge envelope
      uR: { value: radius },
    },
    vertexShader: /* glsl */ `
      varying vec2 vP;
      void main(){ vP = position.xy; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWarn, uAct, uR;
      varying vec2 vP;
      ${HEX_GLSL}
      void main(){
        float r = length(vP);
        float rn = r/uR;
        if (rn > 1.35) discard;
        vec3 vio = vec3(0.55,0.28,1.0);
        vec3 wht = vec3(0.85,0.8,1.0);
        float rim = exp(-pow((r-uR)*7.0,2.0));
        float idle = rim*0.18;
        // telegraph: pulsing rim + inward-sweeping rings + lit hex cells
        float w = uWarn;
        float pulse = 0.55 + 0.45*sin(uTime*(14.0 + 18.0*w));
        float sweep = 0.0;
        for (int i=0;i<3;i++){
          float ph = fract(uTime*1.6 + float(i)/3.0);
          float rr = uR*(1.0-ph);
          sweep += exp(-pow((r-rr)*9.0,2.0)) * (1.0-ph);
        }
        float hx = hexEdge(vP*2.6);
        float hexl = smoothstep(0.40,0.48,hx);
        float cell = hash12(floor(vP*2.6+0.5) + floor(uTime*10.0));
        float warn = step(0.001,w) * (rim*(1.2+2.2*pulse)*(0.5+w) + sweep*0.9*w + hexl*0.35*w*step(rn,1.0) + step(0.82, cell)*0.25*w*step(rn,1.0));
        // discharge: blinding disc with hex lattice + shock ring
        float a = uAct;
        float disc = step(rn,1.0) * (0.25 + 1.4*hexl + 0.5*step(0.7,cell));
        float shock = exp(-pow((r - uR*(0.2+0.9*fract(uTime*3.0)))*5.0,2.0));
        float act = a*(disc*1.0 + rim*4.0 + shock*1.2) + a*exp(-rn*rn*3.0)*1.4;
        vec3 col = vio*(idle + warn) + mix(vio, wht, 0.35)*act;
        float fade = 1.0 - smoothstep(1.15,1.35,rn);
        gl_FragColor = vec4(col*fade, 1.0);
      }`,
  });
}

/** Animated pulses traveling along a floor conduit (uv.x 0 = dais end, 1 = coil end). */
export function conduitMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
    uniforms: { uTime: { value: 0 }, uWarn: { value: 0 }, uAct: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uWarn, uAct; varying vec2 vUv;
      void main(){
        float core = exp(-pow((vUv.y-0.5)*9.0,2.0));
        float idle = 0.5 + 0.5*sin(vUv.x*18.0 - uTime*3.0);
        float speed = 1.2 + uWarn*4.0;
        float pul = pow(0.5+0.5*sin(vUv.x*26.0 - uTime*speed*6.0), 6.0);
        float i = core*(0.12*idle + uWarn*(0.4+2.2*pul) + uAct*4.0);
        gl_FragColor = vec4(vec3(0.55,0.3,1.0)*i, 1.0);
      }`,
  });
}

/** Additive hologram (banner/crest) with scanlines and flicker. */
export function holoMaterial(map: THREE.Texture, tint = new THREE.Color(1, 1, 1), intensity = 2.2): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { map: { value: map }, uTime: { value: 0 }, uTint: { value: tint }, uI: { value: intensity }, uSeed: { value: Math.random() * 10 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float uTime, uI, uSeed; uniform vec3 uTint;
      varying vec2 vUv; varying vec3 vW;
      void main(){
        float t = uTime + uSeed;
        float glitch = step(0.985, fract(sin(floor(t*9.0))*43758.5));
        vec2 uv = vUv + vec2(glitch*0.01*sin(vUv.y*80.0), 0.0);
        vec4 tx = texture2D(map, uv);
        float scan = 0.72 + 0.28*sin(vW.y*42.0 - t*5.0);
        float band = 0.85 + 0.6*exp(-pow(fract(vUv.y - t*0.18)*8.0-4.0, 2.0));
        float flick = 0.92 + 0.08*sin(t*31.0)*sin(t*7.7);
        float edge = smoothstep(0.0,0.03,vUv.x)*smoothstep(1.0,0.97,vUv.x)*smoothstep(0.0,0.05,vUv.y)*smoothstep(1.0,0.95,vUv.y);
        float a = tx.a*edge;
        vec3 col = tx.rgb*uTint*uI*scan*band*flick;
        gl_FragColor = vec4(col, a);
      }`,
  });
}

/** Additive energy field (barrier walls / lift column). uv.y 0 = bottom. World-space hex pattern. */
export function fieldMaterial(color: THREE.Color, strength = 1): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: color }, uS: { value: strength } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; vN = normalize(mat3(modelMatrix)*normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uS; uniform vec3 uColor;
      varying vec2 vUv; varying vec3 vW; varying vec3 vN; varying vec3 vV;
      ${HEX_GLSL}
      void main(){
        float y = vUv.y;
        float base = pow(1.0-y, 2.2)*0.55;
        vec2 hp = vec2(vW.x + vW.z, vW.y)*2.2;
        float hx = smoothstep(0.42,0.49,hexEdge(hp));
        float wave = 0.5+0.5*sin(vW.y*3.0 - uTime*2.0 + (vW.x - vW.z)*0.4);
        float top = exp(-pow((y-0.97)*40.0,2.0))*1.4;
        float bot = exp(-pow(y*30.0,2.0))*1.2;
        float graze = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float i = (base*(0.6+0.4*wave) + hx*(1.0-y)*0.32*wave + top + bot) * (0.55 + graze*0.8);
        gl_FragColor = vec4(uColor*i*uS, 1.0);
      }`,
  });
}

/** Soft additive light shaft (open cone, uv.y 0 = wide far end). */
export function shaftMaterial(color: THREE.Color, strength = 0.06): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color }, uS: { value: strength }, uTime: { value: 0 } },
    vertexShader: /* glsl */ `varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vN = normalize(mat3(modelMatrix)*normal); vV = cameraPosition - w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uS, uTime; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main(){
        float facing = pow(abs(dot(normalize(vN), normalize(vV))), 1.5);
        float along = pow(vUv.y, 1.6);
        float dust = 0.85 + 0.15*sin(vUv.x*60.0 + uTime*0.7);
        gl_FragColor = vec4(uColor*facing*along*uS*dust, 1.0);
      }`,
  });
}

/**
 * Camera-facing lightning ribbons. Each segment is a quad expanded perpendicular to the
 * segment in view space. Rebuilt on demand (visual only).
 */
export class ArcBatch {
  readonly mesh: THREE.Mesh;
  private n = 0;
  private aA: Float32Array;
  private aB: Float32Array;
  private aP: Float32Array; // side, sel, width, bright
  private geo: THREE.BufferGeometry;
  constructor(private max = 900) {
    const g = new THREE.BufferGeometry();
    this.aA = new Float32Array(max * 4 * 3);
    this.aB = new Float32Array(max * 4 * 3);
    this.aP = new Float32Array(max * 4 * 4);
    const idx = new Uint16Array(max * 6);
    for (let i = 0; i < max; i++) {
      const v = i * 4;
      idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6);
    }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setAttribute('position', new THREE.BufferAttribute(this.aA, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aB', new THREE.BufferAttribute(this.aB, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aP', new THREE.BufferAttribute(this.aP, 4).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.geo = g;
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: {},
      vertexShader: /* glsl */ `
        attribute vec3 aB; attribute vec4 aP; varying float vX; varying float vBr;
        void main(){
          vec3 a = (modelViewMatrix*vec4(position,1.0)).xyz;
          vec3 b = (modelViewMatrix*vec4(aB,1.0)).xyz;
          vec3 p = mix(a, b, aP.y);
          vec3 d = normalize(b - a + 1e-5);
          vec3 side = normalize(cross(d, normalize(p)));
          p += side * aP.x * aP.z;
          vX = aP.x; vBr = aP.w;
          gl_Position = projectionMatrix*vec4(p,1.0);
        }`,
      fragmentShader: /* glsl */ `
        varying float vX; varying float vBr;
        void main(){
          float x2 = vX*vX;
          float core = exp(-x2*22.0);
          float glow = exp(-x2*3.0)*0.35;
          vec3 col = mix(vec3(0.55,0.32,1.0), vec3(1.0,0.97,1.0), core) * (core*2.6 + glow);
          gl_FragColor = vec4(col*vBr, 1.0);
        }`,
    });
    this.mesh = new THREE.Mesh(g, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }
  begin() {
    this.n = 0;
  }
  seg(a: THREE.Vector3, b: THREE.Vector3, width: number, bright: number) {
    if (this.n >= this.max) return;
    const i = this.n++;
    for (let k = 0; k < 4; k++) {
      const v = i * 4 + k;
      this.aA.set([a.x, a.y, a.z], v * 3);
      this.aB.set([b.x, b.y, b.z], v * 3);
      const side = k & 1 ? 1 : -1;
      const sel = k >> 1;
      this.aP.set([side, sel, width, bright], v * 4);
    }
  }
  /** Jagged bolt from a to b with optional branches. */
  bolt(a: THREE.Vector3, b: THREE.Vector3, opts: { segs?: number; amp?: number; width?: number; bright?: number; branches?: number }) {
    const { segs = 14, amp = 0.6, width = 0.12, bright = 1, branches = 0 } = opts;
    const pts: THREE.Vector3[] = [a.clone()];
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const up = Math.abs(dir.y / len) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const p1 = new THREE.Vector3().crossVectors(dir, up).normalize();
    const p2 = new THREE.Vector3().crossVectors(dir, p1).normalize();
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      const env = Math.sin(Math.PI * t);
      const p = a.clone().lerp(b, t);
      p.addScaledVector(p1, (Math.random() - 0.5) * 2 * amp * env);
      p.addScaledVector(p2, (Math.random() - 0.5) * 2 * amp * env);
      pts.push(p);
    }
    pts.push(b.clone());
    for (let i = 0; i < pts.length - 1; i++) {
      const t = i / (pts.length - 1);
      this.seg(pts[i], pts[i + 1], width * (1 - 0.35 * t), bright);
    }
    for (let k = 0; k < branches; k++) {
      const i = 2 + Math.floor(Math.random() * (pts.length - 4));
      const s = pts[i];
      const e = s.clone().addScaledVector(dir, (0.12 + Math.random() * 0.2)).add(
        new THREE.Vector3((Math.random() - 0.5) * len * 0.35, (Math.random() - 0.5) * len * 0.15, (Math.random() - 0.5) * len * 0.35),
      );
      this.bolt(s, e, { segs: 5, amp: amp * 0.5, width: width * 0.5, bright: bright * 0.7, branches: 0 });
    }
  }
  end() {
    const g = this.geo;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aB as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aP as THREE.BufferAttribute).needsUpdate = true;
    for (const k of ['position', 'aB', 'aP']) {
      const at = g.attributes[k] as THREE.BufferAttribute;
      at.clearUpdateRanges();
      at.addUpdateRange(0, this.n * 4 * at.itemSize);
    }
    g.setDrawRange(0, this.n * 6);
    this.mesh.visible = this.n > 0;
  }
  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

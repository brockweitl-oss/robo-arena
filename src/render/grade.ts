import * as THREE from 'three';
import { Effect } from 'postprocessing';

/**
 * Cinematic grade on tone-mapped colour: a gentle S-curve and saturation in display
 * (gamma) space, with a guard that zeroes invalid pixels instead of amplifying them.
 */
const FRAG = /* glsl */ `
  uniform float uContrast;
  uniform float uSaturation;
  uniform vec3 uLift;
  void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
    vec3 c = inputColor.rgb;
    if (!(c.r == c.r && c.g == c.g && c.b == c.b) || max(max(c.r, c.g), c.b) > 64.0) c = vec3(0.0);
    c = pow(clamp(c, 0.0, 1.0), vec3(1.0 / 2.2));
    vec3 s = c * c * (3.0 - 2.0 * c);
    c = mix(c, s, uContrast);
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c = mix(vec3(l), c, 1.0 + uSaturation);
    c += uLift * (1.0 - c);
    outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
  }
`;

export class GradeEffect extends Effect {
  constructor({ contrast = 0.3, saturation = 0.12, lift = new THREE.Vector3(0.0, 0.004, 0.012) } = {}) {
    super('GradeEffect', FRAG, {
      uniforms: new Map<string, THREE.Uniform>([
        ['uContrast', new THREE.Uniform(contrast)],
        ['uSaturation', new THREE.Uniform(saturation)],
        ['uLift', new THREE.Uniform(lift)],
      ]),
    });
  }
}

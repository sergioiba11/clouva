import { shaderMaterial } from "@react-three/drei";
import { extend } from "@react-three/fiber";
import * as THREE from "three";

/**
 * Material holográfico auto-iluminado: fresnel violeta/azul en los bordes +
 * un barrido vertical de escaneo. Reemplaza el lighting por defecto de
 * <model-viewer> sobre diagnostic_surface.glb -- la malla sigue siendo la
 * real analizada, solo cambia cómo se dibuja.
 */
const HologramMaterial = shaderMaterial(
  {
    uTime: 0,
    uColorLow: new THREE.Color("#4b1fb0"),
    uColorHigh: new THREE.Color("#3fb8ff"),
    uOpacity: 0.62,
    uFresnelPower: 1.8,
    uScanSpeed: 0.35,
    uScanWidth: 0.05,
    uModelMinY: 0,
    uModelMaxY: 1,
  },
  /* glsl vertex */ `
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vWorldY;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldY = worldPosition.y;
      vNormal = normalize(normalMatrix * normal);
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      vViewDir = normalize(-mvPosition.xyz);
      gl_Position = projectionMatrix * mvPosition;
    }
  `,
  /* glsl fragment */ `
    uniform float uTime;
    uniform vec3 uColorLow;
    uniform vec3 uColorHigh;
    uniform float uOpacity;
    uniform float uFresnelPower;
    uniform float uScanSpeed;
    uniform float uScanWidth;
    uniform float uModelMinY;
    uniform float uModelMaxY;
    varying vec3 vNormal;
    varying vec3 vViewDir;
    varying float vWorldY;

    void main() {
      float heightRange = max(uModelMaxY - uModelMinY, 0.0001);
      float heightRatio = clamp((vWorldY - uModelMinY) / heightRange, 0.0, 1.0);
      vec3 baseColor = mix(uColorLow, uColorHigh, heightRatio);

      float fresnel = pow(1.0 - clamp(dot(normalize(vNormal), normalize(vViewDir)), 0.0, 1.0), uFresnelPower);

      float scanPos = fract(uTime * uScanSpeed);
      float scanDist = abs(heightRatio - scanPos);
      float scan = smoothstep(uScanWidth, 0.0, scanDist) * 0.9;

      vec3 color = baseColor * (0.35 + fresnel * 1.4) + vec3(0.6, 0.75, 1.0) * scan;
      float alpha = clamp(uOpacity * (0.45 + fresnel * 0.8) + scan * 0.5, 0.0, 0.96);
      gl_FragColor = vec4(color, alpha);
    }
  `,
);

extend({ HologramMaterial });

declare module "@react-three/fiber" {
  interface ThreeElements {
    hologramMaterial: Partial<THREE.ShaderMaterialParameters> & {
      uTime?: number;
      uColorLow?: THREE.Color | string;
      uColorHigh?: THREE.Color | string;
      uOpacity?: number;
      uFresnelPower?: number;
      uScanSpeed?: number;
      uScanWidth?: number;
      uModelMinY?: number;
      uModelMaxY?: number;
      transparent?: boolean;
      side?: THREE.Side;
      depthWrite?: boolean;
      ref?: React.Ref<THREE.ShaderMaterial>;
    };
  }
}

export { HologramMaterial };

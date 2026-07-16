import {
  CapsuleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";

export type BaseGarmentCategory = "hoodie" | "remera" | "campera" | "baggy";

export type BaseGarmentTemplate = {
  root: Group;
  torso?: Mesh;
  hood?: Mesh;
  pocket?: Mesh;
  collar?: Mesh;
  leftUpperSleeve?: Mesh;
  rightUpperSleeve?: Mesh;
  leftLowerSleeve?: Mesh;
  rightLowerSleeve?: Mesh;
  waist?: Mesh;
  leftLeg?: Mesh;
  rightLeg?: Mesh;
};

export type GarmentMaterialOptions = {
  color?: string;
  map?: MeshPhysicalMaterial["map"];
  opacity?: number;
};

function material(options: GarmentMaterialOptions = {}) {
  return new MeshPhysicalMaterial({
    color: new Color(options.color ?? "#7b4dd4"),
    map: options.map ?? null,
    roughness: 0.86,
    metalness: 0,
    clearcoat: 0.025,
    side: DoubleSide,
    transparent: true,
    opacity: options.opacity ?? 0.97,
  });
}

function mesh(name: string, geometry: Mesh["geometry"], garmentMaterial: MeshPhysicalMaterial) {
  const item = new Mesh(geometry, garmentMaterial);
  item.name = name;
  item.castShadow = true;
  item.receiveShadow = true;
  item.frustumCulled = false;
  return item;
}

function kangarooPocketGeometry() {
  const shape = new Shape();
  shape.moveTo(-0.5, -0.32);
  shape.lineTo(0.5, -0.32);
  shape.lineTo(0.42, 0.2);
  shape.quadraticCurveTo(0, 0.42, -0.42, 0.2);
  shape.closePath();
  return new ShapeGeometry(shape, 10);
}

function buildTop(category: "hoodie" | "remera" | "campera", options: GarmentMaterialOptions) {
  const root = new Group();
  root.name = `CLOUVA_${category}_base_v1`;
  const mat = material(options);
  const result: BaseGarmentTemplate = { root };

  const torso = mesh(
    "garment_torso",
    new RoundedBoxGeometry(1.1, 1.5, 0.58, 8, 0.18),
    mat,
  );
  torso.position.y = 0.05;
  root.add(torso);
  result.torso = torso;

  const upperSleeveGeometry = new CapsuleGeometry(0.18, 0.48, 8, 18);
  const lowerSleeveGeometry = new CapsuleGeometry(0.155, 0.42, 8, 18);

  const leftUpper = mesh("sleeve_left_upper", upperSleeveGeometry, mat);
  const rightUpper = mesh("sleeve_right_upper", upperSleeveGeometry.clone(), mat);
  const leftLower = mesh("sleeve_left_lower", lowerSleeveGeometry, mat);
  const rightLower = mesh("sleeve_right_lower", lowerSleeveGeometry.clone(), mat);

  root.add(leftUpper, rightUpper, leftLower, rightLower);
  result.leftUpperSleeve = leftUpper;
  result.rightUpperSleeve = rightUpper;
  result.leftLowerSleeve = leftLower;
  result.rightLowerSleeve = rightLower;

  const collar = mesh("garment_collar", new TorusGeometry(0.23, 0.055, 12, 36), mat);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 0.78;
  root.add(collar);
  result.collar = collar;

  if (category === "hoodie") {
    const hood = mesh(
      "garment_hood",
      new SphereGeometry(0.38, 28, 20, 0, Math.PI * 2, 0.1, Math.PI * 0.76),
      mat,
    );
    hood.scale.set(0.86, 1.02, 0.68);
    hood.position.set(0, 0.92, -0.17);
    root.add(hood);
    result.hood = hood;

    const pocket = mesh("garment_pocket", kangarooPocketGeometry(), mat);
    pocket.scale.set(0.62, 0.5, 1);
    pocket.position.set(0, -0.27, 0.302);
    root.add(pocket);
    result.pocket = pocket;
  }

  if (category === "campera") {
    const zipper = mesh("garment_zipper", new RoundedBoxGeometry(0.045, 1.22, 0.035, 4, 0.015), mat);
    zipper.position.set(0, 0.02, 0.31);
    root.add(zipper);
  }

  return result;
}

function buildBaggy(options: GarmentMaterialOptions) {
  const root = new Group();
  root.name = "CLOUVA_baggy_base_v1";
  const mat = material(options);
  const result: BaseGarmentTemplate = { root };

  const waist = mesh("baggy_waist", new CylinderGeometry(0.52, 0.48, 0.32, 28), mat);
  const leftLeg = mesh("baggy_left_leg", new CapsuleGeometry(0.25, 0.86, 8, 18), mat);
  const rightLeg = mesh("baggy_right_leg", new CapsuleGeometry(0.25, 0.86, 8, 18), mat);
  root.add(waist, leftLeg, rightLeg);
  result.waist = waist;
  result.leftLeg = leftLeg;
  result.rightLeg = rightLeg;
  return result;
}

export function createBaseGarmentTemplate(
  category: BaseGarmentCategory,
  options: GarmentMaterialOptions = {},
): BaseGarmentTemplate {
  if (category === "baggy") return buildBaggy(options);
  return buildTop(category, options);
}

export function disposeBaseGarmentTemplate(template: BaseGarmentTemplate | null) {
  if (!template) return;
  template.root.traverse((object: any) => {
    object.geometry?.dispose?.();
    if (Array.isArray(object.material)) object.material.forEach((item: any) => item.dispose?.());
    else object.material?.dispose?.();
  });
  template.root.removeFromParent();
}

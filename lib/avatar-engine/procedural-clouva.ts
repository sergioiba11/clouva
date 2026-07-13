import { BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from "three";
import type { AvatarConfig } from "./types";

const material = (color: string, roughness = 0.92, metalness = 0.04) => new MeshStandardMaterial({ color, roughness, metalness });
const add = (group: Group, mesh: Mesh, position: [number, number, number], scale: [number, number, number] = [1, 1, 1], rotation: [number, number, number] = [0, 0, 0]) => {
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  group.add(mesh);
};

export function buildProceduralClouvaAvatar(config: AvatarConfig) {
  const root = new Group();
  root.name = "CLOUVA_Procedural_Avatar";

  const skin = material(config.skinTone || "#b97b5c");
  const hair = material(config.hairColor || "#211712", 0.97);
  const hoodie = material(config.materialColors.Hoodie_Main || "#070708", 0.98);
  const cargo = material("#0d0e10", 0.98);
  const panel = material("#191b1f", 0.96);
  const shoe = material("#09090b");
  const sole = material("#c8c4ba");
  const metal = material("#b9b9b9", 0.25, 0.9);
  const olive = material("#6f7938");
  const eye = material("#090909", 0.5);

  add(root, new Mesh(new CylinderGeometry(0.065, 0.075, 0.16, 12), skin), [0, 2.02, 0]);
  add(root, new Mesh(new SphereGeometry(0.175, 24, 18), skin), [0, 2.23, 0], [0.86, 1.06, 0.84]);
  add(root, new Mesh(new SphereGeometry(0.016, 10, 8), eye), [-0.06, 2.26, 0.15], [1, 0.6, 0.45]);
  add(root, new Mesh(new SphereGeometry(0.016, 10, 8), eye), [0.06, 2.26, 0.15], [1, 0.6, 0.45]);

  const hairGroup = new Group();
  hairGroup.name = "hair";
  root.add(hairGroup);
  add(hairGroup, new Mesh(new SphereGeometry(0.19, 20, 14), hair), [0, 2.36, -0.01], [1.02, 0.56, 0.95]);
  const strands: Array<[number, number, number, number]> = [
    [-0.13, 2.39, 0.08, -0.38],
    [0.13, 2.39, 0.08, 0.38],
    [-0.06, 2.44, 0.1, -0.15],
    [0.06, 2.44, 0.1, 0.15],
    [0, 2.4, 0.13, 0],
  ];
  strands.forEach(([x, y, z, rz]) => add(hairGroup, new Mesh(new ConeGeometry(0.042, 0.24, 7), hair), [x, y, z], [1, 1, 1], [0, 0, rz]));

  const top = new Group();
  top.name = "top";
  root.add(top);
  add(top, new Mesh(new CapsuleGeometry(0.27, 0.78, 10, 20), hoodie), [0, 1.53, 0], [1.18, 1.04, 0.82]);
  add(top, new Mesh(new BoxGeometry(0.68, 0.1, 0.32), panel), [0, 1.8, 0]);
  add(top, new Mesh(new TorusGeometry(0.19, 0.06, 10, 26, Math.PI * 1.25), hoodie), [0, 1.91, -0.03], [1.05, 1, 0.85], [Math.PI / 2, 0, 0.2]);
  add(top, new Mesh(new BoxGeometry(0.13, 0.1, 0.025), olive), [0.1, 1.5, 0.28]);

  add(root, new Mesh(new CapsuleGeometry(0.083, 0.74, 8, 14), hoodie), [-0.35, 1.48, 0], [1, 1, 1], [0, 0, 0.07]);
  add(root, new Mesh(new CapsuleGeometry(0.083, 0.74, 8, 14), hoodie), [0.35, 1.48, 0], [1, 1, 1], [0, 0, -0.07]);
  add(root, new Mesh(new SphereGeometry(0.072, 14, 10), skin), [-0.39, 1.02, 0.01], [0.9, 1.1, 0.9]);
  add(root, new Mesh(new SphereGeometry(0.072, 14, 10), skin), [0.39, 1.02, 0.01], [0.9, 1.1, 0.9]);

  const bottom = new Group();
  bottom.name = "bottom";
  root.add(bottom);
  add(bottom, new Mesh(new BoxGeometry(0.42, 0.22, 0.3), cargo), [0, 1.01, 0]);
  add(bottom, new Mesh(new CapsuleGeometry(0.14, 0.9, 8, 16), cargo), [-0.14, 0.52, 0], [1.2, 1, 1.03]);
  add(bottom, new Mesh(new CapsuleGeometry(0.14, 0.9, 8, 16), cargo), [0.14, 0.52, 0], [1.2, 1, 1.03]);
  add(bottom, new Mesh(new BoxGeometry(0.15, 0.2, 0.075), panel), [-0.26, 0.7, 0.16]);
  add(bottom, new Mesh(new BoxGeometry(0.15, 0.2, 0.075), panel), [0.26, 0.7, 0.16]);

  const shoes = new Group();
  shoes.name = "shoes";
  root.add(shoes);
  add(shoes, new Mesh(new BoxGeometry(0.27, 0.13, 0.52), shoe), [-0.14, 0.01, 0.09]);
  add(shoes, new Mesh(new BoxGeometry(0.27, 0.13, 0.52), shoe), [0.14, 0.01, 0.09]);
  add(shoes, new Mesh(new BoxGeometry(0.285, 0.045, 0.54), sole), [-0.14, -0.05, 0.09]);
  add(shoes, new Mesh(new BoxGeometry(0.285, 0.045, 0.54), sole), [0.14, -0.05, 0.09]);

  const accessories = new Group();
  accessories.name = "accessory";
  root.add(accessories);
  add(accessories, new Mesh(new TorusGeometry(0.155, 0.009, 8, 30, Math.PI), metal), [0, 1.77, 0.255], [1, 1.2, 1], [0, 0, Math.PI]);
  add(accessories, new Mesh(new TorusGeometry(0.12, 0.007, 8, 28, Math.PI), metal), [0, 1.72, 0.265], [1, 1.18, 1], [0, 0, Math.PI]);
  add(accessories, new Mesh(new SphereGeometry(0.028, 12, 10), olive), [0, 1.57, 0.285]);

  root.rotation.y = Math.PI;
  return root;
}

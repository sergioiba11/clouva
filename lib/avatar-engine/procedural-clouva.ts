import { BoxGeometry, CapsuleGeometry, ConeGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from "three";
import type { AvatarConfig } from "./types";

const mat = (color: string, roughness = 0.95, metalness = 0.03) => new MeshStandardMaterial({ color, roughness, metalness });
const add = (g: Group, mesh: Mesh, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]) => {
  mesh.position.set(...p); mesh.scale.set(...s); mesh.rotation.set(...r); g.add(mesh); return mesh;
};

export function buildProceduralClouvaAvatar(config: AvatarConfig) {
  const root = new Group();
  root.name = "CLOUVA_Hooded_Prototype";

  const black = mat(config.materialColors.Hoodie_Main || "#070708", 0.99);
  const black2 = mat("#111216", 0.98);
  const shadow = mat("#020203", 1);
  const cargo = mat("#0a0b0d", 0.99);
  const olive = mat("#747b3b", 0.88);
  const sole = mat("#cbc6ba", 0.9);
  const metal = mat("#b9bbc4", 0.28, 0.84);

  // Oversized hood with face mostly hidden.
  add(root, new Mesh(new SphereGeometry(0.16, 20, 16), shadow), [0, 2.2, 0], [0.9, 1.05, 0.85]);
  add(root, new Mesh(new SphereGeometry(0.25, 22, 16), black), [0, 2.31, -0.08], [1.08, 0.75, 0.94]);
  add(root, new Mesh(new TorusGeometry(0.25, 0.105, 12, 30, Math.PI * 1.45), black), [0, 2.19, -0.02], [1.05, 1.12, 0.95], [Math.PI / 2, 0, -0.25]);

  const hair = new Group(); hair.name = "hair"; root.add(hair);
  [-0.11, -0.04, 0.04, 0.11].forEach((x, i) => add(hair, new Mesh(new ConeGeometry(0.035, 0.19 + (i % 2) * 0.035, 7), black2), [x, 2.18, 0.14], [1, 1, 1], [0, 0, x * 1.7]));

  // Wide hoodie torso and long sleeves.
  const top = new Group(); top.name = "top"; root.add(top);
  add(top, new Mesh(new CapsuleGeometry(0.34, 0.62, 10, 20), black), [0, 1.56, 0], [1.32, 1, 0.84]);
  add(top, new Mesh(new BoxGeometry(0.84, 0.13, 0.34), black2), [0, 1.82, 0]);
  add(top, new Mesh(new BoxGeometry(0.26, 0.18, 0.04), black2), [0.1, 1.5, 0.3], [1, 1, 1], [0, 0, -0.12]);
  add(root, new Mesh(new CapsuleGeometry(0.09, 0.82, 8, 16), black), [-0.42, 1.47, 0], [1.15, 1, 1], [0, 0, 0.04]);
  add(root, new Mesh(new CapsuleGeometry(0.09, 0.82, 8, 16), black), [0.42, 1.47, 0], [1.15, 1, 1], [0, 0, -0.04]);
  add(root, new Mesh(new SphereGeometry(0.075, 14, 10), shadow), [-0.45, 0.96, 0.02], [0.9, 1.08, 0.9]);
  add(root, new Mesh(new SphereGeometry(0.075, 14, 10), shadow), [0.45, 0.96, 0.02], [0.9, 1.08, 0.9]);

  // Extremely baggy cargo silhouette.
  const bottom = new Group(); bottom.name = "bottom"; root.add(bottom);
  add(bottom, new Mesh(new BoxGeometry(0.48, 0.22, 0.32), cargo), [0, 1.03, 0]);
  add(bottom, new Mesh(new CapsuleGeometry(0.19, 0.92, 8, 16), cargo), [-0.17, 0.5, 0], [1.32, 1, 1.08]);
  add(bottom, new Mesh(new CapsuleGeometry(0.19, 0.92, 8, 16), cargo), [0.17, 0.5, 0], [1.32, 1, 1.08]);
  add(bottom, new Mesh(new BoxGeometry(0.18, 0.24, 0.08), black2), [-0.31, 0.68, 0.17]);
  add(bottom, new Mesh(new BoxGeometry(0.18, 0.24, 0.08), black2), [0.31, 0.68, 0.17]);
  add(bottom, new Mesh(new BoxGeometry(0.045, 0.62, 0.035), olive), [-0.34, 0.48, 0.13]);
  add(bottom, new Mesh(new BoxGeometry(0.045, 0.62, 0.035), olive), [0.34, 0.48, 0.13]);

  // Olive platform sneakers.
  const shoes = new Group(); shoes.name = "shoes"; root.add(shoes);
  add(shoes, new Mesh(new BoxGeometry(0.31, 0.16, 0.56), olive), [-0.17, 0.02, 0.1]);
  add(shoes, new Mesh(new BoxGeometry(0.31, 0.16, 0.56), olive), [0.17, 0.02, 0.1]);
  add(shoes, new Mesh(new BoxGeometry(0.325, 0.05, 0.58), sole), [-0.17, -0.055, 0.1]);
  add(shoes, new Mesh(new BoxGeometry(0.325, 0.05, 0.58), sole), [0.17, -0.055, 0.1]);

  // Layered chains.
  const acc = new Group(); acc.name = "accessory"; root.add(acc);
  add(acc, new Mesh(new TorusGeometry(0.18, 0.011, 8, 32, Math.PI), metal), [0, 1.78, 0.28], [1, 1.2, 1], [0, 0, Math.PI]);
  add(acc, new Mesh(new TorusGeometry(0.135, 0.008, 8, 30, Math.PI), metal), [0, 1.71, 0.29], [1, 1.2, 1], [0, 0, Math.PI]);
  add(acc, new Mesh(new BoxGeometry(0.045, 0.08, 0.02), olive), [0, 1.55, 0.3]);

  root.rotation.y = Math.PI;
  return root;
}

import { BoxGeometry, CapsuleGeometry, ConeGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry } from "three";
import type { AvatarConfig } from "./types";

const m = (color: string, roughness = 0.8, metalness = 0.05) => new MeshStandardMaterial({ color, roughness, metalness });

function put(parent: Group, mesh: Mesh, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0]) {
  mesh.position.set(...p); mesh.scale.set(...s); mesh.rotation.set(...r); parent.add(mesh); return mesh;
}

export function buildProceduralClouvaAvatar(config: AvatarConfig) {
  const root = new Group();
  root.name = "CLOUVA_Procedural_Avatar";

  const skin = m(config.skinTone || "#c58c6d", 0.86);
  const hair = m(config.hairColor || "#241b15", 0.92);
  const hoodie = m(config.materialColors.Hoodie_Main || "#080808", 0.92);
  const cargo = m("#0b0b0d", 0.94);
  const shoe = m("#111111", 0.9);
  const sole = m("#d2cec6", 0.86);
  const metal = m("#b9b9b9", 0.28, 0.85);
  const olive = m("#7b843f", 0.72);

  // Head and face.
  put(root, new Mesh(new SphereGeometry(0.22, 24, 18), skin), [0, 2.02, 0], [0.92, 1.08, 0.9]);
  put(root, new Mesh(new SphereGeometry(0.028, 12, 8), m("#121212")), [-0.075, 2.04, 0.19], [1, 0.55, 0.45]);
  put(root, new Mesh(new SphereGeometry(0.028, 12, 8), m("#121212")), [0.075, 2.04, 0.19], [1, 0.55, 0.45]);

  // Messy layered hair.
  const hg = new Group(); hg.name = "hair"; root.add(hg);
  put(hg, new Mesh(new SphereGeometry(0.25, 20, 14), hair), [0, 2.16, -0.01], [1.05, 0.7, 1.02]);
  [[-0.17,2.18,0.08,-0.45],[0.17,2.18,0.07,0.45],[-0.09,2.23,0.12,-0.18],[0.08,2.24,0.13,0.18],[0,2.18,0.18,0]].forEach(([x,y,z,rz]) => put(hg,new Mesh(new ConeGeometry(0.07,0.34,8),hair),[x,y,z],[1,1,1],[0,0,rz]));

  // Oversized hoodie.
  const top = new Group(); top.name = "top"; root.add(top);
  put(top, new Mesh(new CapsuleGeometry(0.34, 0.56, 8, 18), hoodie), [0, 1.45, 0], [1.15, 1, 0.88]);
  put(top, new Mesh(new TorusGeometry(0.24, 0.09, 10, 24, Math.PI * 1.25), hoodie), [0, 1.77, -0.04], [1.1, 1, 0.9], [Math.PI / 2, 0, 0.25]);
  put(top, new Mesh(new BoxGeometry(0.15, 0.13, 0.03), olive), [0.12, 1.47, 0.31]);

  // Arms.
  put(root, new Mesh(new CapsuleGeometry(0.105, 0.64, 8, 14), hoodie), [-0.43, 1.43, 0], [1.08, 1, 1], [0,0,0.13]);
  put(root, new Mesh(new CapsuleGeometry(0.105, 0.64, 8, 14), hoodie), [0.43, 1.43, 0], [1.08, 1, 1], [0,0,-0.13]);
  put(root, new Mesh(new SphereGeometry(0.095, 14, 10), skin), [-0.5, 1.03, 0]);
  put(root, new Mesh(new SphereGeometry(0.095, 14, 10), skin), [0.5, 1.03, 0]);

  // Baggy cargos.
  const bottom = new Group(); bottom.name = "bottom"; root.add(bottom);
  put(bottom, new Mesh(new BoxGeometry(0.5, 0.25, 0.34), cargo), [0, 1.0, 0]);
  put(bottom, new Mesh(new CapsuleGeometry(0.17, 0.72, 8, 14), cargo), [-0.17, 0.55, 0], [1.1,1,1]);
  put(bottom, new Mesh(new CapsuleGeometry(0.17, 0.72, 8, 14), cargo), [0.17, 0.55, 0], [1.1,1,1]);
  put(bottom, new Mesh(new BoxGeometry(0.17, 0.22, 0.08), cargo), [-0.3, 0.72, 0.19]);
  put(bottom, new Mesh(new BoxGeometry(0.17, 0.22, 0.08), cargo), [0.3, 0.72, 0.19]);

  // Sneakers.
  const shoes = new Group(); shoes.name = "shoes"; root.add(shoes);
  put(shoes, new Mesh(new BoxGeometry(0.3, 0.15, 0.55), shoe), [-0.17, 0.08, 0.08]);
  put(shoes, new Mesh(new BoxGeometry(0.3, 0.15, 0.55), shoe), [0.17, 0.08, 0.08]);
  put(shoes, new Mesh(new BoxGeometry(0.31, 0.05, 0.57), sole), [-0.17, 0.015, 0.08]);
  put(shoes, new Mesh(new BoxGeometry(0.31, 0.05, 0.57), sole), [0.17, 0.015, 0.08]);

  // Chain and pendant.
  const acc = new Group(); acc.name = "accessory"; root.add(acc);
  put(acc, new Mesh(new TorusGeometry(0.18, 0.012, 8, 30, Math.PI), metal), [0, 1.69, 0.27], [1,1.2,1], [0,0,Math.PI]);
  put(acc, new Mesh(new SphereGeometry(0.035, 12, 10), olive), [0, 1.53, 0.3]);

  root.rotation.y = Math.PI;
  return root;
}

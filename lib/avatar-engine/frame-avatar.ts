import { Box3, MathUtils, Mesh, Object3D, PerspectiveCamera, Vector3 } from "three";

export type AvatarFrameResult = {
  center: Vector3;
  size: Vector3;
  distance: number;
};

/**
 * Los GLB generados por IA (Meshy, etc.) a veces traen fragmentos de malla
 * sueltos y lejanos del cuerpo principal (ej. un pedazo de mano flotando).
 * Si se usa la caja englobante de TODO el objeto, ese fragmento lejano
 * infla la caja y la cámara se aleja muchísimo, dejando el personaje
 * real como un punto diminuto. Esta función arma la caja a partir de
 * los meshes con más vértices (el "cuerpo principal"), ignorando
 * fragmentos chicos y lejanos, sin borrar nada de la escena.
 */
function mainBodyBox(object: Object3D): Box3 {
  const meshEntries: { mesh: Mesh; box: Box3; vertexCount: number }[] = [];
  object.traverse((child) => {
    if ((child as Mesh).isMesh) {
      const mesh = child as Mesh;
      const geometry = mesh.geometry;
      const vertexCount = geometry?.attributes?.position?.count ?? 0;
      if (vertexCount < 8) return; // ignora artefactos microscópicos
      const box = new Box3().setFromObject(mesh);
      if (box.isEmpty()) return;
      meshEntries.push({ mesh, box, vertexCount });
    }
  });

  if (meshEntries.length === 0) return new Box3().setFromObject(object);

  const totalVertices = meshEntries.reduce((sum, e) => sum + e.vertexCount, 0);
  // El "cuerpo principal" son los meshes que juntos suman la mayoría de los
  // vértices, ordenados de mayor a menor. Un fragmento suelto suele tener
  // muy pocos vértices en comparación con el cuerpo real.
  meshEntries.sort((a, b) => b.vertexCount - a.vertexCount);
  const mainBox = new Box3();
  let accumulated = 0;
  for (const entry of meshEntries) {
    if (accumulated >= totalVertices * 0.9 && accumulated > 0) break;
    mainBox.union(entry.box);
    accumulated += entry.vertexCount;
  }
  return mainBox.isEmpty() ? new Box3().setFromObject(object) : mainBox;
}

export function normalizeAvatarObject(
  object: Object3D,
  options: { targetHeight?: number; frontRotationY?: number } = {},
) {
  const targetHeight = options.targetHeight ?? 2.05;
  object.rotation.y = options.frontRotationY ?? 0;
  object.updateMatrixWorld(true);

  const initialBox = mainBodyBox(object);
  const initialSize = initialBox.getSize(new Vector3());
  if (initialSize.y > 0.0001) object.scale.multiplyScalar(targetHeight / initialSize.y);

  object.updateMatrixWorld(true);
  const box = mainBodyBox(object);
  const center = box.getCenter(new Vector3());
  object.position.x -= center.x;
  object.position.z -= center.z;
  object.position.y -= box.min.y;
  object.updateMatrixWorld(true);
}

export function frameAvatar(
  camera: PerspectiveCamera,
  object: Object3D,
  aspect: number,
  padding = 1.18,
): AvatarFrameResult {
  object.updateMatrixWorld(true);
  const box = mainBodyBox(object);
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const safeAspect = Math.max(aspect, 0.1);
  const verticalFov = MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * safeAspect);
  const distance = Math.max(
    size.y / (2 * Math.tan(verticalFov / 2)),
    size.x / (2 * Math.tan(horizontalFov / 2)),
    size.z * 2,
    2.2,
  ) * padding;

  camera.aspect = safeAspect;
  camera.near = Math.max(distance / 120, 0.02);
  camera.far = Math.max(distance * 20, 100);
  camera.position.set(center.x, center.y + size.y * 0.02, center.z + distance);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  return { center, size, distance };
}

export type BodyPartMatch = { meshName: string; box: Box3 };

/**
 * Busca, dentro del avatar ya cargado, la malla correspondiente a una
 * categoría de prenda (ej. 'hoodie' -> torso) y devuelve su caja
 * englobante REAL en espacio de mundo — estas son medidas del GLB de
 * verdad, no una suposición.
 */
export function findAvatarBodyPart(avatarObject: Object3D, meshNames: string[]): BodyPartMatch | null {
  const result: { match: { mesh: Object3D; box: Box3 } | null } = { match: null };
  avatarObject.updateMatrixWorld(true);
  avatarObject.traverse((child) => {
    if (result.match) return;
    if (meshNames.includes(child.name)) {
      const box = new Box3().setFromObject(child);
      if (!box.isEmpty()) result.match = { mesh: child, box };
    }
  });
  return result.match ? { meshName: result.match.mesh.name, box: result.match.box } : null;
}

/**
 * Escala y posiciona una prenda (ya con su propia geometría/escala
 * original) para que su caja englobante coincida con la de la parte
 * del cuerpo real del avatar (ej. el torso), en vez de solo igualar
 * la altura total del avatar completo. Esto es lo que hace que una
 * prenda generada por separado "calce" razonablemente en vez de
 * quedar del tamaño equivocado.
 */
export function fitGarmentToBodyPart(garment: Object3D, bodyPartBox: Box3, options: { paddingScale?: number } = {}) {
  garment.updateMatrixWorld(true);
  const garmentBox = new Box3().setFromObject(garment);
  const garmentSize = garmentBox.getSize(new Vector3());
  const bodySize = bodyPartBox.getSize(new Vector3());

  if (garmentSize.y < 0.0001) return;

  // Escala uniforme basada en la altura de la parte del cuerpo (la
  // dimensión más estable para prendas de torso/piernas/pies).
  const scale = (bodySize.y / garmentSize.y) * (options.paddingScale ?? 1.06);
  garment.scale.multiplyScalar(scale);

  garment.updateMatrixWorld(true);
  const rescaledBox = new Box3().setFromObject(garment);
  const rescaledCenter = rescaledBox.getCenter(new Vector3());
  const bodyCenter = bodyPartBox.getCenter(new Vector3());

  garment.position.x += bodyCenter.x - rescaledCenter.x;
  garment.position.y += bodyCenter.y - rescaledCenter.y;
  garment.position.z += bodyCenter.z - rescaledCenter.z;
  garment.updateMatrixWorld(true);
}

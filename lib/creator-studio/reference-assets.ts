export const REFERENCE_CATEGORIES = [
  "hoodie",
  "remera",
  "campera",
  "baggy",
  "zapatillas",
  "gorra",
  "cadena",
  "lentes",
  "mochila",
  "aros",
  "guantes",
  "pulseras",
  "anillos",
] as const;

export type ReferenceCategory = (typeof REFERENCE_CATEGORIES)[number];

export type ReferenceAsset = {
  id: string;
  name: string;
  category: ReferenceCategory;
  fileName: string;
  size: number;
  createdAt: number;
  sourceUrl?: string;
  license?: string;
  author?: string;
  file: Blob;
};

const DB_NAME = "clouva-creator-studio";
const STORE_NAME = "reference-assets";
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("No se pudo abrir la biblioteca local"));
  });
}

export async function listReferenceAssets(): Promise<ReferenceAsset[]> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve((request.result as ReferenceAsset[]).sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error ?? new Error("No se pudo leer la biblioteca"));
    transaction.oncomplete = () => db.close();
  });
}

export async function saveReferenceAsset(asset: ReferenceAsset): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(asset);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo guardar el GLB"));
  });
}

export async function deleteReferenceAsset(id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error ?? new Error("No se pudo eliminar el GLB"));
  });
}

export function makeReferenceAsset(file: File, category: ReferenceCategory, metadata: Partial<Pick<ReferenceAsset, "name" | "sourceUrl" | "license" | "author">> = {}): ReferenceAsset {
  return {
    id: crypto.randomUUID(),
    name: metadata.name?.trim() || file.name.replace(/\.glb$/i, ""),
    category,
    fileName: file.name,
    size: file.size,
    createdAt: Date.now(),
    sourceUrl: metadata.sourceUrl?.trim() || undefined,
    license: metadata.license?.trim() || undefined,
    author: metadata.author?.trim() || undefined,
    file,
  };
}

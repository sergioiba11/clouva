import type { VideoGenerationProvider, VideoProviderKey } from "./types";
import { getVertexVeoProvider } from "./vertex-veo";

export type {
  StartVideoProviderArgs,
  VideoGenerationProvider,
  VideoProviderImage,
  VideoProviderKey,
  VideoProviderOperation,
} from "./types";

export function getVideoProvider(key: VideoProviderKey | string): VideoGenerationProvider {
  if (key === "google_vertex_ai") return getVertexVeoProvider();
  throw new Error(`Proveedor de video no soportado: ${key}`);
}

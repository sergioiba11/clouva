import { studioPublicHref } from "@/lib/public-studio-routes";

export const IGLU_STUDIO_SLUG = "el-iglu";
export const IGLU_PUBLIC_ALIAS = "eliglurecords";
export const IGLU_STUDIO_PATH = studioPublicHref(IGLU_PUBLIC_ALIAS);
export const IGLU_RADIO_PATH = `${IGLU_STUDIO_PATH}/radio`;

export function igluRadioRoute(segment = "") {
  const clean = segment.trim().replace(/^\/+|\/+$/g, "");
  return clean ? `${IGLU_RADIO_PATH}/${clean}` : IGLU_RADIO_PATH;
}

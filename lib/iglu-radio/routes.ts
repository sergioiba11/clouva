export const IGLU_STUDIO_SLUG = "el-iglu";
export const IGLU_STUDIO_PATH = `/studios/${IGLU_STUDIO_SLUG}`;
export const IGLU_RADIO_PATH = `${IGLU_STUDIO_PATH}/radio`;

export function igluRadioRoute(segment = "") {
  const clean = segment.trim().replace(/^\/+|\/+$/g, "");
  return clean ? `${IGLU_RADIO_PATH}/${clean}` : IGLU_RADIO_PATH;
}

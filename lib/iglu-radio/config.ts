export const IGLU_RADIO_STREAM_URL = process.env.NEXT_PUBLIC_IGLU_RADIO_STREAM_URL?.trim() ?? "";

export const IGLU_RADIO_STATION_NAME = "IGLÚ RADIO";
export const IGLU_RADIO_TAGLINE = "DEL SUR PARA EL MUNDO";

export function hasIgluRadioStream() {
  return IGLU_RADIO_STREAM_URL.length > 0;
}

export type IgluRadioStatus = "IDLE" | "CONNECTING" | "LIVE" | "OFFLINE" | "ERROR";

export type IgluRadioMetadata = {
  title: string;
  artist: string;
  program: string;
  host?: string | null;
  artwork?: string | null;
  startedAt?: string | null;
  endsAt?: string | null;
};

export const DEFAULT_IGLU_RADIO_METADATA: IgluRadioMetadata = {
  title: "IGLÚ RADIO",
  artist: "IGLÚ RECORDS",
  program: "Señal principal",
  host: null,
  artwork: null,
  startedAt: null,
  endsAt: null,
};

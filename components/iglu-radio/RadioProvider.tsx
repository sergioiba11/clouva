"use client";

import type { ReactNode } from "react";
import { RadioProvider as CoreRadioProvider, useRadio } from "@/components/radio/RadioProvider";
import { IGLU_RADIO_STREAM_URL } from "@/lib/iglu-radio/config";
import { DEFAULT_IGLU_RADIO_METADATA } from "@/lib/iglu-radio/types";
import type { RadioStationConfig } from "@/lib/radio/types";

const LEGACY_IGLU_STATION: RadioStationConfig = {
  id: "iglu-legacy",
  ownerKind: "studio",
  ownerId: "iglu",
  alias: "iglu",
  profileHref: "/el-iglu",
  name: "IGLÚ RADIO",
  tagline: "DEL SUR PARA EL MUNDO",
  streamUrl: IGLU_RADIO_STREAM_URL,
  artworkUrl: null,
  enabled: true,
  published: true,
  metadata: DEFAULT_IGLU_RADIO_METADATA,
};

export function RadioProvider({ children, station = LEGACY_IGLU_STATION }: { children: ReactNode; station?: RadioStationConfig }) {
  return <CoreRadioProvider station={station}>{children}</CoreRadioProvider>;
}

export const useIgluRadio = useRadio;

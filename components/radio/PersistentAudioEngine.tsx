"use client";

import { useEffect } from "react";
import { useRadio } from "@/components/radio/RadioProvider";

export function PersistentAudioEngine() {
  const { bindAudio, reportEngineEvent, station, streamUrl } = useRadio();

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.debug(`[RADIO:${station.alias}] PersistentAudioEngine mounted`);
      return () => console.debug(`[RADIO:${station.alias}] PersistentAudioEngine unmounted`);
    }
    return undefined;
  }, [station.alias]);

  return (
    <audio
      ref={bindAudio}
      src={streamUrl || undefined}
      preload="none"
      className="hidden"
      aria-hidden="true"
      onPlay={() => reportEngineEvent("connecting")}
      onPlaying={() => reportEngineEvent("playing")}
      onPause={() => reportEngineEvent("paused")}
      onWaiting={() => reportEngineEvent("waiting")}
      onStalled={() => reportEngineEvent("waiting")}
      onError={() => reportEngineEvent("error")}
    />
  );
}

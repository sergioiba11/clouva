"use client";

import { useEffect } from "react";
import { useIgluRadio } from "@/components/iglu-radio/RadioProvider";

export function PersistentAudioEngine() {
  const { bindAudio, reportEngineEvent, streamUrl } = useIgluRadio();

  useEffect(() => {
    if (process.env.NODE_ENV === "development") {
      console.debug("[IGLÚ RADIO] PersistentAudioEngine mounted");
      return () => console.debug("[IGLÚ RADIO] PersistentAudioEngine unmounted");
    }
    return undefined;
  }, []);

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

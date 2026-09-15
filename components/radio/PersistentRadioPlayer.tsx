"use client";

import { Maximize2, Minimize2, Pause, Play, Radio, RotateCcw, Volume2, VolumeX, X } from "lucide-react";
import { useEffect } from "react";
import { useRadio } from "@/components/radio/RadioProvider";

function statusLabel(status: ReturnType<typeof useRadio>["status"]) {
  switch (status) {
    case "LIVE": return "LIVE";
    case "CONNECTING": return "CONECTANDO";
    case "OFFLINE": return "SIN TRANSMISIÓN";
    case "ERROR": return "ERROR DE SEÑAL";
    default: return "LISTA PARA SONAR";
  }
}

export function PersistentRadioPlayer() {
  const radio = useRadio();
  const stationName = radio.station.name;

  useEffect(() => {
    if (!radio.expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [radio.expanded]);

  const primaryAction = radio.status === "ERROR" ? radio.retry : radio.togglePlay;

  return (
    <>
      <section className="iglu-radio-player" aria-label={`Reproductor ${stationName}`}>
        <button type="button" className="iglu-radio-player__identity" onClick={radio.expandPlayer} aria-label="Abrir reproductor completo">
          <span className="iglu-radio-player__art"><Radio size={20} /></span>
          <span className="iglu-radio-player__copy">
            <strong>{stationName}</strong>
            <span>{radio.metadata.program}</span>
          </span>
        </button>

        <div className="iglu-radio-player__center">
          <button
            type="button"
            className="iglu-radio-player__play"
            onClick={() => void primaryAction()}
            aria-label={radio.isPlaying ? `Pausar ${stationName}` : radio.status === "ERROR" ? `Reintentar ${stationName}` : `Reproducir ${stationName}`}
          >
            {radio.status === "ERROR" ? <RotateCcw size={20} /> : radio.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <span className={`iglu-radio-status iglu-radio-status--${radio.status.toLowerCase()}`}>
            <i /> {statusLabel(radio.status)}
          </span>
        </div>

        <div className="iglu-radio-player__controls">
          <button type="button" className="iglu-radio-icon-button" onClick={radio.toggleMute} aria-label={radio.isMuted ? "Activar audio" : "Silenciar radio"}>
            {radio.isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            aria-label={`Volumen de ${stationName}`}
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={radio.volume}
            onChange={(event) => radio.setVolume(Number(event.target.value))}
          />
          <button type="button" className="iglu-radio-icon-button" onClick={radio.expandPlayer} aria-label="Expandir reproductor">
            <Maximize2 size={18} />
          </button>
        </div>
      </section>

      {radio.expanded ? (
        <div className="iglu-radio-expanded" role="dialog" aria-modal="true" aria-label={stationName}>
          <button type="button" className="iglu-radio-expanded__close" onClick={radio.collapsePlayer} aria-label="Cerrar reproductor completo">
            <X size={24} />
          </button>
          <div className="iglu-radio-expanded__signal" aria-hidden="true">
            <span /><span /><span /><span /><span /><span /><span />
          </div>
          <div className="iglu-radio-expanded__disc">
            <Radio size={48} />
            <span>{stationName}</span>
            <small>RADIO</small>
          </div>
          <div className="iglu-radio-expanded__copy">
            <span className={`iglu-radio-status iglu-radio-status--${radio.status.toLowerCase()}`}><i /> {statusLabel(radio.status)}</span>
            <h2>{radio.metadata.title}</h2>
            <p>{radio.metadata.program}</p>
            <small>{radio.metadata.artist}</small>
          </div>
          <button type="button" className="iglu-radio-expanded__play" onClick={() => void primaryAction()} aria-label={radio.isPlaying ? "Pausar" : "Reproducir"}>
            {radio.status === "ERROR" ? <RotateCcw size={30} /> : radio.isPlaying ? <Pause size={30} fill="currentColor" /> : <Play size={30} fill="currentColor" />}
          </button>
          <div className="iglu-radio-expanded__volume">
            <button type="button" onClick={radio.toggleMute} aria-label={radio.isMuted ? "Activar audio" : "Silenciar"}>
              {radio.isMuted ? <VolumeX size={20} /> : <Volume2 size={20} />}
            </button>
            <input aria-label="Volumen" type="range" min="0" max="1" step="0.01" value={radio.volume} onChange={(event) => radio.setVolume(Number(event.target.value))} />
          </div>
          <button type="button" className="iglu-radio-expanded__collapse" onClick={radio.collapsePlayer}>
            <Minimize2 size={17} /> MINIMIZAR
          </button>
        </div>
      ) : null}
    </>
  );
}

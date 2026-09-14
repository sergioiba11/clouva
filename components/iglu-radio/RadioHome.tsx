"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Mic2, Pause, Play, Radio, Users, Waves } from "lucide-react";
import { useIgluRadio } from "@/components/iglu-radio/RadioProvider";

function humanStatus(status: ReturnType<typeof useIgluRadio>["status"]) {
  if (status === "LIVE") return "LIVE";
  if (status === "CONNECTING") return "CONECTANDO SEÑAL";
  if (status === "ERROR") return "NO SE PUDO CONECTAR";
  if (status === "OFFLINE") return "SIN TRANSMISIÓN";
  return "SEÑAL LISTA";
}

export function RadioHome() {
  const radio = useIgluRadio();
  const action = radio.status === "ERROR" ? radio.retry : radio.togglePlay;

  return (
    <>
      <section className="iglu-radio-hero">
        <div className="iglu-radio-hero__microcopy">
          <span /> MUSIC BEYOND BORDERS <span />
        </div>

        <div className="iglu-radio-hero__title" aria-label="IGLÚ RADIO">
          <span className="iglu-radio-hero__iglu">IGLÚ</span>
          <span className="iglu-radio-hero__radio">RADIO</span>
        </div>

        <div className="iglu-radio-hero__genres">
          DIGITAL RADIO <b>•</b> HIP HOP <b>•</b> LATIN URBAN <b>•</b> LIVE SESSIONS
        </div>
        <p className="iglu-radio-hero__bridge">CONNECTING THE SOUTH THROUGH MUSIC</p>

        <div className="iglu-radio-hero__stage">
          <div className="iglu-radio-emblem" aria-hidden="true">
            <div className="iglu-radio-emblem__ring">
              <Waves size={38} />
              <strong>IGLÚ</strong>
              <small>RADIO</small>
            </div>
          </div>
          <div className="iglu-radio-broadcast-card">
            <span className={`iglu-radio-status iglu-radio-status--${radio.status.toLowerCase()}`}><i /> {humanStatus(radio.status)}</span>
            <small>SEÑAL PRINCIPAL</small>
            <strong>{radio.metadata.title}</strong>
            <p>{radio.hasStream ? radio.metadata.program : "IGLÚ RADIO todavía no está transmitiendo."}</p>
          </div>
        </div>

        <div className="iglu-radio-hero__actions">
          <button type="button" className="iglu-radio-primary-cta" onClick={() => void action()}>
            {radio.isPlaying ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
            {radio.status === "ERROR" ? "REINTENTAR" : radio.isPlaying ? "PAUSAR RADIO" : radio.status === "CONNECTING" ? "CONECTANDO..." : "ESCUCHAR EN VIVO"}
          </button>
          <Link href="/iglu/radio/schedule" className="iglu-radio-secondary-cta">
            <CalendarDays size={18} /> VER PROGRAMACIÓN
          </Link>
        </div>
        <p className="iglu-radio-hero__footer">SOUTHERN SOUNDS <b>•</b> GLOBAL REACH</p>
      </section>

      <section className="iglu-radio-editorial" aria-labelledby="ahora-al-aire">
        <div className="iglu-radio-section-heading">
          <span>01 / TRANSMISIÓN</span>
          <h2 id="ahora-al-aire">AHORA AL AIRE</h2>
        </div>
        <div className="iglu-radio-now">
          <div className="iglu-radio-now__art"><Radio size={44} /><span>IGLÚ</span></div>
          <div className="iglu-radio-now__body">
            <span className={`iglu-radio-status iglu-radio-status--${radio.status.toLowerCase()}`}><i /> {humanStatus(radio.status)}</span>
            <h3>{radio.status === "LIVE" ? radio.metadata.program : "IGLÚ RADIO"}</h3>
            <p>{radio.status === "LIVE" ? `${radio.metadata.artist} · ${radio.metadata.title}` : radio.hasStream ? "La señal está lista. Tocá play para entrar a la frecuencia." : "La infraestructura está preparada; falta conectar el stream oficial para salir al aire."}</p>
          </div>
          <button type="button" onClick={() => void action()} className="iglu-radio-now__action">
            {radio.isPlaying ? "SONANDO" : radio.status === "ERROR" ? "REINTENTAR" : "ESCUCHAR"} <ArrowRight size={18} />
          </button>
        </div>

        <div className="iglu-radio-up-next">
          <div><span>UP NEXT</span><strong>PROGRAMACIÓN</strong></div>
          <p>La grilla todavía no fue publicada. Cuando exista programación real, aparecerá acá sin inventar horarios ni emisiones.</p>
          <Link href="/iglu/radio/schedule">VER SCHEDULE <ArrowRight size={16} /></Link>
        </div>
      </section>

      <section className="iglu-radio-editorial iglu-radio-editorial--grid">
        <Link href="/iglu/radio/sesiones" className="iglu-radio-feature-card iglu-radio-feature-card--sessions">
          <span><Mic2 size={17} /> IGLÚ SESSIONS</span>
          <h3>LA CABINA<br />SE ABRE.</h3>
          <p>Live sessions, freestyles, entrevistas y sets nacidos dentro del universo IGLÚ.</p>
          <small>ARCHIVO EN PREPARACIÓN <ArrowRight size={14} /></small>
        </Link>
        <Link href="/iglu/radio/artistas" className="iglu-radio-feature-card iglu-radio-feature-card--artists">
          <span><Users size={17} /> ARTIST SPOTLIGHT</span>
          <h3>DEL SUR<br />AL MUNDO.</h3>
          <p>Un espacio editorial para los artistas, voces y escenas que pasan por IGLÚ.</p>
          <small>VER ARTISTAS <ArrowRight size={14} /></small>
        </Link>
        <Link href="/iglu/radio/programas" className="iglu-radio-feature-card iglu-radio-feature-card--culture">
          <span><Radio size={17} /> CULTURA</span>
          <h3>MÁS QUE<br />RADIO.</h3>
          <p>Programas, historias y conversaciones conectando música, personas y cultura.</p>
          <small>VER PROGRAMAS <ArrowRight size={14} /></small>
        </Link>
      </section>

      <section className="iglu-radio-manifesto">
        <span>MUSIC · PEOPLE · CULTURE</span>
        <h2>IGLÚ RECORDS CREA LA MÚSICA.<br /><em>IGLÚ RADIO LA TRANSMITE.</em></h2>
        <p>DEL SUR PARA EL MUNDO.</p>
      </section>
    </>
  );
}

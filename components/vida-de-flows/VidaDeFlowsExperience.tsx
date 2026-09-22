import Link from "next/link";
import styles from "./VidaDeFlowsExperience.module.css";

type VidaDeFlowsExperienceProps = {
  alias: string;
  displayName: string;
  profileImageUrl?: string | null;
  heroImageUrl?: string | null;
  spotifyUrl?: string | null;
  youtubeUrl?: string | null;
};

const scenes = [
  {
    number: "01",
    title: "PERFIL",
    copy: "Clouva al frente. Identidad, postura y presencia.",
  },
  {
    number: "02",
    title: "AVISPAO",
    copy: "Otro ángulo. Más cerca. Vida de Flows escrito en la piel.",
  },
  {
    number: "03",
    title: "HOLOGRAMA",
    copy: "La identidad entra al plano digital y se multiplica.",
  },
  {
    number: "04",
    title: "ROBOT",
    copy: "Cuerpo, tecnología y personaje en una misma escena.",
  },
  {
    number: "05",
    title: "HUMO / TERERÉ",
    copy: "Pausa, humo, naranja y textura de vida cotidiana.",
  },
  {
    number: "06",
    title: "HISTORIA / CONCRETO",
    copy: "La última escena baja todo a tierra: origen, calle y memoria.",
  },
] as const;

function ExternalListenButton({
  spotifyUrl,
  youtubeUrl,
}: {
  spotifyUrl?: string | null;
  youtubeUrl?: string | null;
}) {
  const href = spotifyUrl || youtubeUrl;
  if (!href) return null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={styles.primaryAction}
    >
      ESCUCHAR
      <span aria-hidden="true">↗</span>
    </a>
  );
}

export function VidaDeFlowsExperience({
  alias,
  displayName,
  profileImageUrl,
  heroImageUrl,
  spotifyUrl,
  youtubeUrl,
}: VidaDeFlowsExperienceProps) {
  const visualImage = heroImageUrl || profileImageUrl;

  return (
    <main className={styles.page}>
      <div className={styles.ambient} aria-hidden="true">
        <span className={styles.ambientOne} />
        <span className={styles.ambientTwo} />
        <span className={styles.ambientThree} />
      </div>

      <header className={styles.topbar}>
        <Link href={`/${alias}`} className={styles.brand}>
          <span className={styles.brandDot} />
          CLOUVA
        </Link>

        <nav className={styles.nav} aria-label="Vida de Flows">
          <a href="#inicio">INICIO</a>
          <a href="#escenas">ESCENAS</a>
          <Link href={`/${alias}`}>PLAYER</Link>
        </nav>

        <span className={styles.projectCode}>VDF / 001</span>
      </header>

      <section id="inicio" className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.eyebrow}>CLOUVA PRESENTA</p>
          <h1>
            <span>VIDA</span>
            <span>DE FLOWS</span>
          </h1>
          <p className={styles.manifesto}>Clouva, vida de flows.</p>

          <div className={styles.actions}>
            <ExternalListenButton
              spotifyUrl={spotifyUrl}
              youtubeUrl={youtubeUrl}
            />
            <a href="#escenas" className={styles.secondaryAction}>
              VER UNIVERSO
              <span aria-hidden="true">↓</span>
            </a>
          </div>
        </div>

        <div className={styles.heroVisual} aria-label="Vida de Flows">
          <div className={styles.orbit} aria-hidden="true">
            <span>VIDA</span>
            <span>FLOW</span>
            <span>CLOUVA</span>
          </div>

          <div className={styles.poster}>
            {visualImage ? (
              <img
                src={visualImage}
                alt={displayName}
                className={styles.posterImage}
              />
            ) : (
              <div className={styles.posterFallback} aria-hidden="true">
                <span>V</span>
                <span>D</span>
                <span>F</span>
              </div>
            )}
            <div className={styles.posterShade} />
            <div className={styles.posterType}>
              <small>{displayName}</small>
              <strong>VIDA / FLOWS</strong>
            </div>
          </div>

          <div className={styles.floatTag}>
            <span>06</span>
            ESCENAS
          </div>
        </div>

        <div className={styles.heroFooter}>
          <span>DEL SUR PARA EL MUNDO</span>
          <span className={styles.heroLine} />
          <span>VIDA DE FLOWS</span>
        </div>
      </section>

      <section id="escenas" className={styles.scenesSection}>
        <div className={styles.sectionIntro}>
          <p className={styles.eyebrow}>VISUAL SYSTEM / 06 FRAMES</p>
          <h2>UN MISMO UNIVERSO.<br />SEIS MOMENTOS.</h2>
          <p>
            Cada escena cambia el estado visual sin romper la identidad general
            de Vida de Flows.
          </p>
        </div>

        <div className={styles.sceneGrid}>
          {scenes.map((scene, index) => (
            <article className={styles.sceneCard} key={scene.number}>
              <div className={styles.sceneHead}>
                <span>{scene.number}</span>
                <span>VDF</span>
              </div>

              <div className={styles.sceneArtwork} aria-hidden="true">
                <span className={styles.sceneGlow} />
                <strong>{scene.number}</strong>
                <div className={styles.sceneBars}>
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
              </div>

              <div className={styles.sceneBody}>
                <p>{String(index + 1).padStart(2, "0")} / 06</p>
                <h3>{scene.title}</h3>
                <span>{scene.copy}</span>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.identitySection}>
        <div className={styles.identityMark} aria-hidden="true">
          VDF
        </div>
        <div className={styles.identityCopy}>
          <p className={styles.eyebrow}>PLAYER / {displayName.toUpperCase()}</p>
          <h2>VIDA DE FLOWS<br />VIVE DENTRO DE CLOUVA.</h2>
          <p>
            La obra tiene su propio espacio, pero mantiene conexión directa con
            la identidad pública del Player.
          </p>
          <Link href={`/${alias}`} className={styles.playerAction}>
            ENTRAR A {displayName.toUpperCase()}
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <span>© CLOUVA</span>
        <span>VIDA DE FLOWS</span>
        <Link href={`/${alias}`}>/{alias}</Link>
      </footer>
    </main>
  );
}

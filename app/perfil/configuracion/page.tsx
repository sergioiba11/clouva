import { SpotifyHomeConnectAction } from "@/components/music/SpotifyHomeConnectAction";

const profileSettings = [
  "tema",
  "glow intensity",
  "accent color",
  "privacidad",
  "notificaciones",
  "links sociales",
];

export default function Page() {
  return (
    <section className="panel space-y-5 rounded-3xl p-6">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">PLAYER</p>
        <h1 className="mt-1 text-2xl font-semibold">Configuración de Perfil</h1>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#78e49d]/70">Integraciones</p>
            <h2 className="mt-1 text-base font-semibold">Spotify</h2>
            <p className="mt-1 max-w-lg text-sm leading-relaxed text-white/50">
              Conectá tu cuenta para que CLOUVA pueda mostrar en pequeño lo que estás escuchando cuando haya reproducción real. Si no estás reproduciendo música, no aparece nada en el Home.
            </p>
          </div>
          <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[#1ed760] shadow-[0_0_18px_rgba(30,215,96,.35)]" aria-hidden="true" />
        </div>
        <SpotifyHomeConnectAction returnPath="/perfil/configuracion" />
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        {profileSettings.map((setting) => (
          <label key={setting} className="rounded-xl border border-white/10 p-3 text-sm capitalize">
            {setting}
            <input
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 p-2"
              placeholder={`Configurar ${setting}`}
            />
          </label>
        ))}
      </div>
    </section>
  );
}

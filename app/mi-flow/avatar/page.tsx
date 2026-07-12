"use client";

import { useAuth } from "@/components/auth-provider";
import { useEffect, useRef, useState } from "react";

// MetaPerson (Avatar SDK) reemplaza a Ready Player Me, que cerró el 31/01/2026.
// Estas credenciales son de uso client-side por diseño de MetaPerson (se mandan
// por postMessage al iframe), así que van directo acá, no como secreto de servidor.
const METAPERSON_CLIENT_ID = "OtlogpdqwetcQeZ9GPGAiSMGCpnlBq8cdvXPsGNz";
const METAPERSON_CLIENT_SECRET = "UD4Z4i03tLOSatjTBfzGFTl90YtkyQE04lxsfscXjTkWXRlgDY1dnqwsAn2D42WI8dZDfAXrwJeA7T3gyqY0K1w7QxbDYfN1r1ctDaibLz0hBJqpNY1hCDztiJMqKfpP";
const METAPERSON_URL = "https://metaperson.avatarsdk.com/iframe.html";

export default function AvatarPage() {
  const { user, profile } = useAuth();
  const [avatar3dUrl, setAvatar3dUrl] = useState<string | null>(profile?.avatar_3d_url ?? null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [preview, setPreview] = useState<string | null>(profile?.avatar_url ?? null);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);

  useEffect(() => {
    function authenticateAndConfigure() {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      target.postMessage({ eventName: "authenticate", clientId: METAPERSON_CLIENT_ID, clientSecret: METAPERSON_CLIENT_SECRET }, "*");
      target.postMessage({ eventName: "set_export_parameters", format: "glb", lod: 1, textureProfile: "2K.png", useZip: false }, "*");
      target.postMessage({ eventName: "set_ui_parameters", isExportButtonVisible: true, closeExportDialogWhenExportComlpeted: true }, "*");
    }
    function onMessage(event: MessageEvent) {
      const data = event.data;
      if (!data || data.source !== "metaperson_creator") return;
      const evtName = data.eventName;
      if (evtName === "metaperson_creator_loaded") {
        authenticateAndConfigure();
      }
      if (evtName === "model_exported") {
        const url = data.url as string | undefined;
        if (url) {
          setAvatar3dUrl(url);
          setCreating(false);
        }
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const saveAvatar = async () => {
    if (!user || !avatar3dUrl) return;
    setSaving(true);
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("profiles").update({ avatar_3d_url: avatar3dUrl }).eq("id", user.id);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const uploadPhoto = async (file: File) => {
    if (!user) return;
    setUploadingPhoto(true);
    const { supabase } = await import("@/lib/supabase");
    const ext = file.name.split(".").pop() ?? "png";
    const path = `${user.id}/${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (!error) {
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = data.publicUrl;
      await supabase.from("profiles").update({ avatar_url: url }).eq("id", user.id);
      setPreview(url);
    }
    setUploadingPhoto(false);
  };

  const fallback = (profile?.full_name ?? profile?.display_name ?? user?.email ?? "U").charAt(0).toUpperCase();

  return (
    <div className="space-y-5">
      <section className="panel rounded-3xl border border-white/10 p-5">
        <h1 className="text-2xl font-semibold">Avatar 3D</h1>
        <p className="text-sm text-white/70">Creá tu avatar 3D de Clouva. Se genera desde una foto o eligiendo estilo, y queda listo para tu perfil.</p>
      </section>

      <section className="panel rounded-3xl border border-[#8f7cff]/20 p-5">
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
          <div className="w-full max-w-xs sm:max-w-[260px]">
            {avatar3dUrl ? (
              <model-viewer
                src={avatar3dUrl}
                alt="Tu avatar 3D de Clouva"
                camera-controls
                auto-rotate
                shadow-intensity="1"
                style={{ width: "100%", height: "260px", background: "transparent", borderRadius: "1rem" }}
              />
            ) : (
              <div className="grid h-[260px] w-full place-items-center rounded-2xl border border-dashed border-white/20 text-center text-sm text-white/50">
                Todavía no creaste tu avatar 3D
              </div>
            )}
          </div>
          <div className="flex-1 space-y-3">
            <button
              onClick={() => setCreating((v) => !v)}
              className="rounded-full bg-[#8f7cff] px-4 py-2 text-sm font-medium text-black"
            >
              {avatar3dUrl ? "Editar avatar 3D" : "Crear avatar 3D"}
            </button>
            {avatar3dUrl ? (
              <button onClick={saveAvatar} disabled={saving} className="ml-2 rounded-full border border-white/20 px-4 py-2 text-sm">
                {saving ? "Guardando..." : "Guardar en mi perfil"}
              </button>
            ) : null}
            {saved ? <p className="text-sm text-emerald-300">Avatar guardado en tu perfil.</p> : null}
            <p className="text-xs text-white/50">
              El creador es de MetaPerson (Avatar SDK). Sacate una foto o elegí un estilo, personalizá, y tocá el botón de exportar —
              el avatar se va a cargar automáticamente acá.
            </p>
          </div>
        </div>

        {creating ? (
          <div className="mt-5 overflow-hidden rounded-2xl border border-white/10">
            <iframe ref={iframeRef} src={METAPERSON_URL} allow="camera *; microphone *; fullscreen" className="h-[560px] w-full" style={{ border: "none" }} />
          </div>
        ) : null}
      </section>

      <section className="panel rounded-3xl p-5">
        <h2 className="mb-1 text-lg font-semibold">Foto de perfil (2D)</h2>
        <p className="mb-4 text-sm text-white/60">Además del avatar 3D, esta es la imagen chica que se ve en el menú y en tu perfil público.</p>
        <div className="flex items-center gap-4">
          {preview ? (
            <img src={preview} className="h-20 w-20 rounded-full border border-white/20 object-cover" alt="avatar" />
          ) : (
            <div className="grid h-20 w-20 place-items-center rounded-full border border-white/20 bg-[#8f7cff]/25 text-xl">{fallback}</div>
          )}
          <label className="rounded-full border border-[#8f7cff]/40 px-4 py-2 text-sm">
            {uploadingPhoto ? "Guardando..." : "Subir imagen"}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) {
                  setPreview(URL.createObjectURL(f));
                  void uploadPhoto(f);
                }
              }}
            />
          </label>
        </div>
      </section>
    </div>
  );
}

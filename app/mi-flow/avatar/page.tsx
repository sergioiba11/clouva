"use client";

import { useAuth } from "@/components/auth-provider";
import { useState } from "react";

export default function AvatarPage() {
  const { user, profile } = useAuth();
  const [preview, setPreview] = useState<string | null>(profile?.avatar_url ?? null);
  const [saving, setSaving] = useState(false);

  const upload = async (file: File) => {
    if (!user) return;
    setSaving(true);
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
    setSaving(false);
  };

  const fallback = (profile?.full_name ?? profile?.display_name ?? user?.email ?? "U").charAt(0).toUpperCase();

  return <section className="panel rounded-3xl p-6">
    <h1 className="text-2xl font-semibold">Avatar System</h1>
    <p className="text-white/70">Subí y administrá tu imagen de identidad CLOUVA.</p>
    <div className="mt-4 flex items-center gap-4">
      {preview ? <img src={preview} className="h-24 w-24 rounded-full border border-white/20 object-cover" alt="avatar" /> : <div className="grid h-24 w-24 place-items-center rounded-full border border-white/20 bg-[#8f7cff]/25 text-2xl">{fallback}</div>}
      <label className="rounded-full border border-[#8f7cff]/40 px-4 py-2 text-sm">
        {saving ? "Guardando..." : "Subir imagen"}
        <input type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) { setPreview(URL.createObjectURL(f)); void upload(f); } }} />
      </label>
    </div>
  </section>;
}

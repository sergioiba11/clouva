"use client";
import { useState } from "react";
import type { SocialLink, Studio, StudioMember } from "@/lib/community-data";

type StudioAdminPanelProps = {
  studio: Studio;
  members: StudioMember[];
  onChange: () => void;
};

const SOCIAL_PLATFORMS: SocialLink["platform"][] = ["instagram", "tiktok", "youtube", "discord", "x", "website"];

export function StudioAdminPanel({ studio, members, onChange }: StudioAdminPanelProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [logoUrl, setLogoUrl] = useState(studio.logo_url ?? "");
  const [coverUrl, setCoverUrl] = useState(studio.cover_url ?? "");
  const [description, setDescription] = useState(studio.description ?? "");
  const [city, setCity] = useState(studio.city ?? "");
  const [country, setCountry] = useState(studio.country ?? "");
  const [foundedYear, setFoundedYear] = useState(studio.founded_year?.toString() ?? "");
  const [websiteUrl, setWebsiteUrl] = useState(studio.website_url ?? "");
  const [socialLinks, setSocialLinks] = useState<SocialLink[]>(
    Array.isArray(studio.social_links) ? studio.social_links : [],
  );
  const [newSocialPlatform, setNewSocialPlatform] = useState<SocialLink["platform"]>("instagram");
  const [newSocialUrl, setNewSocialUrl] = useState("");

  const [newMemberUsername, setNewMemberUsername] = useState("");
  const [newMemberRole, setNewMemberRole] = useState("member");

  const [newProjectTitle, setNewProjectTitle] = useState("");
  const [newProjectSpotify, setNewProjectSpotify] = useState("");

  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventDate, setNewEventDate] = useState("");
  const [newEventCity, setNewEventCity] = useState("");

  const saveDetails = async () => {
    setSaving(true);
    setError("");
    const { supabase } = await import("@/lib/supabase");
    const { error: err } = await supabase
      .from("studios")
      .update({
        logo_url: logoUrl || null,
        cover_url: coverUrl || null,
        description: description || null,
        city: city || null,
        country: country || null,
        founded_year: foundedYear ? Number(foundedYear) : null,
        website_url: websiteUrl || null,
        social_links: socialLinks,
        updated_at: new Date().toISOString(),
      })
      .eq("id", studio.id);
    setSaving(false);
    if (err) {
      setError(err.message);
      return;
    }
    onChange();
  };

  const addSocialLink = () => {
    if (!newSocialUrl.trim()) return;
    setSocialLinks((prev) => [...prev, { platform: newSocialPlatform, url: newSocialUrl.trim() }]);
    setNewSocialUrl("");
  };

  const removeSocialLink = (index: number) => {
    setSocialLinks((prev) => prev.filter((_, i) => i !== index));
  };

  const addMember = async () => {
    if (!newMemberUsername.trim()) return;
    setError("");
    const { supabase } = await import("@/lib/supabase");
    const { data: profile, error: lookupError } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", newMemberUsername.trim())
      .maybeSingle();
    if (lookupError || !profile) {
      setError(`No encontramos un usuario con username "${newMemberUsername}"`);
      return;
    }
    const { error: insertError } = await supabase
      .from("studio_members")
      .upsert(
        { studio_id: studio.id, profile_id: profile.id, role: newMemberRole, status: "active" },
        { onConflict: "studio_id,profile_id" },
      );
    if (insertError) {
      setError(insertError.message);
      return;
    }
    setNewMemberUsername("");
    onChange();
  };

  const removeMember = async (memberId: string) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("studio_members").delete().eq("id", memberId);
    onChange();
  };

  const changeMemberRole = async (memberId: string, role: string) => {
    const { supabase } = await import("@/lib/supabase");
    await supabase.from("studio_members").update({ role }).eq("id", memberId);
    onChange();
  };

  const addProject = async () => {
    if (!newProjectTitle.trim()) return;
    const { supabase } = await import("@/lib/supabase");
    const { error: err } = await supabase.from("community_projects").insert({
      studio_id: studio.id,
      title: newProjectTitle.trim(),
      spotify_url: newProjectSpotify.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setNewProjectTitle("");
    setNewProjectSpotify("");
    onChange();
  };

  const addEvent = async () => {
    if (!newEventTitle.trim() || !newEventDate) return;
    const { supabase } = await import("@/lib/supabase");
    const { error: err } = await supabase.from("community_events").insert({
      studio_id: studio.id,
      title: newEventTitle.trim(),
      starts_at: new Date(newEventDate).toISOString(),
      city: newEventCity.trim() || null,
    });
    if (err) {
      setError(err.message);
      return;
    }
    setNewEventTitle("");
    setNewEventDate("");
    setNewEventCity("");
    onChange();
  };

  return (
    <div className="panel rounded-3xl p-5">
      <button onClick={() => setOpen((v) => !v)} className="text-sm font-medium text-[#8f7cff]">
        {open ? "Cerrar administración" : "Administrar estudio"}
      </button>
      {!open ? null : (
        <div className="mt-5 space-y-6">
          {error ? <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-300">{error}</p> : null}

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.15em] text-white/45">Detalles</p>
            <input placeholder="URL del logo" value={logoUrl} onChange={(e) => setLogoUrl(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm" />
            <input placeholder="URL de la portada" value={coverUrl} onChange={(e) => setCoverUrl(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm" />
            <textarea placeholder="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} className="w-full rounded-xl bg-white/10 px-4 py-2 text-sm" rows={3} />
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Ciudad" value={city} onChange={(e) => setCity(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <input placeholder="País" value={country} onChange={(e) => setCountry(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <input placeholder="Año de creación" value={foundedYear} onChange={(e) => setFoundedYear(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <input placeholder="Sitio web" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              {socialLinks.map((link, i) => (
                <span key={`${link.platform}-${i}`} className="flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-xs">
                  {link.platform}: {link.url}
                  <button onClick={() => removeSocialLink(i)} className="text-white/50">×</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <select value={newSocialPlatform} onChange={(e) => setNewSocialPlatform(e.target.value as SocialLink["platform"])} className="rounded-xl bg-black px-3 py-2 text-sm">
                {SOCIAL_PLATFORMS.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <input placeholder="URL" value={newSocialUrl} onChange={(e) => setNewSocialUrl(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <button onClick={addSocialLink} className="rounded-xl border border-white/20 px-3 py-2 text-sm">Agregar</button>
            </div>

            <button onClick={saveDetails} disabled={saving} className="rounded-full bg-[#8f7cff] px-5 py-2 text-sm font-medium text-black">
              {saving ? "Guardando..." : "Guardar detalles"}
            </button>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.15em] text-white/45">Integrantes</p>
            {members.map((member) => (
              <div key={member.id} className="flex items-center justify-between gap-2 rounded-xl bg-white/5 px-3 py-2 text-sm">
                <span>@{member.profiles?.username ?? member.profile_id}</span>
                <div className="flex items-center gap-2">
                  <select value={member.role} onChange={(e) => changeMemberRole(member.id, e.target.value)} className="rounded-lg bg-black px-2 py-1 text-xs">
                    <option value="member">member</option>
                    <option value="artist">artist</option>
                    <option value="producer">producer</option>
                    <option value="manager">manager</option>
                    <option value="admin">admin</option>
                  </select>
                  <button onClick={() => removeMember(member.id)} className="text-xs text-red-300">Eliminar</button>
                </div>
              </div>
            ))}
            <div className="flex gap-2">
              <input placeholder="username" value={newMemberUsername} onChange={(e) => setNewMemberUsername(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <select value={newMemberRole} onChange={(e) => setNewMemberRole(e.target.value)} className="rounded-xl bg-black px-3 py-2 text-sm">
                <option value="member">member</option>
                <option value="artist">artist</option>
                <option value="producer">producer</option>
                <option value="manager">manager</option>
                <option value="admin">admin</option>
              </select>
              <button onClick={addMember} className="rounded-xl border border-white/20 px-3 py-2 text-sm">Agregar</button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.15em] text-white/45">Agregar proyecto</p>
            <div className="flex gap-2">
              <input placeholder="Título" value={newProjectTitle} onChange={(e) => setNewProjectTitle(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <input placeholder="Link de Spotify (opcional)" value={newProjectSpotify} onChange={(e) => setNewProjectSpotify(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <button onClick={addProject} className="rounded-xl border border-white/20 px-3 py-2 text-sm">Agregar</button>
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs uppercase tracking-[0.15em] text-white/45">Agregar evento</p>
            <div className="flex flex-wrap gap-2">
              <input placeholder="Título" value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} className="flex-1 rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <input type="datetime-local" value={newEventDate} onChange={(e) => setNewEventDate(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <input placeholder="Ciudad" value={newEventCity} onChange={(e) => setNewEventCity(e.target.value)} className="rounded-xl bg-white/10 px-4 py-2 text-sm" />
              <button onClick={addEvent} className="rounded-xl border border-white/20 px-3 py-2 text-sm">Agregar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

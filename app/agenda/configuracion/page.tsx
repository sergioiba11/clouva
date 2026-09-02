"use client";

import Link from "next/link";
import { ExternalLink, Loader2, Save, Settings2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Context = {
  agendaId: string;
  ownerPlayerId: string | null;
  ownerSpaceId: string | null;
  timezone: string;
  publicEnabled: boolean;
  bookingEnabled: boolean;
  role: "owner" | "editor" | "participant" | "viewer";
  presentation: {
    identityType: "player" | "studio" | "business_space";
    displayName: string;
    alias: string | null;
    avatar: string | null;
  };
};

function publicHref(context: Context | null) {
  if (!context?.presentation.alias) return null;
  if (context.presentation.identityType === "player") return `/${context.presentation.alias}/agenda`;
  if (context.presentation.identityType === "studio") return `/studios/${context.presentation.alias}/agenda`;
  return null;
}

export default function AgendaSettingsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [contexts, setContexts] = useState<Context[]>([]);
  const [agendaId, setAgendaId] = useState("");
  const [form, setForm] = useState({ timezone: "America/Argentina/Buenos_Aires", visibility: "connections", publicEnabled: false, bookingEnabled: false });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const editable = useMemo(() => contexts.filter((context) => context.role === "owner" || context.role === "editor"), [contexts]);
  const active = useMemo(() => contexts.find((context) => context.agendaId === agendaId) || null, [agendaId, contexts]);
  const href = publicHref(active);

  function applyContext(context: Context | undefined) {
    if (!context) return;
    setAgendaId(context.agendaId);
    setForm({
      timezone: context.timezone || "America/Argentina/Buenos_Aires",
      visibility: context.publicEnabled ? "public" : "connections",
      publicEnabled: context.publicEnabled,
      bookingEnabled: context.bookingEnabled,
    });
  }

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/agenda/configuracion");
      return;
    }
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/agenda/contexts");
        const payload = await readApiJson<{ contexts: Context[] }>(response);
        setContexts(payload.contexts || []);
        applyContext((payload.contexts || []).find((context) => context.role === "owner" || context.role === "editor"));
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "No se pudo cargar la configuración.");
      } finally { setLoading(false); }
    })();
  }, [authLoading, router, user]);

  async function save() {
    if (!agendaId) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/agenda/settings", {
        method: "PATCH",
        body: JSON.stringify({
          agendaId,
          timezone: form.timezone,
          visibility: form.publicEnabled ? "public" : form.visibility,
          publicEnabled: form.publicEnabled,
          bookingEnabled: form.bookingEnabled,
        }),
      });
      await readApiJson(response);
      const contextsResponse = await authenticatedFetch("/api/agenda/contexts");
      const payload = await readApiJson<{ contexts: Context[] }>(contextsResponse);
      setContexts(payload.contexts || []);
      const refreshed = (payload.contexts || []).find((context) => context.agendaId === agendaId);
      if (refreshed) applyContext(refreshed);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo guardar la configuración.");
    } finally { setSaving(false); }
  }

  if (authLoading || loading) return <main className="grid min-h-screen place-items-center bg-[#08080d] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;

  return (
    <main className="min-h-screen bg-[#08080d] px-4 pb-28 pt-8 text-white sm:px-6 md:pb-10">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-2xl border border-violet-300/15 bg-violet-300/10 text-violet-200"><Settings2 size={20} /></span><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/35">AGENDA CLOUVA</p><h1 className="text-2xl font-semibold">Configuración</h1></div></div>
        <p className="mt-3 text-sm leading-6 text-white/45">La Agenda no guarda una copia de tu branding. Estas opciones controlan scheduling y publicación; la apariencia siempre viene de la identidad Player, Studio o Space.</p>

        {error ? <div className="mt-5 flex justify-between gap-3 rounded-2xl border border-red-300/15 bg-red-300/[0.07] p-4 text-sm text-red-100"><span>{error}</span><button onClick={() => setError(null)}><X size={15} /></button></div> : null}

        <section className="mt-7 rounded-3xl border border-white/10 bg-white/[0.025] p-5 sm:p-6">
          <label className="block"><span className="mb-2 block text-xs font-semibold text-white/45">Identidad / Agenda</span><select value={agendaId} onChange={(event) => applyContext(editable.find((context) => context.agendaId === event.target.value))} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-3 text-sm outline-none">{editable.map((context) => <option key={context.agendaId} value={context.agendaId}>{context.presentation.displayName} · {context.presentation.identityType}</option>)}</select></label>

          {active ? <div className="mt-4 flex items-center gap-3 rounded-2xl border border-white/8 bg-black/20 p-3">{active.presentation.avatar ? <img src={active.presentation.avatar} alt="" className="h-11 w-11 rounded-full object-cover" /> : <span className="grid h-11 w-11 place-items-center rounded-full bg-violet-300/10 text-sm font-bold">{active.presentation.displayName.slice(0, 1)}</span>}<div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{active.presentation.displayName}</p><p className="text-[11px] text-white/35">{active.role} · {active.presentation.identityType}</p></div>{href && active.publicEnabled ? <Link href={href} target="_blank" className="inline-flex items-center gap-1.5 text-xs text-violet-200">Ver pública <ExternalLink size={12} /></Link> : null}</div> : null}

          <div className="mt-6 grid gap-4 sm:grid-cols-2">
            <label><span className="mb-2 block text-xs font-semibold text-white/45">Timezone IANA</span><input value={form.timezone} onChange={(event) => setForm((current) => ({ ...current, timezone: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-3 text-sm outline-none focus:border-violet-300/40" /></label>
            <label><span className="mb-2 block text-xs font-semibold text-white/45">Visibilidad privada</span><select value={form.visibility} disabled={form.publicEnabled} onChange={(event) => setForm((current) => ({ ...current, visibility: event.target.value }))} className="w-full rounded-xl border border-white/10 bg-[#111119] px-3 py-3 text-sm outline-none disabled:opacity-40"><option value="private">Privada</option><option value="connections">Conexiones</option></select></label>
          </div>

          <div className="mt-6 grid gap-3">
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"><div><p className="text-sm font-semibold">Agenda pública</p><p className="mt-1 text-xs leading-5 text-white/38">Muestra únicamente eventos marcados como públicos desde la identidad actual.</p></div><input type="checkbox" checked={form.publicEnabled} onChange={(event) => setForm((current) => ({ ...current, publicEnabled: event.target.checked }))} className="h-5 w-5 accent-violet-500" /></label>
            <label className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"><div><p className="text-sm font-semibold">Booking / reservas</p><p className="mt-1 text-xs leading-5 text-white/38">Permite que el dominio Booking use disponibilidad y bloqueos de esta Agenda.</p></div><input type="checkbox" checked={form.bookingEnabled} onChange={(event) => setForm((current) => ({ ...current, bookingEnabled: event.target.checked }))} className="h-5 w-5 accent-violet-500" /></label>
          </div>

          {active?.presentation.identityType === "business_space" && form.publicEnabled ? <p className="mt-4 rounded-xl border border-amber-300/15 bg-amber-300/[0.06] p-3 text-xs leading-5 text-amber-100/70">El Space puede tener Agenda pública habilitada, pero CLOUVA todavía no tiene un renderer público canónico para Business. No se inventa una URL paralela: aparecerá cuando ese renderer exista.</p> : null}

          <button type="button" onClick={() => void save()} disabled={saving || !agendaId} className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-40">{saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}{saved ? "Guardado" : saving ? "Guardando…" : "Guardar configuración"}</button>
        </section>
      </div>
    </main>
  );
}

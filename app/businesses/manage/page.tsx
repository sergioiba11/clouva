"use client";

import { CheckCircle2, Loader2, Search, Settings2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { OnboardingShell } from "@/components/onboarding/OnboardingShell";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Space = {
  id: string;
  slug: string;
  name: string;
  type: string;
  business_kind: string | null;
  category: string | null;
  subcategory: string | null;
  location_label: string | null;
  description: string | null;
  logo_url: string | null;
  membership: { role: string; status: string } | null;
  pendingRequest: { id: string; requested_role: string; status: string } | null;
};

const ROLES = [
  { id: "partner", label: "Socio" },
  { id: "manager", label: "Manager" },
  { id: "admin", label: "Administrador" },
  { id: "team", label: "Integrante del equipo" },
] as const;

function kindLabel(space: Space) {
  if (space.business_kind === "digital_business") return "Negocio digital";
  if (space.business_kind === "physical_business") return "Negocio físico";
  if (space.business_kind === "studio" || space.type === "studio") return "Estudio";
  return space.type === "business" ? "Negocio" : "Espacio";
}

export default function ManageBusinessPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [query, setQuery] = useState("");
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [selected, setSelected] = useState<Space | null>(null);
  const [requestedRole, setRequestedRole] = useState<(typeof ROLES)[number]["id"]>("manager");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const search = useCallback(async (value: string) => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/spaces/search?q=${encodeURIComponent(value.trim())}`);
      const payload = await readApiJson<{ spaces: Space[] }>(response);
      setSpaces(payload.spaces ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar los negocios.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.replace("/login?next=/businesses/manage");
      return;
    }
    void search("");
  }, [authLoading, router, search, user]);

  async function submit() {
    if (!selected) return;
    setSending(true);
    setError(null);
    try {
      const response = await authenticatedFetch(`/api/spaces/${encodeURIComponent(selected.id)}/management-requests`, {
        method: "POST",
        body: JSON.stringify({ requestedRole, message }),
      });
      await readApiJson(response);
      setSubmitted(true);
      window.setTimeout(() => router.replace("/"), 900);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar la solicitud.");
      setSending(false);
    }
  }

  if (submitted) {
    return (
      <OnboardingShell step={3} title="Solicitud enviada" description="Te avisaremos cuando el negocio responda.">
        <div className="flex flex-col items-center py-6 text-center">
          <span className="grid h-16 w-16 place-items-center rounded-full border border-emerald-300/20 bg-emerald-300/10 text-emerald-300"><CheckCircle2 size={28} /></span>
          <p className="mt-4 text-sm text-white/45">Volviendo a tu Home como Player…</p>
        </div>
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell
      step={3}
      title={selected ? "Solicitar administración" : "Administrar un negocio"}
      description={selected
        ? "Elegí la relación que querés tener con este espacio. El acceso sólo se activa si un dueño o administrador aprueba la solicitud."
        : "Buscá un negocio o espacio existente. La solicitud queda pendiente y no te da permisos mientras espera respuesta."}
    >
      {!selected ? (
        <div>
          <div className="flex gap-2">
            <div className="flex min-w-0 flex-1 items-center rounded-2xl border border-white/10 bg-black/25 px-4 focus-within:border-violet-400/50">
              <Search size={16} className="shrink-0 text-white/30" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(query); }} placeholder="Nombre, categoría, ciudad…" className="min-w-0 flex-1 bg-transparent px-2 py-3 text-sm outline-none placeholder:text-white/25" />
            </div>
            <button type="button" onClick={() => void search(query)} className="rounded-2xl border border-violet-400/25 bg-violet-500/10 px-4 text-sm font-medium text-violet-100">Buscar</button>
          </div>

          {error ? <p className="mt-4 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
          {loading ? <p className="mt-6 flex items-center gap-2 text-sm text-white/40"><Loader2 size={15} className="animate-spin" /> Cargando espacios…</p> : null}
          {!loading && !spaces.length ? <p className="mt-6 text-sm text-white/40">No encontramos espacios públicos con esa búsqueda.</p> : null}

          <div className="mt-5 grid gap-3">
            {spaces.map((space) => {
              const unavailable = Boolean(space.membership || space.pendingRequest);
              return (
                <button key={space.id} type="button" disabled={unavailable} onClick={() => setSelected(space)} className="flex items-start gap-4 rounded-2xl border border-white/10 bg-white/[0.025] p-4 text-left transition hover:border-violet-400/45 hover:bg-violet-500/[0.08] disabled:cursor-default disabled:opacity-45">
                  <span className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-xl border border-white/10 bg-white/[0.04] text-violet-200">{space.logo_url ? <img src={space.logo_url} alt="" className="h-full w-full object-cover" /> : <Settings2 size={19} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{space.name}</span>
                    <span className="mt-1 block text-xs text-white/42">{kindLabel(space)}{space.category ? ` · ${space.category}` : ""}{space.location_label ? ` · ${space.location_label}` : ""}</span>
                    {space.pendingRequest ? <span className="mt-2 block text-[11px] font-medium text-amber-200/70">Solicitud pendiente</span> : null}
                    {space.membership ? <span className="mt-2 block text-[11px] font-medium text-emerald-200/70">Ya formás parte del equipo · {space.membership.role}</span> : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <button type="button" onClick={() => setSelected(null)} className="text-xs font-medium text-violet-200/70 hover:text-violet-100">← Elegir otro espacio</button>
          <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4"><p className="font-semibold">{selected.name}</p><p className="mt-1 text-xs text-white/40">{kindLabel(selected)}{selected.category ? ` · ${selected.category}` : ""}</p></div>

          <div><span className="mb-2 block text-xs font-medium text-white/55">Relación / rol solicitado</span><div className="grid gap-2 sm:grid-cols-2">{ROLES.map((role) => <button key={role.id} type="button" onClick={() => setRequestedRole(role.id)} className={`rounded-xl border px-3 py-3 text-left text-sm transition ${requestedRole === role.id ? "border-violet-400/55 bg-violet-500/15 text-violet-100" : "border-white/10 bg-white/[0.02] text-white/55 hover:text-white"}`}>{role.label}</button>)}</div></div>
          <label className="block"><span className="mb-2 block text-xs font-medium text-white/55">Mensaje</span><textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={2000} rows={5} placeholder="Contales quién sos y qué rol querés asumir dentro del negocio." className="w-full rounded-2xl border border-white/10 bg-black/25 px-4 py-3 text-sm text-white outline-none placeholder:text-white/25 focus:border-violet-400/50" /></label>

          {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
          <button type="button" onClick={() => void submit()} disabled={sending} className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-violet-600 px-5 py-3.5 text-sm font-semibold transition hover:bg-violet-500 disabled:opacity-45">{sending ? <Loader2 size={17} className="animate-spin" /> : null}{sending ? "Enviando…" : "Enviar solicitud"}</button>
        </div>
      )}
    </OnboardingShell>
  );
}

"use client";

import Link from "next/link";
import { ArrowLeft, BookOpen, Loader2, MoonStar, Save, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";
import { calculateNumerologyNumber, zodiacSignFromBirthDate, type PlayerKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

type Payload = {
  player: { id: string; slug: string; display_name: string };
  profile: PlayerKnowledgeProfile | null;
  derived: { numerologyNumber: number | null; zodiacSign: string | null };
};

const EMPTY: Omit<PlayerKnowledgeProfile, "player_id"> = {
  birth_date: null,
  show_lunar: false,
  show_numerology: false,
  show_zodiac: false,
  knowledge_topics: [],
  teach_topics: [],
};

function parseTopics(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function zodiacSymbol(sign: string | null) {
  const symbols: Record<string, string> = {
    Aries: "♈", Tauro: "♉", Géminis: "♊", Cáncer: "♋", Leo: "♌", Virgo: "♍",
    Libra: "♎", Escorpio: "♏", Sagitario: "♐", Capricornio: "♑", Acuario: "♒", Piscis: "♓",
  };
  return sign ? symbols[sign] || "✦" : "✦";
}

export default function PlayerKnowledgePage() {
  const { user, loading: authLoading } = useAuth();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [draft, setDraft] = useState(EMPTY);
  const [knowledgeText, setKnowledgeText] = useState("");
  const [teachText, setTeachText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      window.location.assign("/login");
      return;
    }
    void (async () => {
      try {
        const response = await authenticatedFetch("/api/knowledge/me");
        const data = await readApiJson<Payload>(response);
        setPayload(data);
        const profile = data.profile ? { ...data.profile } : { ...EMPTY, player_id: data.player.id };
        setDraft(profile);
        setKnowledgeText(profile.knowledge_topics.join(", "));
        setTeachText(profile.teach_topics.join(", "));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "No se pudo cargar Conocimiento.");
      } finally {
        setLoading(false);
      }
    })();
  }, [authLoading, user]);

  const derivedPreview = useMemo(() => ({
    number: calculateNumerologyNumber(draft.birth_date),
    sign: zodiacSignFromBirthDate(draft.birth_date),
  }), [draft.birth_date]);

  const save = async () => {
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/knowledge/me", {
        method: "PATCH",
        body: JSON.stringify({
          ...draft,
          knowledge_topics: parseTopics(knowledgeText),
          teach_topics: parseTopics(teachText),
        }),
      });
      const data = await readApiJson<Payload>(response);
      setPayload(data);
      if (data.profile) setDraft(data.profile);
      setKnowledgeText(data.profile?.knowledge_topics.join(", ") || "");
      setTeachText(data.profile?.teach_topics.join(", ") || "");
      setMessage("Conocimiento actualizado.");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se pudo guardar.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <main className="grid min-h-screen place-items-center bg-[#05040a] text-white"><Loader2 className="animate-spin text-violet-300" /></main>;

  return (
    <main className="min-h-screen bg-[#05040a] px-4 py-6 text-white sm:px-6">
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-3">
          <Link href={payload ? `/${payload.player.slug}` : "/profile/edit"} className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-white"><ArrowLeft size={16} /> Volver</Link>
          <button type="button" onClick={() => void save()} disabled={saving} className="inline-flex items-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold disabled:opacity-50">{saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Guardar</button>
        </div>

        <section className="overflow-hidden rounded-[2rem] border border-violet-300/15 bg-[radial-gradient(circle_at_80%_5%,rgba(139,92,246,.18),transparent_34%),#0b0913] p-5 sm:p-7">
          <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-violet-300/75">PLAYER · CONOCIMIENTO</p>
          <h1 className="mt-2 text-3xl font-black tracking-tight">Lo que sé y puedo enseñar</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/50">Elegí qué conocimientos forman parte de tu identidad pública. La fecha queda privada; CLOUVA publica solamente los datos derivados que actives.</p>

          <div className="mt-7 grid gap-3 sm:grid-cols-3">
            <ToggleCard active={draft.show_lunar} onClick={() => setDraft((current) => ({ ...current, show_lunar: !current.show_lunar }))} title="Lunar" subtitle="Fase y data de la Luna" icon={<MoonStar size={20} />} value="Luna" />
            <ToggleCard active={draft.show_numerology} onClick={() => setDraft((current) => ({ ...current, show_numerology: !current.show_numerology }))} title="Numerología" subtitle="Número por fecha" icon={<Sparkles size={20} />} value={derivedPreview.number ? String(derivedPreview.number) : "—"} />
            <ToggleCard active={draft.show_zodiac} onClick={() => setDraft((current) => ({ ...current, show_zodiac: !current.show_zodiac }))} title="Astrología" subtitle="Signo zodiacal" icon={<span className="text-lg">{zodiacSymbol(derivedPreview.sign)}</span>} value={derivedPreview.sign || "—"} />
          </div>

          <div className="mt-7 grid gap-5 sm:grid-cols-2">
            <label className="block">
              <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.18em] text-white/40">Fecha de nacimiento · privada</span>
              <input type="date" value={draft.birth_date || ""} onChange={(event) => setDraft((current) => ({ ...current, birth_date: event.target.value || null }))} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/50" />
            </label>
            <div className="rounded-2xl border border-white/10 bg-white/[0.025] p-4">
              <p className="text-xs uppercase tracking-[0.18em] text-white/35">Vista pública</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {draft.show_lunar ? <Badge>Luna</Badge> : null}
                {draft.show_numerology && derivedPreview.number ? <Badge>Número {derivedPreview.number}</Badge> : null}
                {draft.show_zodiac && derivedPreview.sign ? <Badge>{zodiacSymbol(derivedPreview.sign)} {derivedPreview.sign}</Badge> : null}
              </div>
            </div>
          </div>

          <div className="mt-7 space-y-5 border-t border-white/10 pt-6">
            <label className="block">
              <span className="mb-2 flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} className="text-violet-300" /> Áreas de conocimiento</span>
              <input value={knowledgeText} onChange={(event) => setKnowledgeText(event.target.value)} placeholder="Ej: Lunar, Numerología, Astronomía, Producción musical" className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/50" />
              <small className="mt-2 block text-white/35">Separalas con comas.</small>
            </label>
            <label className="block">
              <span className="mb-2 block text-sm font-semibold">Lo que enseño</span>
              <input value={teachText} onChange={(event) => setTeachText(event.target.value)} placeholder="Ej: Numerología, Astronomía" className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 text-sm outline-none focus:border-violet-400/50" />
            </label>
          </div>

          {message ? <p className="mt-5 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{message}</p> : null}
          {error ? <p className="mt-5 rounded-xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</p> : null}
        </section>
      </div>
    </main>
  );
}

function ToggleCard({ active, onClick, title, subtitle, value, icon }: { active: boolean; onClick: () => void; title: string; subtitle: string; value: string; icon: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-2xl border p-4 text-left transition ${active ? "border-violet-400/45 bg-violet-500/12" : "border-white/10 bg-white/[0.025]"}`}><div className="flex items-center justify-between"><span className={active ? "text-violet-200" : "text-white/45"}>{icon}</span><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${active ? "bg-violet-500/20 text-violet-200" : "bg-white/5 text-white/30"}`}>{active ? "VISIBLE" : "OCULTO"}</span></div><strong className="mt-4 block text-lg">{title}</strong><span className="mt-1 block text-xs text-white/40">{subtitle}</span><span className="mt-4 block text-2xl font-black text-violet-200">{value}</span></button>;
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="rounded-full border border-violet-400/25 bg-violet-500/10 px-3 py-1.5 text-xs font-semibold text-violet-200">{children}</span>;
}

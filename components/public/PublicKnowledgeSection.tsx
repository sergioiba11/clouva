import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { ArrowRight, BookOpen, MoonStar, Sparkles } from "lucide-react";
import type { PublicKnowledgeProfile } from "@/lib/knowledge/player-knowledge";

function zodiacSymbol(sign: string) {
  const symbols: Record<string, string> = {
    Aries: "♈", Tauro: "♉", Géminis: "♊", Cáncer: "♋", Leo: "♌", Virgo: "♍",
    Libra: "♎", Escorpio: "♏", Sagitario: "♐", Capricornio: "♑", Acuario: "♒", Piscis: "♓",
  };
  return symbols[sign] || "✦";
}

export function PublicKnowledgeSection({
  playerName,
  alias,
  accent,
  knowledge,
}: {
  playerName: string;
  alias: string;
  accent: string;
  knowledge: PublicKnowledgeProfile;
}) {
  const teach = new Set(knowledge.teachTopics.map((item) => item.toLocaleLowerCase("es")));
  return (
    <section id="conocimiento" className="border-y border-white/10 bg-[#08070d]" style={{ "--knowledge-accent": accent } as CSSProperties}>
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.24em] text-[color:var(--knowledge-accent)]">CONOCIMIENTO</p>
            <h2 className="mt-2 text-2xl font-black tracking-tight sm:text-3xl">Aprendé de {playerName}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">Áreas que forman parte de la identidad de este Player y contenido que eligió compartir o enseñar.</p>
          </div>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {knowledge.showLunar ? (
            <KnowledgeCard href={`/${alias}/knowledge/lunar`} eyebrow="LUNAR" title="Data de la Luna" value="Luna" icon={<MoonStar size={20} />} />
          ) : null}
          {knowledge.numerologyNumber !== null ? (
            <KnowledgeCard href={`/${alias}/knowledge/numerologia`} eyebrow="NUMEROLOGÍA" title="Número personal" value={String(knowledge.numerologyNumber)} icon={<Sparkles size={20} />} />
          ) : null}
          {knowledge.zodiacSign ? (
            <KnowledgeCard href={`/${alias}/knowledge/astrologia`} eyebrow="ASTROLOGÍA" title="Signo" value={knowledge.zodiacSign} icon={<span className="text-xl">{zodiacSymbol(knowledge.zodiacSign)}</span>} />
          ) : null}
        </div>

        {knowledge.knowledgeTopics.length ? (
          <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.025] p-4 sm:p-5">
            <div className="flex items-center gap-2 text-sm font-semibold"><BookOpen size={16} className="text-[color:var(--knowledge-accent)]" /> Áreas de conocimiento</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {knowledge.knowledgeTopics.map((topic) => (
                <span key={topic} className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/25 px-3 py-1.5 text-xs text-white/70">
                  {topic}
                  {teach.has(topic.toLocaleLowerCase("es")) ? <small className="rounded-full bg-[color:var(--knowledge-accent)]/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-[color:var(--knowledge-accent)]">enseña</small> : null}
                </span>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function KnowledgeCard({ href, eyebrow, title, value, icon }: { href: string; eyebrow: string; title: string; value: string; icon: ReactNode }) {
  return (
    <Link href={href} className="group rounded-2xl border border-white/10 bg-white/[0.025] p-5 transition hover:border-[color:var(--knowledge-accent)]/45 hover:bg-white/[0.04]">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-xl border border-[color:var(--knowledge-accent)]/20 bg-[color:var(--knowledge-accent)]/10 text-[color:var(--knowledge-accent)]">{icon}</span>
        <ArrowRight size={16} className="text-white/25 transition group-hover:translate-x-0.5 group-hover:text-[color:var(--knowledge-accent)]" />
      </div>
      <p className="mt-5 text-[9px] font-bold uppercase tracking-[0.22em] text-white/35">{eyebrow}</p>
      <p className="mt-1 text-sm text-white/55">{title}</p>
      <strong className="mt-2 block text-3xl font-black tracking-tight text-white">{value}</strong>
    </Link>
  );
}

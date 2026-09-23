"use client";

import { useState } from "react";
import { Mail, Send, CheckCircle2, TriangleAlert } from "lucide-react";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Lead = {
  company: string;
  to: string;
  subject: string;
  message: string;
};

const leads: Lead[] = [
  {
    company: "Spiral",
    to: "spiralmyanmar@gmail.com",
    subject: "Next.js / TypeScript Developer — Stakefair, Flare & SIV",
    message: `Hi Spiral team,

I saw your post looking for a Next.js frontend developer to build the admin panels for Stakefair, Flare, and SIV.

My name is Sergio Ibañez. I build and operate CLOUVA, a production web platform using Next.js App Router, React, TypeScript, Supabase, Google Cloud, OAuth, role-based permissions, dashboards, APIs, real-time features, and responsive interfaces.

I can take ownership of Next.js / TypeScript admin panels, REST and WebSocket integrations, authentication and RBAC, tables and dashboards, responsive UI, production deployment, and debugging incomplete product flows.

Current work: https://clouva.com.ar

I’m available to start immediately. Send me the current state of one of the products and the remaining deliverables, and I can propose the first milestone and delivery plan.

Best,
Sergio Ibañez`,
  },
  {
    company: "Proactive Minds",
    to: "jobs@proactive-minds.com",
    subject: "Application — Remote Full-Stack Developer",
    message: `Hello Proactive Minds team,

My name is Sergio Ibañez and I’m applying for the Remote Full-Stack Developer opportunity.

I build and maintain CLOUVA, a production platform with React, Next.js, TypeScript, Python APIs, PostgreSQL/Supabase, authentication, cloud deployment, AI integrations, automation, and real-time product features.

I can contribute across frontend, backend, databases, API integrations, debugging, deployment, and production support. My backend work is primarily Python API development and cloud integrations, and I’m comfortable adapting to Django / Django REST Framework where required.

Current project: https://clouva.com.ar

I’m based in Argentina, work remotely, and I’m available to start immediately. I’d be happy to complete a technical task or discuss your current product priorities.

Best regards,
Sergio Ibañez`,
  },
  {
    company: "Cloud9 Infotech",
    to: "info@infotechcloud9.com",
    subject: "Freelance AI / Data / Cloud Developer — Remote",
    message: `Hi Cloud9 Infotech team,

I saw your recent freelance hiring posts around AI-assisted querying, RAG, APIs, dashboards, automation, and cloud integrations.

My name is Sergio Ibañez. I build CLOUVA, a production platform using Next.js, TypeScript, Python services, PostgreSQL/Supabase, Google Cloud, AI integrations, automation workflows, structured data processing, dashboards, and production deployments.

My strongest areas are AI / LLM integrations, Python and TypeScript development, REST APIs, OAuth, data-backed dashboards, cloud deployment, production debugging, and end-to-end automation.

Current platform: https://clouva.com.ar

I’m available for remote project work and can start immediately. If you have a suitable AI, automation, dashboard, or full-stack project, I’d be glad to review the scope and quote it.

Best,
Sergio Ibañez`,
  },
];

export default function OutreachPage() {
  const [sending, setSending] = useState<string | null>(null);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  async function send(lead: Lead) {
    setSending(lead.to);
    setError(null);
    try {
      const response = await authenticatedFetch("/api/admin/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: lead.to, subject: lead.subject, message: lead.message }),
      });
      const payload = await readApiJson<{ ok: boolean; id: string | null }>(response);
      setSent((current) => ({ ...current, [lead.to]: payload.id || "sent" }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo enviar el correo.");
    } finally {
      setSending(null);
    }
  }

  return (
    <div className="space-y-5">
      <header className="rounded-[22px] border border-violet-300/10 bg-[radial-gradient(circle_at_80%_0%,rgba(124,58,237,.18),transparent_36%),#090a11] p-5">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 place-items-center rounded-2xl bg-violet-500/10 text-violet-300"><Mail className="h-5 w-5" /></span>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-violet-300/70">CLOUVA · Resend</p>
            <h1 className="text-2xl font-black text-white">Outreach laboral</h1>
          </div>
        </div>
        <p className="mt-3 text-xs leading-5 text-white/42">Salida oficial: <b className="text-white/75">CLOUVA &lt;admin@clouva.com.ar&gt;</b>. Los envíos salen server-side y la API key nunca llega al navegador.</p>
      </header>

      {error ? <div className="flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.08] p-4 text-sm text-red-100"><TriangleAlert className="mt-0.5 h-4 w-4" />{error}</div> : null}

      <div className="grid gap-4">
        {leads.map((lead) => {
          const isSent = Boolean(sent[lead.to]);
          return (
            <section key={lead.to} className="rounded-[20px] border border-white/[0.07] bg-[#090a11]/90 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/30">{lead.company}</p>
                  <p className="mt-1 text-sm font-semibold text-white">{lead.to}</p>
                  <p className="mt-1 text-xs text-violet-200/75">{lead.subject}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void send(lead)}
                  disabled={sending === lead.to || isSent}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-xs font-bold text-white transition hover:bg-violet-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSent ? <><CheckCircle2 className="h-4 w-4" /> Enviado</> : <><Send className="h-4 w-4" /> {sending === lead.to ? "Enviando…" : "Enviar por Resend"}</>}
                </button>
              </div>
              <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-white/[0.05] bg-black/20 p-4 font-sans text-xs leading-5 text-white/55">{lead.message}</pre>
              {isSent ? <p className="mt-3 text-[10px] text-emerald-300">Resend ID: {sent[lead.to]}</p> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}

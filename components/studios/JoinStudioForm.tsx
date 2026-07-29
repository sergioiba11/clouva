"use client";

import { FormEvent, useState } from "react";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

export function JoinStudioForm({ slug, studioName }: { slug: string; studioName: string }) {
  const { user } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const form = new FormData(event.currentTarget);
    const payload = {
      artist_name: form.get("artist_name"),
      contact_email: form.get("contact_email"),
      category: form.get("category"),
      instagram_url: form.get("instagram_url"),
      presentation: form.get("presentation"),
      activity: form.get("activity"),
      reason: form.get("reason"),
      material_links: String(form.get("material_links") || "").split(/\r?\n/),
      availability: form.get("availability"),
      message: form.get("message"),
      website: form.get("website"),
    };

    try {
      const url = `/api/studios/${encodeURIComponent(slug)}/applications`;
      const response = user
        ? await authenticatedFetch(url, { method: "POST", body: JSON.stringify(payload) })
        : await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      await readApiJson(response);
      setSuccess(true);
      event.currentTarget.reset();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se pudo enviar la solicitud.");
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-[2rem] border border-emerald-400/20 bg-emerald-400/10 p-8 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-400/15 text-2xl">✓</div>
        <h2 className="mt-4 text-2xl font-semibold">Solicitud enviada</h2>
        <p className="mt-2 text-white/60">{studioName} recibió tu presentación y podrá revisarla desde su panel.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <input name="website" tabIndex={-1} autoComplete="off" className="absolute -left-[9999px]" aria-hidden="true" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field name="artist_name" label="Nombre artístico" required />
        <Field name="category" label="Categoría" placeholder="Artista, productor, manager..." />
      </div>
      {!user ? <Field name="contact_email" label="Correo de contacto" type="email" required /> : null}
      <Field name="instagram_url" label="Instagram" placeholder="https://instagram.com/..." />
      <TextArea name="presentation" label="Presentación" rows={5} required placeholder="Contanos quién sos y qué identidad estás construyendo." />
      <TextArea name="activity" label="Qué hacés" rows={4} placeholder="Música, producción, diseño, eventos, gestión..." />
      <TextArea name="reason" label={`¿Por qué querés unirte a ${studioName}?`} rows={5} required />
      <TextArea name="material_links" label="Material o links" rows={4} placeholder="Un enlace HTTPS por línea" />
      <Field name="availability" label="Disponibilidad" />
      <TextArea name="message" label="Mensaje opcional" rows={3} />
      {error ? <p className="rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">{error}</p> : null}
      <button disabled={submitting} className="w-full rounded-xl bg-violet-600 px-5 py-3.5 font-semibold transition hover:bg-violet-500 disabled:opacity-60">{submitting ? "Enviando..." : "Enviar solicitud"}</button>
      <p className="text-center text-xs text-white/35">{user ? "Tu Player se adjunta automáticamente." : "Podés enviar la solicitud sin cuenta o iniciar sesión para adjuntar tu Player."}</p>
    </form>
  );
}

function Field({ name, label, required, type = "text", placeholder }: { name: string; label: string; required?: boolean; type?: string; placeholder?: string }) {
  return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><input name={name} type={type} required={required} placeholder={placeholder} className="w-full rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-violet-400/60" /></label>;
}
function TextArea({ name, label, rows, required, placeholder }: { name: string; label: string; rows: number; required?: boolean; placeholder?: string }) {
  return <label className="block"><span className="mb-2 block text-xs uppercase tracking-[0.16em] text-white/40">{label}</span><textarea name={name} rows={rows} required={required} placeholder={placeholder} className="w-full resize-y rounded-xl border border-white/10 bg-black/30 px-4 py-3 outline-none transition focus:border-violet-400/60" /></label>;
}

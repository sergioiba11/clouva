"use client";

import Link from "next/link";
import { ArrowLeft, CheckCircle2, LockKeyhole, MapPin, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/auth-provider";
import { authenticatedFetch, readApiJson } from "@/lib/authenticated-fetch";

type Address = {
  id: string;
  recipient_name: string;
  recipient_phone: string | null;
  recipient_email: string | null;
  address_line_1: string;
  address_line_2: string | null;
  city: string;
  province: string;
  postal_code: string;
  country: string;
};
type Eligibility = { dateOfBirth: string | null; isAdult: boolean; hasAddress: boolean; defaultAddress: Address | null };

type FormState = {
  id: string;
  dateOfBirth: string;
  recipientName: string;
  recipientPhone: string;
  recipientEmail: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  country: string;
};

const emptyForm: FormState = { id: "", dateOfBirth: "", recipientName: "", recipientPhone: "", recipientEmail: "", addressLine1: "", addressLine2: "", city: "", province: "", postalCode: "", country: "AR" };

export default function PurchaseProfilePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [eligibility, setEligibility] = useState<Eligibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!authLoading && !user) router.replace("/login?next=/cuenta/compras"); }, [authLoading, router, user]);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    void authenticatedFetch("/api/account/purchase-profile")
      .then((response) => readApiJson<{ eligibility: Eligibility }>(response))
      .then(({ eligibility: next }) => {
        setEligibility(next);
        const address = next.defaultAddress;
        setForm({
          id: address?.id || "",
          dateOfBirth: next.dateOfBirth || "",
          recipientName: address?.recipient_name || "",
          recipientPhone: address?.recipient_phone || "",
          recipientEmail: address?.recipient_email || user.email || "",
          addressLine1: address?.address_line_1 || "",
          addressLine2: address?.address_line_2 || "",
          city: address?.city || "",
          province: address?.province || "",
          postalCode: address?.postal_code || "",
          country: address?.country || "AR",
        });
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No se pudo cargar."))
      .finally(() => setLoading(false));
  }, [user]);

  const update = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => {
    setSaving(true); setMessage(null); setError(null);
    try {
      const response = await authenticatedFetch("/api/account/purchase-profile", {
        method: "PUT",
        body: JSON.stringify({
          dateOfBirth: form.dateOfBirth,
          address: {
            id: form.id || undefined,
            label: "Principal",
            recipientName: form.recipientName,
            recipientPhone: form.recipientPhone,
            recipientEmail: form.recipientEmail,
            addressLine1: form.addressLine1,
            addressLine2: form.addressLine2,
            city: form.city,
            province: form.province,
            postalCode: form.postalCode,
            country: form.country,
          },
        }),
      });
      const payload = await readApiJson<{ eligibility: Eligibility }>(response);
      setEligibility(payload.eligibility);
      if (payload.eligibility.defaultAddress?.id) update("id", payload.eligibility.defaultAddress.id);
      setMessage(payload.eligibility.isAdult ? "Identidad de compra y dirección guardadas." : "Datos guardados. La cuenta todavía no cumple la edad mínima para comprar.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };

  if (authLoading || loading) return <main className="min-h-screen bg-[#05070b] px-4 py-8 text-white"><div className="mx-auto h-[70vh] max-w-3xl animate-pulse rounded-[2rem] bg-white/[0.035]" /></main>;
  if (!user) return null;

  const fields: Array<{ key: keyof FormState; label: string; placeholder?: string; type?: string }> = [
    { key: "recipientName", label: "Nombre de quien recibe" },
    { key: "recipientPhone", label: "Teléfono" },
    { key: "recipientEmail", label: "Email", type: "email" },
    { key: "addressLine1", label: "Calle y número" },
    { key: "addressLine2", label: "Piso / departamento (opcional)" },
    { key: "city", label: "Localidad" },
    { key: "province", label: "Provincia / estado" },
    { key: "postalCode", label: "Código postal" },
  ];

  return (
    <main className="min-h-screen bg-[#05070b] text-white">
      <header className="border-b border-white/10"><div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-4 sm:px-6"><Link href="/" className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04]"><ArrowLeft size={17}/></Link><div><p className="text-[9px] font-semibold uppercase tracking-[0.22em] text-violet-300/55">Cuenta privada</p><h1 className="text-lg font-bold">Datos para comprar</h1></div></div></header>
      <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <section className="rounded-[28px] border border-white/10 bg-white/[0.025] p-5 sm:p-7">
          <div className="flex items-start gap-3"><LockKeyhole size={20} className="mt-0.5 text-violet-300/70"/><div><h2 className="font-bold">Esto nunca aparece en tu Player</h2><p className="mt-1 text-xs leading-5 text-white/40">Tu localidad pública, tu mapa de confianza y tu dirección de entrega son datos separados.</p></div></div>
          <div className="mt-6 grid gap-5">
            <label><span className="mb-2 block text-xs font-semibold text-white/60">Fecha de nacimiento</span><input type="date" value={form.dateOfBirth} onChange={(event) => update("dateOfBirth", event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-base outline-none focus:border-violet-300/35"/></label>
            <div className="grid gap-4 sm:grid-cols-2">{fields.map((field) => <label key={field.key} className={field.key === "addressLine1" || field.key === "addressLine2" ? "sm:col-span-2" : ""}><span className="mb-2 block text-xs font-semibold text-white/60">{field.label}</span><input type={field.type || "text"} value={form[field.key]} onChange={(event) => update(field.key, event.target.value)} className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-base outline-none focus:border-violet-300/35"/></label>)}</div>
            <label className="max-w-[180px]"><span className="mb-2 block text-xs font-semibold text-white/60">País</span><input value={form.country} maxLength={2} onChange={(event) => update("country", event.target.value.toUpperCase())} className="h-12 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-base uppercase outline-none focus:border-violet-300/35"/></label>
          </div>
          <button type="button" onClick={() => void save()} disabled={saving} className="mt-6 min-h-12 w-full rounded-xl bg-violet-500 px-4 text-sm font-bold transition hover:bg-violet-400 disabled:opacity-40">{saving ? "Guardando…" : "Guardar datos privados"}</button>
        </section>

        <section className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><div className="flex items-center gap-2"><ShieldCheck size={16} className={eligibility?.isAdult ? "text-emerald-300" : "text-white/30"}/><p className="text-xs font-semibold">Identidad para compras</p></div><p className="mt-2 text-[11px] text-white/40">{eligibility?.isAdult ? "Cuenta habilitada por edad (18+)." : "Necesitás tener 18 años o más."}</p></div><div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4"><div className="flex items-center gap-2"><MapPin size={16} className={eligibility?.hasAddress ? "text-emerald-300" : "text-white/30"}/><p className="text-xs font-semibold">Entrega privada</p></div><p className="mt-2 text-[11px] text-white/40">{eligibility?.hasAddress ? "Dirección lista para checkout." : "Falta guardar una dirección."}</p></div></section>
        {eligibility?.isAdult && eligibility.hasAddress ? <p className="mt-4 flex items-center gap-2 text-xs text-emerald-200/75"><CheckCircle2 size={15}/>Tu cuenta cumple los requisitos para comprar productos físicos.</p> : null}
        {(message || error) ? <p className={`mt-4 rounded-xl border px-4 py-3 text-sm ${error ? "border-red-400/20 bg-red-950/30 text-red-200" : "border-emerald-300/15 bg-emerald-300/[0.04] text-emerald-100"}`}>{error || message}</p> : null}
      </div>
    </main>
  );
}

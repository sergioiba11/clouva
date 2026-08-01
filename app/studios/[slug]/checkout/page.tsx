import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PublicShell } from "@/components/public/PublicShell";
import { StudioMembershipCheckoutAction } from "@/components/public/StudioMembershipCheckoutAction";
import { resolveStudioAlias } from "@/lib/server/public-identity-data";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const result = await resolveStudioAlias(slug).catch(() => null);
  if (!result) return { title: "Estudio no encontrado — CLOUVA", robots: { index: false, follow: false } };
  return { title: `Membresía — ${result.studio.name}`, robots: { index: false, follow: false } };
}

function StatusBanner({ status }: { status?: string }) {
  if (status === "success") return <p className="mt-6 rounded-xl border border-emerald-400/20 bg-emerald-400/10 p-3 text-sm text-emerald-200">¡Listo! Tu membresía está confirmada.</p>;
  if (status === "pending") return <p className="mt-6 rounded-xl border border-amber-400/20 bg-amber-400/10 p-3 text-sm text-amber-200">Tu pago está pendiente de confirmación de Mercado Pago.</p>;
  if (status === "failure") return <p className="mt-6 rounded-xl border border-red-400/20 bg-red-400/10 p-3 text-sm text-red-200">El pago no se pudo completar. Podés intentar de nuevo.</p>;
  return null;
}

// Same page doubles as the Mercado Pago back_url target -- ?status= comes
// back from MP after a paid checkout, ?plan= selects which plan to show
// (defaults to the studio's free plan, if it has one) -- so there's no
// separate "return" route showing a different, less-branded screen.
export default async function StudioMembershipCheckoutPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ plan?: string; status?: string }>;
}) {
  const { slug } = await params;
  const { plan: planSlug, status } = await searchParams;
  const result = await resolveStudioAlias(slug);
  if (!result) notFound();

  const { studio, membershipPlans } = result;
  const plan = planSlug
    ? membershipPlans.find((item) => item.slug === planSlug)
    : membershipPlans.find((item) => item.is_free);
  if (!plan) notFound();

  const priceLabel = plan.is_free
    ? "Gratis"
    : new Intl.NumberFormat("es-AR", { style: "currency", currency: plan.currency, maximumFractionDigits: 0 }).format(Number(plan.price));

  return (
    <PublicShell brand={studio.name} brandHref={`/studios/${studio.slug}`} accent={studio.accent_color || undefined}>
      <div className="mx-auto max-w-xl px-4 py-12 sm:px-6">
        <div className="flex items-center gap-4">
          {studio.logo_url ? (
            <img src={studio.logo_url} alt={studio.name} className="h-14 w-14 rounded-2xl object-cover" />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-500/15 text-xl font-semibold">{studio.name.charAt(0)}</div>
          )}
          <div>
            <p className="text-xs uppercase tracking-[0.24em] text-violet-300/70">{studio.name}</p>
            <h1 className="text-2xl font-semibold">{plan.name}</h1>
          </div>
        </div>

        <StatusBanner status={status} />

        <div className="mt-8 rounded-[2rem] border border-white/10 bg-white/[0.025] p-6 sm:p-8">
          {plan.description ? <p className="leading-6 text-white/70">{plan.description}</p> : null}
          <p className="mt-6 text-3xl font-bold">
            {priceLabel}
            {!plan.is_free ? <span className="ml-1 text-base font-normal text-white/45">/ {plan.billing_interval === "year" ? "año" : "mes"}</span> : null}
          </p>
          {plan.benefits.length ? (
            <ul className="mt-6 space-y-2 text-sm text-white/70">
              {plan.benefits.map((benefit, index) => (
                <li key={index} className="flex gap-2">
                  <span className="text-violet-300">✓</span>
                  {benefit}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="mt-8">
            <StudioMembershipCheckoutAction studioSlug={studio.slug} plan={{ id: plan.id, slug: plan.slug, isFree: plan.is_free }} />
          </div>
        </div>
      </div>
    </PublicShell>
  );
}

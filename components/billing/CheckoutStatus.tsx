import Link from "next/link";

export function CheckoutStatus({
  tone,
  title,
  message,
}: {
  tone: "success" | "pending" | "failure";
  title: string;
  message: string;
}) {
  const icon = tone === "success" ? "✓" : tone === "pending" ? "…" : "×";
  const styles = tone === "success"
    ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200"
    : tone === "pending"
      ? "border-violet-400/25 bg-violet-400/10 text-violet-200"
      : "border-red-400/25 bg-red-400/10 text-red-200";
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#05040a] px-4 text-white">
      <section className="w-full max-w-md rounded-[2rem] border border-white/10 bg-[#0b0913] p-8 text-center">
        <div className={`mx-auto flex h-14 w-14 items-center justify-center rounded-full border text-2xl ${styles}`}>{icon}</div>
        <h1 className="mt-5 text-2xl font-semibold">{title}</h1>
        <p className="mt-3 leading-7 text-white/55">{message}</p>
        <div className="mt-6 grid grid-cols-2 gap-3"><Link href="/vip" className="rounded-xl bg-violet-600 px-4 py-3 text-sm font-semibold">Ver membresía</Link><Link href="/matrix" className="rounded-xl border border-white/15 px-4 py-3 text-sm">Ir a La Matrix</Link></div>
      </section>
    </main>
  );
}

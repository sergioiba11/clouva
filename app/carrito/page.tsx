import Link from "next/link";
import { MainFooter, MainNav } from "@/components/layout";

export default function CartPage() {
  return (
    <main>
      <MainNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-12 md:px-8">
        <h1 className="text-3xl">Cart</h1>
        <div className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
          <p className="text-white/70">Tu selección premium está lista para checkout.</p>
          <div className="mt-6 flex items-center justify-between border-t border-white/10 pt-6"><span>Total</span><span className="text-[#95d8ff]">$259.800</span></div>
          <Link href="/checkout" className="mt-6 inline-block rounded-full bg-white px-6 py-3 text-sm text-black">Continuar checkout</Link>
        </div>
      </section>
      <MainFooter />
    </main>
  );
}

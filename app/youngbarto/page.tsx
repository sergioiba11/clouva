import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { siteUrl } from "@/lib/site-url";

const canonical = `${siteUrl}/youngbarto`;
const cover = "/assets/youngbarto/so-fresh.webp";
const socialCover = `${siteUrl}/assets/youngbarto/so-fresh.jpg`;

export const metadata: Metadata = {
  title: "Young Barto — SO FRESH | El Iglú Records · CLOUVA",
  description: "Young Barto en El Iglú Records. SO FRESH: identidad visual helada, música y universo creativo CLOUVA.",
  alternates: { canonical },
  openGraph: {
    type: "website",
    title: "Young Barto — SO FRESH",
    description: "SO FRESH · Young Barto · El Iglú Records x CLOUVA.",
    url: canonical,
    siteName: "CLOUVA",
    images: [{ url: socialCover, width: 1672, height: 940, alt: "Young Barto — SO FRESH · El Iglú Records" }],
  },
  twitter: { card: "summary_large_image", title: "Young Barto — SO FRESH", images: [socialCover] },
  robots: { index: true, follow: true },
};

export default function YoungBartoPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-[#030d1c] text-slate-50">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_15%,rgba(39,163,236,0.19),transparent_65%)]" />
      <div className="relative mx-auto flex max-w-[1640px] flex-col px-4 pb-14 pt-5 sm:px-8 sm:pt-8 lg:px-14">
        <header className="mb-5 flex items-center justify-between gap-4 border-b border-cyan-200/15 pb-5 sm:mb-8">
          <Link href="/eliglurecords" className="text-xs font-black uppercase tracking-[0.19em] text-cyan-100 transition hover:text-white sm:text-sm">
            EL IGLÚ RECORDS
          </Link>
          <Link href="/" className="text-xs font-black uppercase tracking-[0.24em] text-white transition hover:text-cyan-300 sm:text-sm">
            CLOUVA
          </Link>
        </header>

        <section aria-label="Young Barto — SO FRESH" className="mx-auto w-full max-w-[1380px]">
          <div className="relative overflow-hidden rounded-[12px] border border-cyan-200/20 bg-[#061629] shadow-[0_0_90px_rgba(61,171,234,0.16)] sm:rounded-[20px]">
            <Image
              src={cover}
              alt="Young Barto, frente a un iglú, con la portada SO FRESH en letras de hielo"
              width={1672}
              height={940}
              priority
              sizes="(max-width: 1400px) 100vw, 1380px"
              className="block h-auto w-full"
            />
          </div>
          <div className="mt-8 flex flex-col gap-6 border-t border-cyan-200/15 pt-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-[0.29em] text-cyan-300">
                EL IGLÚ RECORDS · CLOUVA
              </p>
              <h1 className="text-4xl font-black uppercase tracking-tight text-white sm:text-6xl">Young Barto</h1>
              <p className="mt-2 text-lg font-semibold uppercase tracking-[0.18em] text-cyan-200">SO FRESH</p>
            </div>
            <Link
              href="/eliglurecords"
              className="inline-flex w-fit items-center justify-center rounded-full border border-cyan-300/50 px-6 py-3 text-sm font-bold tracking-wide text-cyan-100 transition hover:bg-cyan-300/15 hover:text-white"
            >
              CONOCÉ EL IGLÚ RECORDS <span aria-hidden="true" className="ml-3">↗</span>
            </Link>
          </div>
        </section>
        <footer className="mt-16 text-center text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
          DEL SUR PARA EL MUNDO · CLOUVA
        </footer>
      </div>
    </main>
  );
}

import { MyQrCard } from "@/components/account/MyQrCard";
import { MainFooter, MainNav } from "@/components/layout";

export default function MyQrPage() {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_50%_-20%,rgba(124,58,237,.22),transparent_36%),#050507] text-white">
      <MainNav />
      <section className="mx-auto w-full max-w-3xl px-4 py-12 sm:px-6 sm:py-16">
        <MyQrCard />
      </section>
      <MainFooter />
    </main>
  );
}

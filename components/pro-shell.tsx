import { MainFooter, MainNav } from "./layout";

export function ProShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-[#05050a] text-white">
      <MainNav />
      {children}
      <MainFooter />
    </main>
  );
}

import { ProShell } from "@/components/pro-shell";
import { SectionBlock } from "@/components/section-block";

export default function GaleriaPage() {
  return (
    <ProShell>
      <SectionBlock eyebrow="Galería" title="Visual archive" description="Placeholder para assets visuales, lookbook y reels por drop." >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="aspect-[4/5] rounded-2xl border border-white/10 bg-white/[0.04]" />
          ))}
        </div>
      </SectionBlock>
    </ProShell>
  );
}

export function SectionBlock({
  eyebrow,
  title,
  description,
  children
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="mx-auto w-full max-w-7xl px-4 py-14 md:px-8">
      <p className="text-xs uppercase tracking-[0.22em] text-[#7dcfff]">{eyebrow}</p>
      <h2 className="mt-3 text-3xl font-semibold md:text-5xl">{title}</h2>
      {description ? <p className="mt-4 max-w-2xl text-white/70">{description}</p> : null}
      {children ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}

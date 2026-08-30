import Link from "next/link";

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-[#050507] px-5 py-12 text-white sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-violet-300 hover:text-violet-200">← CLOUVA</Link>
        <h1 className="mt-8 text-4xl font-semibold">Política de Privacidad</h1>
        <p className="mt-3 text-sm text-white/45">Cómo CLOUVA trata la información necesaria para operar la plataforma.</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-white/72">
          <section><h2 className="text-lg font-semibold text-white">1. Información que puede tratarse</h2><p className="mt-2">CLOUVA puede tratar datos de cuenta, perfil, preferencias, actividad dentro de la plataforma, contenido que decidas subir y datos técnicos necesarios para seguridad y funcionamiento.</p></section>
          <section><h2 className="text-lg font-semibold text-white">2. Para qué se utiliza</h2><p className="mt-2">La información se utiliza para autenticar usuarios, personalizar la experiencia, prestar funciones solicitadas, mantener la seguridad, mejorar el servicio y cumplir obligaciones aplicables.</p></section>
          <section><h2 className="text-lg font-semibold text-white">3. Servicios conectados</h2><p className="mt-2">Cuando conectás servicios externos, CLOUVA utiliza únicamente los datos y permisos necesarios para ejecutar la integración autorizada. Esos servicios también pueden aplicar sus propias políticas.</p></section>
          <section><h2 className="text-lg font-semibold text-white">4. Conservación y seguridad</h2><p className="mt-2">La información se conserva durante el tiempo necesario para prestar el servicio, mantener registros requeridos y proteger la plataforma. Se aplican medidas técnicas y organizativas destinadas a reducir accesos no autorizados.</p></section>
          <section><h2 className="text-lg font-semibold text-white">5. Tus controles</h2><p className="mt-2">Podés gestionar información de tu cuenta y permisos desde las opciones disponibles en CLOUVA. Para solicitudes adicionales, utilizá el canal de soporte oficial publicado dentro de la plataforma.</p></section>
          <section><h2 className="text-lg font-semibold text-white">6. Actualizaciones</h2><p className="mt-2">Esta política puede actualizarse para reflejar cambios en funciones, integraciones o requisitos aplicables. Los cambios relevantes se comunicarán cuando corresponda.</p></section>
        </div>

        <p className="mt-12 border-t border-white/10 pt-6 text-xs leading-5 text-white/35">Esta página describe la base general de privacidad de CLOUVA y puede ampliarse para detallar integraciones y tratamientos específicos.</p>
      </article>
    </main>
  );
}

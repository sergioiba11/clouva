import Link from "next/link";

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-[#050507] px-5 py-12 text-white sm:px-8">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm text-violet-300 hover:text-violet-200">← CLOUVA</Link>
        <h1 className="mt-8 text-4xl font-semibold">Términos de uso</h1>
        <p className="mt-3 text-sm text-white/45">Condiciones generales de acceso y uso de CLOUVA.</p>

        <div className="mt-10 space-y-8 text-[15px] leading-7 text-white/72">
          <section><h2 className="text-lg font-semibold text-white">1. Uso de la plataforma</h2><p className="mt-2">Al utilizar CLOUVA aceptás usar la plataforma de forma lícita y respetar las reglas, permisos y restricciones aplicables a cada función.</p></section>
          <section><h2 className="text-lg font-semibold text-white">2. Cuenta e identidad</h2><p className="mt-2">Sos responsable de la información de tu cuenta, de mantener seguras tus credenciales y de las acciones realizadas desde tu sesión.</p></section>
          <section><h2 className="text-lg font-semibold text-white">3. Contenido</h2><p className="mt-2">Conservás los derechos que te correspondan sobre el contenido que publiques. Al subir contenido, declarás contar con los permisos necesarios para usarlo y compartirlo dentro de CLOUVA.</p></section>
          <section><h2 className="text-lg font-semibold text-white">4. Servicios y funciones</h2><p className="mt-2">CLOUVA puede incorporar funciones de comunidad, creación, comercio, música, avatares, inteligencia artificial y servicios conectados. Algunas funciones pueden estar sujetas a condiciones adicionales informadas dentro de la propia experiencia.</p></section>
          <section><h2 className="text-lg font-semibold text-white">5. Cambios y disponibilidad</h2><p className="mt-2">La plataforma puede actualizar funciones, interfaces y condiciones para reflejar cambios técnicos, operativos o legales. Las modificaciones relevantes se comunicarán cuando corresponda.</p></section>
          <section><h2 className="text-lg font-semibold text-white">6. Contacto</h2><p className="mt-2">Para consultas sobre estos términos, utilizá el canal de soporte oficial disponible dentro de CLOUVA.</p></section>
        </div>

        <p className="mt-12 border-t border-white/10 pt-6 text-xs leading-5 text-white/35">Este texto establece una base funcional para la plataforma y puede ampliarse con condiciones específicas según las funciones habilitadas.</p>
      </article>
    </main>
  );
}

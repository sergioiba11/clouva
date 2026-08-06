import "server-only";
import type { DetectedLogo } from "./types";

export type LogoBriefPrompts = { primary: string; symbol: string; horizontal: string; vertical: string };

// Regla no-negociable (pedido explícito del usuario): "Debe usar el nombre
// real exacto de la identidad, no copiar nombres ni marcas de la
// referencia." -- este bloque se repite igual en las 4 variantes.
function nameRule(name: string): string {
  return `El nombre real y exacto a usar (si el logo lleva texto) es "${name}" -- usalo TAL CUAL, sin traducir ni modificar. NUNCA reproduzcas, copies ni hagas referencia a ningún otro nombre, texto o marca que aparezca en la imagen de referencia -- esa imagen es solo guía de estilo visual, no de contenido.`;
}

// Cuando hay un logo detectado en la referencia: fiel al lenguaje visual
// (silueta/geometría/tipografía/paleta), pero un símbolo propio, nunca una
// copia -- "mismo peso, misma energía y misma familia visual, pero símbolo,
// letras personalizadas y geometría propias" (spec original, sección 3).
function styleBrief(detected: DetectedLogo): string {
  if (!detected.detected || !detected.visualSignature) {
    return "No hay un logo de referencia claro -- generá un símbolo/marca original y minimalista, isotipo geométrico simple, alto contraste.";
  }
  const s = detected.visualSignature;
  return [
    `Lenguaje visual a igualar (NUNCA copiar, solo el estilo): silueta general "${s.silhouette}", geometría "${s.geometry}", simetría "${s.symmetry}", grosor de trazo "${s.strokeWeight}", uso del espacio negativo "${s.negativeSpace}".`,
    s.typographyStyle ? `Estilo tipográfico de referencia (si el logo lleva texto): "${s.typographyStyle}".` : "",
    s.palette.length > 0 ? `Paleta de referencia: ${s.palette.join(", ")}.` : "",
    `Complejidad: ${s.complexity}.`,
    "Construí un símbolo, silueta y construcción interna PROPIOS -- misma familia visual y energía que la referencia, nunca sus mismas formas exactas ni su monograma.",
  ].filter(Boolean).join(" ");
}

export function buildLogoBrief(args: { name: string; detected: DetectedLogo }): LogoBriefPrompts {
  const base = [
    `Identidad de marca para "${args.name}" en CLOUVA, una plataforma premium underground para artistas y estudios.`,
    nameRule(args.name),
    styleBrief(args.detected),
    "Vos NUNCA generás HTML, CSS ni código -- solo la imagen del logo.",
  ].join(" ");

  return {
    primary: [base, "Lockup PRINCIPAL: la composición completa tal como se usaría de cabecera (símbolo + texto si el estilo detectado lleva texto), fondo sólido oscuro, alto contraste, centrado con margen.", "Formato cuadrado."].join(" "),
    symbol: [base, "Versión SOLO SÍMBOLO/isotipo, sin ningún texto -- el ícono aislado, tiene que funcionar solo en tamaño chico (favicon/avatar).", "Formato cuadrado, fondo sólido oscuro, símbolo centrado con margen."].join(" "),
    horizontal: [base, "Lockup HORIZONTAL: símbolo a la izquierda, texto (si aplica) a la derecha, en una sola línea -- para usar en una barra de navegación ancha.", "Formato horizontal (ancho mayor que alto), fondo sólido oscuro."].join(" "),
    vertical: [base, "Lockup VERTICAL: símbolo arriba, texto (si aplica) debajo, centrado -- para usar en un espacio angosto y alto.", "Formato vertical (alto mayor que ancho), fondo sólido oscuro."].join(" "),
  };
}

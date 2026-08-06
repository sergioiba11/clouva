import "server-only";
import type { DetectedLogo, ReferenceFidelity } from "./types";

// V2: ya no arma 4 prompts (uno por variante) -- arma UN solo prompt para el
// símbolo maestro (masterSymbol), nunca con texto. El wordmark se compone
// aparte, determinísticamente (compose-logo-lockups.ts), nunca lo escribe
// Gemini.
function styleBrief(detected: DetectedLogo, fidelity: ReferenceFidelity): string {
  if (!detected.detected || !detected.visualSignature) {
    return "No hay un símbolo de referencia claro -- generá un símbolo original y minimalista, isotipo geométrico simple, alto contraste.";
  }
  const s = detected.visualSignature;
  const fidelityLine = fidelity === "high"
    ? "Fidelidad ALTA a la referencia: respetá con rigor el peso visual, la complejidad, la proporción y el estilo lineal general -- el símbolo nuevo tiene que sentirse claramente de la MISMA familia visual que la referencia."
    : fidelity === "balanced"
      ? "Fidelidad media: usá la referencia como guía de estilo, con más libertad de interpretación que una copia estricta del lenguaje visual."
      : "Fidelidad creativa: la referencia es solo inspiración de mood, tenés libertad real de interpretación.";

  return [
    `Lenguaje visual de referencia (NUNCA copiar la silueta/geometría exacta, solo el estilo): silueta general "${s.silhouette}", geometría "${s.geometry}", simetría "${s.symmetry}", grosor de trazo "${s.strokeWeight}", uso del espacio negativo "${s.negativeSpace}".`,
    s.palette.length > 0 ? `Paleta de referencia: ${s.palette.join(", ")}.` : "",
    `Complejidad: ${s.complexity}.`,
    fidelityLine,
    "Construí un símbolo, silueta y construcción interna PROPIOS -- misma familia visual, energía y nivel de detalle que la referencia, nunca sus mismas formas exactas ni su monograma. El resultado tiene que pertenecer claramente a la misma dirección artística sin ser una copia.",
  ].filter(Boolean).join(" ");
}

// Único prompt de esta fase: el símbolo maestro, aislado, sin texto.
export function buildMasterSymbolPrompt(args: { entityName: string; detected: DetectedLogo; fidelity: ReferenceFidelity }): string {
  return [
    `Símbolo/isotipo de marca ORIGINAL para "${args.entityName}" en CLOUVA, una plataforma premium underground para artistas y estudios.`,
    styleBrief(args.detected, args.fidelity),
    "PROHIBIDO ABSOLUTAMENTE: texto, letras, números, tipografía, nombres, el nombre de la marca, descriptores, personas, rostros, siluetas humanas reconocibles, fotografías, escenas concretas.",
    "Formato cuadrado, centrado, con margen alrededor del símbolo, fondo sólido oscuro, alto contraste, funciona en tamaño chico (favicon/avatar).",
    "Vos NUNCA generás HTML, CSS ni código -- solo la imagen del símbolo.",
  ].join(" ");
}

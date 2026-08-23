import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Inicio abre un menú de cuenta compartido y accesible", () => {
  const home = read("./components/clouva/HomeDashboard.tsx");
  const mobileHome = read("./components/clouva/MobileHomeDashboard.tsx");
  const layout = read("./components/layout.tsx");
  const menu = read("./components/account/AccountMenu.tsx");

  assert.match(home, /<AccountMenu variant="home"/);
  assert.match(mobileHome, /<AccountMenu variant="home"/);
  assert.match(layout, /<AccountMenu \/>/);
  assert.match(menu, /aria-expanded=\{openMenu\}/);
  assert.match(menu, /event\.key !== "Escape"/);
  assert.match(menu, /href="\/mi-flow"[\s\S]*?label="MI FLOW"[\s\S]*?Dinero, metas y movimientos/);
  assert.match(menu, /Mi perfil público/);
  assert.match(menu, /`\/\$\{encodeURIComponent\(currentPlayer\.slug\)\}`/);
  assert.doesNotMatch(menu, /`\/u\/\$\{encodeURIComponent\(currentPlayer\.slug\)\}`/);
  assert.match(menu, /Mi Avatar 3D/);
  assert.match(menu, /Configuración/);
  assert.match(menu, /href="\/mi-flow\/creative"[\s\S]*?label="Centro creativo"/);
  assert.match(menu, /Conectado/);
});

test("MI FLOW económico ocupa la ruta canónica y el panel anterior vive en Centro creativo", () => {
  const miFlow = read("./app/mi-flow/page.tsx");
  const legacyMoney = read("./app/mi-flow/money/page.tsx");
  const creative = read("./app/mi-flow/creative/page.tsx");
  const menu = read("./app/mi-flow/menu/page.tsx");

  assert.match(miFlow, /table: "flow_money_entries"/);
  assert.match(miFlow, /title: "MI FLOW"/);
  assert.match(legacyMoney, /redirect\("\/mi-flow"\)/);
  assert.match(creative, /Centro creativo/);
  assert.match(menu, /Herramientas CLOUVA/);
});

test("Trébol es un asistente global activo con la mascota oficial", () => {
  const globalButton = read("./components/GlobalClouvaAIButton.tsx");
  const compact = read("./components/clouva-ai/ClouvaAICompactPanel.tsx");
  const layout = read("./app/layout.tsx");

  assert.match(layout, /<ClouvaAIAssistantProvider>/);
  assert.match(globalButton, /trebol-mascot\.png/);
  assert.match(globalButton, /Lista para ayudarte/);
  assert.doesNotMatch(globalButton, /Próximamente/);
  assert.match(globalButton, /event\.key !== "Escape"/);
  assert.match(compact, /Crear un proyecto/);
  assert.match(compact, /Mejorar mi avatar/);
  assert.match(compact, /Ayudarme con música/);
  assert.match(compact, /Ingresar a CLOUVA|useAuth/);
});

test("página completa y popover comparten conversación, historial y memoria", () => {
  const full = read("./components/clouva-ai/ClouvaAIChat.tsx");
  const compact = read("./components/clouva-ai/ClouvaAICompactPanel.tsx");
  const controller = read("./components/clouva-ai/useClouvaAIConversation.ts");

  assert.match(full, /useClouvaAIConversation\(\)/);
  assert.match(compact, /useClouvaAIConversation\(\)/);
  assert.match(controller, /from\("ai_conversations"\)/);
  assert.match(controller, /from\("ai_messages"\)/);
  assert.match(controller, /project_key", "clouva"/);
});

test("Trébol inicia una conversación nueva cada vez que se abre", () => {
  const controller = read("./components/clouva-ai/useClouvaAIConversation.ts");
  const compact = read("./components/clouva-ai/ClouvaAICompactPanel.tsx");

  assert.match(controller, /void loadConversationHistory\(\)/);
  assert.match(controller, /async function loadConversationHistory\(\)/);
  assert.match(controller, /setConversations\(recent\);\s+setConversationId\(null\);\s+setMessages\(\[\{ role: "assistant", content: CLOUVA_AI_WELCOME \}\]\);/);
  assert.doesNotMatch(controller, /await loadMessages\(recent\[0\]\.id\)/);
  assert.match(controller, /function newConversation\(\)[\s\S]*?setInput\(""\)/);
  assert.match(compact, /Preparando una conversación nueva/);
});

test("no queda un segundo asistente legacy en Avatar", () => {
  const avatar = read("./components/clouva/AvatarScene.tsx");
  assert.doesNotMatch(avatar, /CloverAI(Button|Panel)/);
  assert.equal(existsSync(new URL("./components/clouva/CloverAIButton.tsx", import.meta.url)), false);
  assert.equal(existsSync(new URL("./components/clouva/CloverAIPanel.tsx", import.meta.url)), false);
});

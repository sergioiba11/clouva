import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Inicio abre un menú de cuenta compartido y separa MI FLOW de MI SPOT", () => {
  const home = read("./components/clouva/HomeDashboard.tsx");
  const mobileHome = read("./components/clouva/MobileHomeDashboard.tsx");
  const layout = read("./components/layout.tsx");
  const menu = read("./components/account/AccountMenu.tsx");

  assert.match(home, /<AccountMenu variant="home"/);
  assert.match(mobileHome, /<AccountMenu variant="home"/);
  assert.match(layout, /<AccountMenu \/>/);
  assert.match(menu, /aria-expanded=\{openMenu\}/);
  assert.match(menu, /event\.key === "Escape"/);
  assert.match(menu, /href="\/mi-flow"[\s\S]*?label="MI FLOW"[\s\S]*?Billetera, ganancias, FLOWS y Diamantes/);
  assert.match(menu, /href="\/mi-spot"[\s\S]*?label="MI SPOT"/);
  assert.match(menu, /Mi perfil público/);
  assert.match(menu, /Mi Avatar 3D/);
  assert.match(menu, /Configuración/);
  assert.match(menu, /href="\/mi-flow\/creative"[\s\S]*?label="Centro creativo"/);
  assert.match(menu, /Conectado/);
});

test("MI FLOW usa wallets reales y Hacer dinero entra a MI SPOT", () => {
  const miFlow = read("./app/mi-flow/page.tsx");
  const summary = read("./app/api/mi-flow/summary/route.ts");
  const balances = read("./app/api/wallet/balances/route.ts");
  const walletChip = read("./components/wallet/WalletBalanceChip.tsx");
  const manualFinances = read("./app/mi-flow/finanzas/page.tsx");
  const legacyMoney = read("./app/mi-flow/money/page.tsx");
  const incomeProjects = read("./app/mi-flow/negocios/page.tsx");

  assert.doesNotMatch(miFlow, /flow_money_entries/);
  assert.match(miFlow, /\/api\/mi-flow\/summary/);
  assert.match(miFlow, />MI FLOW</);
  assert.match(miFlow, /Hacer dinero/);
  assert.match(miFlow, /href="\/mi-spot"[\s\S]*?>[\s\S]*?Hacer dinero/);
  assert.match(miFlow, /title="Proyectos de ingresos"[\s\S]*?href="\/mi-flow\/negocios"/);
  assert.doesNotMatch(miFlow, /href="\/mi-flow\/negocios"[^>]*>Hacer dinero/);
  assert.match(summary, /flows_wallets/);
  assert.match(summary, /flows_wallet_ledger/);
  assert.match(summary, /diamond_wallets/);
  assert.match(summary, /diamond_wallet_ledger/);
  assert.match(summary, /mi_flow_money_ledger/);
  assert.match(summary, /beneficiary_type: "user" \| "player" \| "studio"/);
  assert.match(balances, /flows_wallets/);
  assert.match(balances, /diamond_wallets/);
  assert.match(walletChip, /\/api\/wallet\/balances/);
  assert.match(walletChip, /href="\/mi-flow\?asset=flows"/);
  assert.match(walletChip, /href="\/mi-flow\?asset=diamonds"/);
  assert.match(manualFinances, /table: "flow_money_entries"/);
  assert.match(manualFinances, /no modifica el saldo real de MI FLOW/);
  assert.match(legacyMoney, /redirect\("\/mi-flow"\)/);
  assert.match(incomeProjects, /flow_businesses/);
  assert.match(incomeProjects, /Proyectos de ingresos/);
  assert.match(incomeProjects, /No es MI SPOT/);
});

test("el ledger monetario de MI FLOW es idempotente, privado y seller-scoped", () => {
  const migration = read("./supabase/migrations/20260823190000_mi_flow_money_ledger.sql");
  const summary = read("./app/api/mi-flow/summary/route.ts");

  assert.match(migration, /unique \(source_type, source_id, beneficiary_user_id\)/);
  assert.match(migration, /on conflict \(source_type, source_id, beneficiary_user_id\)/i);
  assert.match(migration, /status in \('pending', 'available', 'withdrawn', 'refunded', 'reversed'\)/);
  assert.match(migration, /new\.seller_type = 'player'/);
  assert.match(migration, /new\.seller_player_id/);
  assert.match(migration, /new\.seller_studio_id/);
  assert.doesNotMatch(migration, /buyer_id[^\n]*beneficiary/i);
  assert.match(migration, /beneficiary_user_id = auth\.uid\(\)/);
  assert.match(migration, /revoke insert, update, delete on public\.mi_flow_money_ledger from anon, authenticated/);
  assert.match(migration, /when excluded\.status in \('refunded', 'reversed'\)/);
  assert.match(summary, /neq\("beneficiary_user_id", user\.id\)/);
  assert.match(summary, /managedPlayerIds/);
  assert.match(summary, /managedStudioIds/);
  assert.match(summary, /Merely managing a Spot never turns its/);
});

test("FLOWS queda reservado para la moneda y el CRUD creativo conserva sus datos con otro nombre", () => {
  const notes = read("./app/mi-flow/flows/page.tsx");
  const creative = read("./app/mi-flow/creative/page.tsx");
  const menu = read("./app/mi-flow/menu/page.tsx");

  assert.match(notes, /table: "flow_flows"/);
  assert.match(notes, /title: "Notas creativas"/);
  assert.doesNotMatch(notes, /title: "Flows"/);
  assert.match(creative, /Notas creativas/);
  assert.doesNotMatch(creative, /\["Flows", "\/mi-flow\/flows"\]/);
  assert.match(menu, /MI SPOT/);
  assert.match(menu, /Notas creativas/);
});

test("MI SPOT es universal y reutiliza el commerce real en vez de clonarlo", () => {
  const selector = read("./app/mi-spot/page.tsx");
  const onboarding = read("./app/mi-spot/new/page.tsx");
  const home = read("./app/mi-spot/[spotId]/page.tsx");
  const commerce = read("./app/mi-spot/[spotId]/commerce/page.tsx");
  const dashboard = read("./components/commerce/SpotCommerceDashboard.tsx");
  const spotApi = read("./app/api/mi-spot/route.ts");
  const helper = read("./lib/server/commerce-spot.ts");

  assert.match(selector, /No necesitás ser artista, productor ni tener un Estudio/);
  assert.match(selector, /href="\/mi-spot\/new"/);
  assert.match(onboarding, /QUICK_SPOT_INTENTS/);
  assert.match(onboarding, /Preparar mi Spot con Gemini/);
  assert.match(spotApi, /create_user_commerce_spot/);
  assert.match(home, /Este Spot se adapta a tu negocio/);
  assert.match(commerce, /<SpotCommerceDashboard studioId=\{commerceScope\}/);
  assert.match(commerce, /`spot:\$\{scope\.spot\.id\}`/);
  assert.match(helper, /args\.studioId\.startsWith\("spot:"\)/);
  assert.match(dashboard, /\/api\/studios\/\$\{encodeURIComponent\(studioId\)\}\/commerce\/spot/);
  assert.match(dashboard, /\/commerce\/scan/);
  assert.match(dashboard, /\/commerce\/inventory/);
  assert.match(dashboard, /\/commerce\/pos/);
});

test("Trébol es un asistente global activo con la mascota oficial", () => {
  const globalButton = read("./components/GlobalClouvaAIButton.tsx");
  const compact = read("./components/clouva-ai/ClouvaAICompactPanel.tsx");
  const layout = read("./app/layout.tsx");

  assert.match(layout, /<ClouvaAIAssistantProvider>/);
  assert.match(globalButton, /trebol-mascot\.png/);
  assert.match(globalButton, /Lista para ayudarte/);
  assert.doesNotMatch(globalButton, /Próximamente/);
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

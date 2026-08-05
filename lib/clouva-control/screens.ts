import type { Role } from "@/lib/auth";

export type PreviewPersona =
  | "visitante"
  | "usuario_nuevo"
  | "free"
  | "vip"
  | "creador"
  | "miembro_estudio"
  | "manager_estudio"
  | "owner_estudio"
  | "admin";

export type ClouvaScreenDefinition = {
  id: string;
  name: string;
  route: string;
  module: string;
  status: "active" | "preview" | "internal";
  allowedRoles: string[];
  previewStates: PreviewPersona[];
  entryPoints: string[];
  exits: string[];
  enabled: boolean;
};

export type ClouvaFlowDefinition = {
  id: string;
  name: string;
  description: string;
  steps: Array<{ label: string; route: string; expected: string }>;
};

export const PREVIEW_PERSONAS: Array<{ id: PreviewPersona; label: string; effectiveRole: Role | null }> = [
  { id: "visitante", label: "Visitante", effectiveRole: null },
  { id: "usuario_nuevo", label: "Usuario nuevo", effectiveRole: "cliente" },
  { id: "free", label: "Free", effectiveRole: "cliente" },
  { id: "vip", label: "VIP", effectiveRole: "vip" },
  { id: "creador", label: "Creador", effectiveRole: "cliente" },
  { id: "miembro_estudio", label: "Miembro de estudio", effectiveRole: "cliente" },
  { id: "manager_estudio", label: "Manager de estudio", effectiveRole: "empleado" },
  { id: "owner_estudio", label: "Owner de estudio", effectiveRole: "admin" },
  { id: "admin", label: "Admin", effectiveRole: "admin" },
];

export function previewPersonaRole(persona: PreviewPersona | null | undefined): Role | null {
  return PREVIEW_PERSONAS.find((item) => item.id === persona)?.effectiveRole ?? null;
}

const allPersonas = PREVIEW_PERSONAS.map((persona) => persona.id);

export const CLOUVA_SCREENS: ClouvaScreenDefinition[] = [
  { id: "landing", name: "Entrada pública", route: "/", module: "Entrada", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["enlace externo"], exits: ["login", "matrix"], enabled: true },
  { id: "login", name: "Login", route: "/login", module: "Entrada", status: "active", allowedRoles: ["public"], previewStates: ["visitante"], entryPoints: ["landing", "guard"], exits: ["onboarding", "home"], enabled: true },
  { id: "onboarding", name: "Onboarding de identidad", route: "/onboarding/identity", module: "Entrada", status: "active", allowedRoles: ["cliente"], previewStates: ["usuario_nuevo"], entryPoints: ["registro"], exits: ["profile-edit", "matrix"], enabled: true },
  { id: "home", name: "Home", route: "/home", module: "La Matrix", status: "active", allowedRoles: ["authenticated"], previewStates: allPersonas.filter((p) => p !== "visitante"), entryPoints: ["login", "nav"], exits: ["matrix", "perfil", "creator-studio"], enabled: true },
  { id: "matrix", name: "La Matrix", route: "/matrix", module: "La Matrix", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["landing", "home", "perfil"], exits: ["players", "studios"], enabled: true },
  { id: "players", name: "Players", route: "/players", module: "Players", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["matrix"], exits: ["player-public"], enabled: true },
  { id: "perfil", name: "Mi perfil", route: "/perfil", module: "Mi Player", status: "active", allowedRoles: ["authenticated"], previewStates: allPersonas.filter((p) => p !== "visitante"), entryPoints: ["nav", "home"], exits: ["profile-edit", "avatar"], enabled: true },
  { id: "profile-edit", name: "Editor del Player", route: "/profile/edit", module: "Mi Player", status: "active", allowedRoles: ["authenticated"], previewStates: allPersonas.filter((p) => p !== "visitante"), entryPoints: ["perfil", "onboarding"], exits: ["matrix", "player-public"], enabled: true },
  { id: "avatar", name: "Avatar", route: "/mi-flow/avatar", module: "Avatar", status: "preview", allowedRoles: ["admin", "creator"], previewStates: ["creador", "vip", "admin"], entryPoints: ["perfil", "home"], exits: ["creator-studio"], enabled: true },
  { id: "creator-studio", name: "Creator Studio", route: "/creator-studio", module: "Creator Studio", status: "internal", allowedRoles: ["admin", "creator"], previewStates: ["creador", "vip", "admin"], entryPoints: ["home", "avatar"], exits: ["inventario", "avatar"], enabled: true },
  { id: "avatar-analyzer", name: "Analizador de avatar", route: "/avatar-analyzer-v4", module: "Workers y procesos", status: "internal", allowedRoles: ["admin"], previewStates: ["admin"], entryPoints: ["creator-studio"], exits: ["creator-studio"], enabled: true },
  { id: "studios", name: "Estudios", route: "/studios", module: "Estudios", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["matrix"], exits: ["studio-public", "studio-create"], enabled: true },
  { id: "studio-create", name: "Crear estudio", route: "/studios/create", module: "Estudios", status: "active", allowedRoles: ["authenticated"], previewStates: ["free", "vip", "creador", "admin"], entryPoints: ["studios"], exits: ["studio-dashboard"], enabled: true },
  { id: "studio-dashboard", name: "Panel del estudio", route: "/studio-dashboard", module: "Panel de estudios", status: "active", allowedRoles: ["studio_manager", "studio_owner", "admin"], previewStates: ["manager_estudio", "owner_estudio", "admin"], entryPoints: ["studio-public", "nav"], exits: ["studio-public"], enabled: true },
  { id: "vip", name: "Planes VIP", route: "/vip", module: "VIP", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["perfil", "onboarding"], exits: ["checkout", "profile-edit"], enabled: true },
  { id: "tienda", name: "Tienda", route: "/tienda", module: "Marketplace", status: "active", allowedRoles: ["public"], previewStates: allPersonas, entryPoints: ["nav", "matrix"], exits: ["producto", "checkout"], enabled: true },
  { id: "admin", name: "Centro de Control", route: "/admin", module: "Administración", status: "internal", allowedRoles: ["admin"], previewStates: ["admin"], entryPoints: ["nav"], exits: ["clouva-control"], enabled: true },
  { id: "clouva-control", name: "CLOUVA CONTROL", route: "/admin/clouva-control", module: "Administración", status: "internal", allowedRoles: ["admin"], previewStates: ["admin"], entryPoints: ["admin"], exits: ["download-apk"], enabled: true },
];

export const CLOUVA_FLOWS: ClouvaFlowDefinition[] = [
  {
    id: "onboarding",
    name: "Publicar primer Player",
    description: "Registro, identidad, publicación y salida real hacia La Matrix.",
    steps: [
      { label: "Registro", route: "/login", expected: "La cuenta queda autenticada" },
      { label: "Crear identidad", route: "/onboarding/identity", expected: "Se crea el Player" },
      { label: "Editar", route: "/profile/edit", expected: "El Player puede publicarse" },
      { label: "Plan Free", route: "/vip", expected: "Puede continuar sin pago" },
      { label: "Entrar a La Matrix", route: "/matrix", expected: "El onboarding queda cerrado" },
    ],
  },
  {
    id: "join-studio",
    name: "Unirse a un estudio",
    description: "Ingreso desde una página pública y adhesión gratuita al estudio.",
    steps: [
      { label: "Explorar estudios", route: "/studios", expected: "Se muestran estudios públicos" },
      { label: "Abrir estudio", route: "/studios/iglu", expected: "La página pública carga completa" },
      { label: "Unirse", route: "/studios/iglu/join", expected: "La membresía gratuita queda creada" },
      { label: "Volver al estudio", route: "/studios/iglu", expected: "El usuario aparece como miembro" },
    ],
  },
  {
    id: "creator-studio",
    name: "Creator Studio",
    description: "Creación, procesamiento, inventario y asignación al avatar.",
    steps: [
      { label: "Abrir Creator Studio", route: "/creator-studio", expected: "Carga el avatar activo" },
      { label: "Analizar avatar", route: "/avatar-analyzer-v4", expected: "El job expone progreso y diagnóstico" },
      { label: "Volver al creador", route: "/creator-studio", expected: "El resultado queda disponible" },
      { label: "Ver avatar", route: "/mi-flow/avatar", expected: "El recurso puede asignarse" },
    ],
  },
];

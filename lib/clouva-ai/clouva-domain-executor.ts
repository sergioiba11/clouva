import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";

export type ClouvaDomainServicePort = {
  getStudio(): Promise<unknown>;
  getStudioPlayers(): Promise<unknown>;
  getStudioIdentityVersions(): Promise<unknown>;
  updateStudioIdentityDraft(versionId: string, patch: {
    copyConfigJson?: string;
    layoutConfigJson?: string;
    visualConfigJson?: string;
  }): Promise<unknown>;
  updatePlayer(playerId: string, changes: {
    role?: string;
    secondaryRole?: string;
    customTitle?: string;
    description?: string;
    areaLabel?: string;
  }): Promise<unknown>;
  startPlayerProfileGeneration(playerId: string): Promise<unknown>;
};

function requireConfirmed(args: Record<string, unknown>) {
  if (args.confirm !== true) {
    throw new Error("Esta operación requiere confirmación humana desde CLOUVA AI.");
  }
}

/** Gemini sees domain verbs only. Supabase and table names never cross this
 * boundary; the injected server service owns authorization and persistence. */
export class ClouvaDomainExecutor extends BaseToolExecutor {
  readonly target = "clouva";
  protected readonly definitions: ToolDefinition[];

  constructor(private readonly service: ClouvaDomainServicePort) {
    super();
    this.definitions = [
      {
        name: "getStudio",
        description: "Obtiene los datos reales y el permiso activo del Estudio de esta conversación.",
        risk: "read",
        parameters: { type: "OBJECT", properties: {} },
        execute: async () => this.service.getStudio(),
      },
      {
        name: "getStudioPlayers",
        description: "Lista los Players realmente vinculados al Estudio, con su rol público y estado actual.",
        risk: "read",
        parameters: { type: "OBJECT", properties: {} },
        execute: async () => this.service.getStudioPlayers(),
      },
      {
        name: "getStudioIdentityVersions",
        description: "Obtiene la versión publicada inmutable y el draft activo de identidad del Estudio, con sus configuraciones canónicas.",
        risk: "read",
        parameters: { type: "OBJECT", properties: {} },
        execute: async () => this.service.getStudioIdentityVersions(),
      },
      {
        name: "updateStudioIdentityDraft",
        description: "Modifica exclusivamente el draft activo del Preview de identidad. Nunca cambia la versión publicada ni publica el draft.",
        risk: "write",
        parameters: {
          type: "OBJECT",
          properties: {
            versionId: { type: "STRING", description: "UUID exacto del draft obtenido con getStudioIdentityVersions." },
            copyConfigJson: { type: "STRING", description: "Objeto JSON parcial con textos canónicos: tagline, short_bio, seo_title, seo_description, share_title o share_description." },
            layoutConfigJson: { type: "STRING", description: "Objeto JSON completo del layout canónico modificado; debe preservar los assets vinculados al draft." },
            visualConfigJson: { type: "STRING", description: "Objeto JSON parcial con palette, visual_energy o visual_tone." },
          },
          required: ["versionId"],
        },
        execute: async (args) => {
          requireConfirmed(args);
          return this.service.updateStudioIdentityDraft(String(args.versionId), {
            copyConfigJson: typeof args.copyConfigJson === "string" ? args.copyConfigJson : undefined,
            layoutConfigJson: typeof args.layoutConfigJson === "string" ? args.layoutConfigJson : undefined,
            visualConfigJson: typeof args.visualConfigJson === "string" ? args.visualConfigJson : undefined,
          });
        },
      },
      {
        name: "updatePlayer",
        description: "Actualiza el rol o presentación de un Player dentro del Estudio activo; no modifica su identidad global.",
        risk: "write",
        parameters: {
          type: "OBJECT",
          properties: {
            playerId: { type: "STRING", description: "UUID del Player, obtenido con getStudioPlayers." },
            role: { type: "STRING", description: "Nuevo rol público principal dentro del Estudio." },
            secondaryRole: { type: "STRING", description: "Rol secundario; cadena vacía para quitarlo." },
            customTitle: { type: "STRING", description: "Título personalizado; cadena vacía para quitarlo." },
            description: { type: "STRING", description: "Descripción específica de la relación con el Estudio; cadena vacía para quitarla." },
            areaLabel: { type: "STRING", description: "Etiqueta pública del área; cadena vacía para quitarla." },
          },
          required: ["playerId"],
        },
        execute: async (args) => {
          requireConfirmed(args);
          return this.service.updatePlayer(String(args.playerId), {
            role: typeof args.role === "string" ? args.role : undefined,
            secondaryRole: typeof args.secondaryRole === "string" ? args.secondaryRole : undefined,
            customTitle: typeof args.customTitle === "string" ? args.customTitle : undefined,
            description: typeof args.description === "string" ? args.description : undefined,
            areaLabel: typeof args.areaLabel === "string" ? args.areaLabel : undefined,
          });
        },
      },
      {
        name: "startPlayerProfileGeneration",
        description: "Inicia el pipeline real CLOUVA AI Profile para un Player vinculado, sujeto a su permiso y beneficio VIP actuales.",
        risk: "sensitive",
        parameters: {
          type: "OBJECT",
          properties: {
            playerId: { type: "STRING", description: "UUID del Player, obtenido con getStudioPlayers." },
          },
          required: ["playerId"],
        },
        execute: async (args) => {
          requireConfirmed(args);
          return this.service.startPlayerProfileGeneration(String(args.playerId));
        },
      },
    ];
  }
}

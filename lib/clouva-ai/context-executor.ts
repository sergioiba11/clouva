import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";
import type { TrebolRuntimeContext } from "./agent/types";

type EmptyArgs = Record<string, never>;

export class ContextExecutor extends BaseToolExecutor {
  readonly target = "context";

  constructor(private readonly context: TrebolRuntimeContext) {
    super();
  }

  protected readonly definitions: ToolDefinition[] = [
    this.read("context.get_current", "Devuelve el snapshot sanitizado de la pantalla y el estado activo de CLOUVA.", () => this.context),
    this.read("ui.get_selection", "Devuelve el elemento de interfaz señalado por la persona, si existe.", () => this.context.ui.selectedElement ?? null),
    this.read("clouva.get_active_player", "Devuelve el identificador seguro del Player activo.", () => ({ playerId: this.context.active.playerId ?? null })),
    this.read("clouva.get_active_avatar", "Devuelve el identificador seguro del avatar activo.", () => ({ avatarId: this.context.active.avatarId ?? null })),
    this.read("clouva.get_active_studio", "Devuelve el identificador seguro del Estudio activo.", () => ({ studioId: this.context.active.studioId ?? null })),
    this.read("clouva.get_active_product", "Devuelve el identificador seguro del producto activo.", () => ({ productId: this.context.active.productId ?? null })),
    this.read("clouva.get_active_asset", "Devuelve el identificador seguro del asset activo.", () => ({ assetId: this.context.active.assetId ?? null })),
  ];

  private read(name: string, description: string, execute: () => unknown): ToolDefinition {
    return {
      name,
      description,
      risk: "read",
      parameters: { type: "OBJECT", properties: {} },
      execute: async (_args: EmptyArgs) => execute(),
    };
  }
}

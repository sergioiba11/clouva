import { BaseToolExecutor, type ToolDefinition } from "./tool-executor";
import type { TrebolMediaService } from "@/lib/server/trebol-media-service";

type GenerateImageArgs = {
  prompt: string;
  aspectRatio?: string;
  confirm?: boolean;
};

export class MediaExecutor extends BaseToolExecutor {
  readonly target = "media";

  constructor(
    private readonly service: TrebolMediaService,
    private readonly sourceMode: "text" | "live",
    private readonly conversationId: string | null,
  ) {
    super();
  }

  protected readonly definitions: ToolDefinition[] = [{
    name: "media.generate_image",
    description: "Genera y guarda una imagen real con el presupuesto administrado de CLOUVA. Requiere confirmación reforzada antes de incurrir en costo.",
    risk: "sensitive",
    parameters: {
      type: "OBJECT",
      properties: {
        prompt: { type: "STRING", description: "Descripción precisa de la imagen, hasta 4000 caracteres." },
        aspectRatio: { type: "STRING", description: "Relación: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3 o 21:9." },
      },
      required: ["prompt"],
    },
    execute: async (args: GenerateImageArgs) => {
      if (args.confirm !== true) throw new Error("La generación de imagen requiere confirmación reforzada del servidor.");
      return this.service.generateImage({
        prompt: args.prompt,
        aspectRatio: args.aspectRatio,
        transport: this.sourceMode,
        conversationId: this.conversationId,
      });
    },
  }];
}

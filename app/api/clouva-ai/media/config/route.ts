import { NextRequest, NextResponse } from "next/server";
import { getClouAIMediaConfig } from "@/lib/clouva-ai/media/config";
import { publicMediaError, requireMediaAdmin } from "@/lib/server/media-auth";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    await requireMediaAdmin(request);
    const config = getClouAIMediaConfig();
    return NextResponse.json({
      provider: "google-cloud",
      configured: Boolean(config.project && config.outputBucket),
      location: config.location,
      models: config.models,
      pricing: config.pricing,
      limits: { imageReferences: 14, videoReferences: 3, quantityDefault: 1, quantityMax: 4 },
      durations: [4, 6, 8],
      videoAspectRatios: ["16:9", "9:16"],
      imageAspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16", "21:9"],
      imageSizes: ["1K", "2K", "4K"],
      videoResolutions: ["720p", "1080p"],
    });
  } catch (error) {
    const mapped = publicMediaError(error);
    return NextResponse.json(mapped.body, { status: mapped.status });
  }
}

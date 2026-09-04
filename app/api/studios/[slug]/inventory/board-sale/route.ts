import { NextRequest, NextResponse } from "next/server";
import { createAdminSupabase, isAuthError, requireUser } from "@/lib/server/supabase";
import { requireSpaceInventoryAccess, resolveSpaceForStudio } from "@/lib/server/space-inventory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { user } = await requireUser(request);
    const { slug: studioId } = await params;
    const body = (await request.json().catch(() => ({}))) as { boardId?: unknown; quantity?: unknown; note?: unknown; commerceOrderId?: unknown };
    const boardId = typeof body.boardId === "string" ? body.boardId.trim() : "";
    const quantity = Number(body.quantity ?? 1);
    if (!boardId || !Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "Venta inválida." }, { status: 400 });

    const admin = createAdminSupabase();
    const space = await resolveSpaceForStudio({ admin, studioId });
    await requireSpaceInventoryAccess({ admin, userId: user.id, spaceId: space.id, capability: "sales" });

    const { data, error } = await admin.rpc("record_space_board_sale", {
      p_board_entry_id: boardId,
      p_quantity: quantity,
      p_actor_user_id: user.id,
      p_note: typeof body.note === "string" ? body.note.trim().slice(0, 500) || null : null,
      p_commerce_order_id: typeof body.commerceOrderId === "string" && body.commerceOrderId.trim() ? body.commerceOrderId.trim() : null,
    });
    if (error) throw new Error(error.message);
    return NextResponse.json({ event: data });
  } catch (error) {
    const status = (error as Error & { status?: number })?.status ?? (isAuthError(error) ? 401 : 500);
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo registrar la venta." }, { status });
  }
}

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function retired() {
  return NextResponse.json(
    {
      error: "La emisión manual de FLOWS fue retirada. Registrá un pago real en efectivo desde /admin/flows/pagos-manuales.",
      replacement: "/api/admin/flows/cash-payment",
    },
    { status: 410 },
  );
}

export async function POST() {
  return retired();
}

export async function GET() {
  return retired();
}

import { createHmac, timingSafeEqual } from "node:crypto";

function parseSignature(header: string) {
  const values = Object.fromEntries(
    header.split(",").map((part) => {
      const [key, ...rest] = part.trim().split("=");
      return [key, rest.join("=")];
    }),
  );
  return { timestamp: values.ts || "", signature: values.v1 || "" };
}

export function verifyMercadoPagoSignature(args: {
  xSignature: string;
  xRequestId: string;
  dataId: string;
  secret: string;
}) {
  const { timestamp, signature } = parseSignature(args.xSignature);
  if (!timestamp || !signature || !args.xRequestId || !args.dataId || !args.secret) return false;

  const normalizedDataId = args.dataId.toLowerCase();
  const manifest = `id:${normalizedDataId};request-id:${args.xRequestId};ts:${timestamp};`;
  const expected = createHmac("sha256", args.secret).update(manifest).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;

  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(signature, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

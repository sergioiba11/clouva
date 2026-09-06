export type ExternalQrNetwork = "mercado_pago" | "argentina_interoperable" | "emvco";

export type ExternalQrDetection = {
  kind: "external_payment_qr";
  network: ExternalQrNetwork;
  countryCode: string | null;
  payable: false;
  executionStatus: "not_authorized";
  dependency: string;
  reason: string;
};

function looksLikeEmvPaymentQr(value: string) {
  return /^00020[12]/.test(value) && /6304[0-9A-F]{4}$/i.test(value);
}

export function detectExternalPaymentQr(raw: string): ExternalQrDetection | null {
  const value = raw.trim();
  if (!value || !looksLikeEmvPaymentQr(value)) return null;

  const countryCode = value.match(/5802([A-Z]{2})/)?.[1] ?? null;
  const mercadoPago = /com\.mercadolibre/i.test(value) || /https?:\/\/mpago\.la\/pos\//i.test(value);

  if (mercadoPago) {
    return {
      kind: "external_payment_qr",
      network: "mercado_pago",
      countryCode,
      payable: false,
      executionStatus: "not_authorized",
      dependency: "MERCADO_PAGO_INTEROPERABLE_ONBOARDING",
      reason: "CLOUVA detectó un QR interoperable de Mercado Pago, pero no debe ejecutar un pago sin credenciales de billetera, homologación y un rail de fondos autorizado.",
    };
  }

  if (countryCode === "AR") {
    return {
      kind: "external_payment_qr",
      network: "argentina_interoperable",
      countryCode,
      payable: false,
      executionStatus: "not_authorized",
      dependency: "ARGENTINA_INTEROPERABLE_WALLET_OR_PSP_RAIL",
      reason: "CLOUVA detectó un QR de pago argentino compatible con el formato interoperable, pero FLOW no es por sí solo un rail CBU/CVU/tarjeta habilitado para liquidar ese pago.",
    };
  }

  return {
    kind: "external_payment_qr",
    network: "emvco",
    countryCode,
    payable: false,
    executionStatus: "not_authorized",
    dependency: "SUPPORTED_EXTERNAL_PAYMENT_RAIL",
    reason: "CLOUVA detectó un QR de pago externo, pero no hay un proveedor autorizado configurado para ejecutarlo.",
  };
}

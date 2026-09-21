import type {
  MerchantQrCreatePaymentInput,
  MerchantQrPayment,
  MerchantQrPaymentRail,
  MerchantQrRailStatus,
  MerchantQrResolution,
} from "../../merchant-qr";
import { getBindQrConfig, getBindQrReadiness, type BindQrConfig } from "./config";
import { getBindQrAccessToken } from "./token";

type BindQrResolveResponse = {
  status?: string;
  identification_number?: string;
  administrator?: { name?: string; identification_number?: string } | null;
  collector?: {
    name?: string;
    identification_number?: string;
    account?: string;
    mcc?: string;
    bank?: string;
    branch_office?: string;
    terminal?: string;
  } | null;
  order?: {
    id?: string;
    total_amount?: number | string | null;
    items?: Array<Record<string, unknown>>;
  } | null;
  retry_delay?: number | null;
};

type BindPaymentCreateResponse = {
  operacionId?: number | string;
  operacionIdExterno?: string | null;
  estadoId?: number;
  estadoExterno?: string | null;
  importe?: number | string;
  vendedorNombre?: string | null;
  vendedorCbuCvu?: string | null;
  vendedorCuit?: string | null;
};

type BindOperationResponse = {
  id?: number | string;
  estadoOperacionId?: number;
  importe?: number | string;
  idExterno?: string | null;
  detalle?: Array<{ nombre?: string; valor?: string | null }>;
};

function normalizeBindStatus(statusId: number | undefined): MerchantQrRailStatus {
  switch (statusId) {
    case 2:
      return "confirmed";
    case 3:
      return "failed";
    case 6:
      return "refunded";
    case 7:
      return "partially_refunded";
    case 1:
    case 4:
    case 5:
      return "pending";
    default:
      return "unknown";
  }
}

function decimalString(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return String(value);
}

function detailValue(operation: BindOperationResponse, name: string) {
  return operation.detalle?.find((entry) => entry.nombre === name)?.valor ?? null;
}

export class BindMerchantQrRail implements MerchantQrPaymentRail {
  readonly name = "bind_psp";

  constructor(private readonly config: BindQrConfig = getBindQrConfig()) {}

  capabilities() {
    const readiness = getBindQrReadiness(this.config);
    return {
      provider: this.name,
      country: "AR" as const,
      currency: "ARS" as const,
      methods: ["PCT" as const],
      qrStandard: "Transferencias 3.0" as const,
      canResolve: readiness.configured,
      canPay: readiness.paymentExecutionReady,
      canRefund: true,
      sandboxAvailable: true,
      productionEnabled: readiness.productionEnabled,
    };
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await getBindQrAccessToken(this.config);
    const response = await fetch(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init?.body ? { "content-type": "application/json" } : {}),
        ...(init?.headers ?? {}),
      },
      cache: "no-store",
    });

    const body = (await response.json().catch(() => null)) as T | { message?: string; error?: string } | null;
    if (!response.ok) {
      const safeMessage = body && typeof body === "object" && ("message" in body || "error" in body)
        ? String((body as { message?: string; error?: string }).message || (body as { message?: string; error?: string }).error || `HTTP ${response.status}`)
        : `HTTP ${response.status}`;
      throw new Error(`BIND PSP QR rechazó la operación (${safeMessage}).`);
    }
    if (!body) throw new Error("BIND PSP QR respondió sin cuerpo.");
    return body as T;
  }

  async resolveQr(rawQr: string): Promise<MerchantQrResolution> {
    const qr = rawQr.trim();
    if (!qr || qr.length > 4096) throw new Error("QR vacío o demasiado largo.");

    const response = await this.request<BindQrResolveResponse>(
      `/walletentidad-operaciones/v1/api/v1.201/QR/GetInfoPagoQR?textoQR=${encodeURIComponent(qr)}`,
      { method: "GET" },
    );

    const rawStatus = response.status?.trim().toLowerCase() || "unknown";
    const status: MerchantQrResolution["status"] = rawStatus === "open_amount" || rawStatus === "closed_amount" || rawStatus === "pending"
      ? rawStatus
      : rawStatus.includes("unsupported") || rawStatus.includes("invalid")
        ? "unsupported"
        : "unknown";

    const collector = response.collector?.account && response.collector.identification_number && response.collector.name
      ? {
          name: response.collector.name,
          identificationNumber: response.collector.identification_number,
          account: response.collector.account,
          mcc: response.collector.mcc ?? null,
          bank: response.collector.bank ?? null,
          branchOffice: response.collector.branch_office ?? null,
          terminal: response.collector.terminal ?? null,
        }
      : null;

    const order = response.order?.id
      ? {
          id: response.order.id,
          totalAmount: decimalString(response.order.total_amount),
          items: response.order.items ?? [],
        }
      : null;

    return {
      provider: this.name,
      status,
      administrator: response.administrator?.name ?? response.identification_number ?? null,
      collector,
      order,
      retryDelaySeconds: response.retry_delay ?? null,
      rawStatus,
    };
  }

  async createMerchantPayment(input: MerchantQrCreatePaymentInput): Promise<MerchantQrPayment> {
    const readiness = getBindQrReadiness(this.config);
    if (!readiness.paymentExecutionReady) {
      throw new Error("BIND PSP QR está preparado pero la ejecución permanece deshabilitada hasta completar onboarding/homologación y fondeo del CVU.");
    }
    if (input.currency !== "ARS") throw new Error("BIND PSP QR solo está configurado para ARS.");
    if (input.resolution.provider !== this.name) throw new Error("La resolución QR no pertenece al rail BIND PSP.");
    if (!input.resolution.collector || !input.resolution.order?.id) throw new Error("La resolución QR no contiene comercio y orden suficientes para instruir el PCT.");

    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Importe QR inválido.");
    if (input.resolution.status === "closed_amount") {
      const resolvedAmount = Number(input.resolution.order.totalAmount);
      if (!Number.isFinite(resolvedAmount) || Math.abs(resolvedAmount - amount) > 0.000001) {
        throw new Error("El importe no coincide con el monto cerrado resuelto por el aceptador.");
      }
    }

    const idExterno = input.operationId.trim();
    if (!idExterno || idExterno.length > 50) throw new Error("operationId inválido para BIND PSP.");

    const response = await this.request<BindPaymentCreateResponse>(
      "/walletentidad-operaciones/v1/api/v1.201/pagoQR",
      {
        method: "POST",
        body: JSON.stringify({
          cvuOrigen: this.config.originCvu,
          cuitOrigen: this.config.originCuit,
          cbuCvuVendedor: input.resolution.collector.account,
          cuitVendedor: input.resolution.collector.identificationNumber,
          transaccionId: input.resolution.order.id,
          importe: amount,
          descripcion: input.description ?? "Pago QR CLOUVA",
          textoQR: input.rawQr,
          idExterno,
        }),
      },
    );

    if (response.operacionId === undefined || response.operacionId === null) {
      throw new Error("BIND PSP no devolvió operacionId para el pago QR.");
    }

    return {
      provider: this.name,
      providerOperationId: String(response.operacionId),
      providerExternalId: response.operacionIdExterno ?? null,
      coelsaId: response.operacionIdExterno ?? null,
      status: normalizeBindStatus(response.estadoId),
      rawStatus: response.estadoExterno ?? null,
      amount: decimalString(response.importe) ?? input.amount,
      currency: "ARS",
      merchantName: response.vendedorNombre ?? input.resolution.collector.name,
      merchantAccount: response.vendedorCbuCvu ?? input.resolution.collector.account,
      merchantIdentificationNumber: response.vendedorCuit ?? input.resolution.collector.identificationNumber,
      rejectionReason: null,
    };
  }

  async getMerchantPayment(providerOperationId: string): Promise<MerchantQrPayment> {
    const id = providerOperationId.trim();
    if (!/^\d+$/.test(id)) throw new Error("operacionId de BIND PSP inválido.");
    const operation = await this.request<BindOperationResponse>(
      `/walletentidad-operaciones/v1/api/v1.201/Operacion/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    return this.mapOperation(operation);
  }

  async getMerchantPaymentByExternalId(externalId: string): Promise<MerchantQrPayment> {
    const id = externalId.trim();
    if (!id || id.length > 50) throw new Error("idExterno de BIND PSP inválido.");
    const operation = await this.request<BindOperationResponse>(
      `/walletentidad-operaciones/v1/api/v1.201/OperacionByIdExterno/${encodeURIComponent(id)}`,
      { method: "GET" },
    );
    return this.mapOperation(operation);
  }

  private mapOperation(operation: BindOperationResponse): MerchantQrPayment {
    if (operation.id === undefined || operation.id === null) throw new Error("Operación BIND PSP sin identificador.");
    const amount = decimalString(operation.importe);
    if (amount === null) throw new Error("Operación BIND PSP sin importe válido.");

    return {
      provider: this.name,
      providerOperationId: String(operation.id),
      providerExternalId: operation.idExterno ?? null,
      coelsaId: detailValue(operation, "CoelsaId"),
      status: normalizeBindStatus(operation.estadoOperacionId),
      rawStatus: detailValue(operation, "EstadoCoelsa"),
      amount,
      currency: "ARS",
      merchantName: detailValue(operation, "VendedorNombre"),
      merchantAccount: detailValue(operation, "VendedorCbuCvu"),
      merchantIdentificationNumber: detailValue(operation, "VendedorCuit"),
      rejectionReason: detailValue(operation, "MotivoRechazo"),
    };
  }
}

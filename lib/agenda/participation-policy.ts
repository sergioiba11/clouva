export type AgendaConnectionStatus = "pending" | "active" | "declined" | "revoked" | null;

export function isSelectableAgendaMember(status: AgendaConnectionStatus | string | undefined) {
  return status === "active" || status === "pending";
}

export function shouldDeliverAgendaInvitation(status: AgendaConnectionStatus | string | undefined) {
  return status == null || status === "declined" || status === "revoked";
}

export function eventProjectionForConnection(status: AgendaConnectionStatus | string | undefined) {
  if (status === "active") return { rsvpStatus: "accepted" as const, projectToAgenda: true };
  if (status === "declined" || status === "revoked") return { rsvpStatus: "declined" as const, projectToAgenda: false };
  return { rsvpStatus: "pending" as const, projectToAgenda: false };
}

export function signedDirection(amount: number) {
  return amount < 0 ? "debit" as const : "credit" as const;
}

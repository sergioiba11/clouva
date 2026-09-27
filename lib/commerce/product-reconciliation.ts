/** One physical identity per card; invoice originals remain immutable. */
export type EvidenceRole = "front" | "back" | "code" | "other";
export type ReconciliationGroup = {
  groupKey: string; name: string; brand: string; model?: string; unitCount: number;
  needsReview?: boolean;
  images: { sourceIndex: number; role: string; evidenceRole?: EvidenceRole }[];
  visibleIdentifiers?: { value: string; type: string; sourceIndex?: number }[];
  requiredImageRoles?: EvidenceRole[];
};
export type ReconciliationLine = {
  id: string; line_number: number; description: string; brand?: string | null;
  model?: string | null; quantity: number; unit_price: number | null; line_total?: number | null;
  matched_group_keys: string[]; match_status?: string;
};
export type ReconciliationDecision = {
  id: string; kind: "reassign" | "extra" | "review" | "shortage";
  groupKey?: string; lineId?: string; quantity: number;
  signature: string; actorId: string; createdAt: string;
};
export type Allocation = { lineId: string; quantity: number; reassigned: boolean };
export type ProductReconciliation = {
  groupKey: string; name: string; physical: number; expected: number;
  extra: number; shortage: number; unbilled: number; allocations: Allocation[];
  images: Record<EvidenceRole, number[]>; missingImages: EvidenceRole[];
  pending: boolean; reviewRequired: boolean; signature: string;
  candidates: { lineId: string; name: string; deficit: number; score: number; suggested: boolean }[];
};
export type ReconciliationReport = {
  products: ProductReconciliation[];
  lines: { id: string; name: string; original: number; transferred: number; physical: number; deficit: number; pending: boolean; signature: string }[];
  pending: number; staleDecisions: number; hasInvoice: boolean;
  totals: { expected: number; physical: number; extra: number; shortage: number };
};
const units = (value: number) => Math.max(0, Number(value) || 0);
export function normalizeProductText(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/\b(?:type[ -]?c|tipo[ -]?c|tc|usb[ -]?c)\b/g, " usbc ")
    .replace(/\b(?:auriculares?|headset|earphones?)\b/g, " auricular ")
    .replace(/\b(?:charger|carregador|adapter)\b/g, " cargador ")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const genericBrands = new Set(["", "generic", "generico", "mixed brands", "unknown", "sin marca"]);
export function invoiceBrandConflict(line: { description: string; brand?: string | null }, group: { brand: string }, brands: string[] = []) {
  const detected = normalizeProductText(group.brand);
  if (genericBrands.has(detected)) return false;
  const explicit = normalizeProductText(line.brand || "");
  if (!genericBrands.has(explicit)) return explicit !== detected;
  const description = ` ${normalizeProductText(line.description)} `;
  return [...brands, "Samsung", "Motorola", "Apple", "Sony"]
    .map(normalizeProductText).some(brand => !genericBrands.has(brand) && brand !== detected && description.includes(` ${brand} `));
}
export function compatibility(line: ReconciliationLine, group: ReconciliationGroup) {
  const left = normalizeProductText(`${line.description} ${line.model || ""}`);
  const right = normalizeProductText(`${group.name} ${group.model || ""}`);
  const kinds = ["cable", "cargador", "joystick", "controller", "auricular", "wifi"];
  const kind = (text: string) => kinds.find(word => text.includes(word))?.replace("controller", "joystick");
  const a = kind(left), b = kind(right);
  if (a && b && a !== b) return 0;
  const stop = new Set(["de", "para", "con", "usb", "the", "to", "tipo", "power", "turbo"]);
  const tokens = new Set(left.split(" ").filter(token => token.length > 2 && !stop.has(token)));
  const shared = [...tokens].filter(token => right.split(" ").includes(token)).length;
  return Math.min(1, (a && a === b ? 0.5 : 0) + (tokens.size ? shared / tokens.size * 0.5 : 0));
}
function signature(value: unknown) { return JSON.stringify(value); }
export function reconciliationBasis(groups: ReconciliationGroup[], lines: ReconciliationLine[]) {
  return signature({ groups: groups.map(g => [g.groupKey, g.name, g.brand, g.model, g.unitCount, g.needsReview]),
    lines: lines.map(l => [l.id, l.description, l.brand, l.quantity, l.unit_price, l.line_total, l.matched_group_keys, l.match_status]) });
}
export function reconcileProducts(groups: ReconciliationGroup[], invoiceLines: ReconciliationLine[], decisions: ReconciliationDecision[] = [], hasInvoice = true): ReconciliationReport {
  const basis = reconciliationBasis(groups, invoiceLines);
  const brands = groups.map(g => g.brand);
  const allocation = new Map(groups.map(g => [g.groupKey, [] as Allocation[]]));
  const remaining = new Map(invoiceLines.map(l => [l.id, units(l.quantity)]));
  const transfers = new Map<string, number>();
  const extraConfirmed = new Map<string, number>();
  let staleDecisions = 0;
  // Transfers reserve invoice capacity before automatic identity matching.
  for (const d of decisions.filter(d => d.kind === "reassign" || d.kind === "extra")) {
    const group = groups.find(g => g.groupKey === d.groupKey);
    if (d.signature !== basis || !group || !Number.isInteger(d.quantity) || d.quantity <= 0) { staleDecisions++; continue; }
    const assigned = (allocation.get(group.groupKey) || []).reduce((s, a) => s + a.quantity, 0) + (extraConfirmed.get(group.groupKey) || 0);
    if (assigned + d.quantity > units(group.unitCount)) { staleDecisions++; continue; }
    if (d.kind === "extra") { extraConfirmed.set(group.groupKey, (extraConfirmed.get(group.groupKey) || 0) + d.quantity); continue; }
    if (!d.lineId || !remaining.has(d.lineId) || remaining.get(d.lineId)! < d.quantity) { staleDecisions++; continue; }
    allocation.get(group.groupKey)!.push({ lineId: d.lineId, quantity: d.quantity, reassigned: true });
    remaining.set(d.lineId, remaining.get(d.lineId)! - d.quantity);
    transfers.set(d.lineId, (transfers.get(d.lineId) || 0) + d.quantity);
  }
  const expected = new Map(groups.map(g => [g.groupKey, (allocation.get(g.groupKey) || []).reduce((s, a) => s + a.quantity, 0)]));
  const eligibleByLine = new Map<string, ReconciliationGroup[]>();
  for (const line of invoiceLines) {
    const eligible = groups.filter(g => line.matched_group_keys.includes(g.groupKey) && !invoiceBrandConflict(line, g, brands));
    eligibleByLine.set(line.id, eligible);
    for (const group of eligible) {
      const allocated = allocation.get(group.groupKey)!;
      const capacity = Math.max(0, units(group.unitCount) - allocated.reduce((s, a) => s + a.quantity, 0) - (extraConfirmed.get(group.groupKey) || 0));
      const take = Math.min(remaining.get(line.id)!, capacity);
      if (take > 0) {
        allocated.push({ lineId: line.id, quantity: take, reassigned: false });
        expected.set(group.groupKey, expected.get(group.groupKey)! + take);
        remaining.set(line.id, remaining.get(line.id)! - take);
      }
    }
    // A deficit stays attached to its physical product instead of vanishing globally.
    if (eligible.length && remaining.get(line.id)! > 0) {
      expected.set(eligible[0].groupKey, expected.get(eligible[0].groupKey)! + remaining.get(line.id)!);
    }
  }
  const lines = invoiceLines.map(line => {
    const deficit = remaining.get(line.id)!;
    const sig = signature([basis, line.id, deficit, transfers.get(line.id) || 0]);
    return { id: line.id, name: line.description, original: units(line.quantity), transferred: transfers.get(line.id) || 0,
      physical: units(line.quantity) - deficit, deficit, signature: sig,
      pending: deficit > 0 && !decisions.some(d => d.kind === "shortage" && d.lineId === line.id && d.signature === sig) };
  });
  const products = groups.map(group => {
    const allocations = allocation.get(group.groupKey)!;
    const physical = units(group.unitCount), exp = expected.get(group.groupKey)!;
    const extra = hasInvoice ? Math.max(0, physical - exp) : 0;
    const images: Record<EvidenceRole, number[]> = { front: [], back: [], code: [], other: [] };
    const owned = new Set(group.images.map(img => img.sourceIndex));
    const codeIndexes = new Set((group.visibleIdentifiers || []).flatMap(c => c.sourceIndex != null && owned.has(c.sourceIndex) ? [c.sourceIndex] : []));
    for (const img of group.images) {
      const role = img.evidenceRole || (img.role === "Frente" ? "front" : img.role === "Atrás" ? "back" : "other");
      images[role].push(img.sourceIndex);
      if (codeIndexes.has(img.sourceIndex) && role !== "code") images.code.push(img.sourceIndex);
    }
    const required = group.requiredImageRoles || ["front", "back", "code"];
    const missingImages = required.filter(role => !images[role].length);
    const reviewRequired = Boolean(group.needsReview || !group.name || allocations.some(a => invoiceLines.find(l => l.id === a.lineId)?.match_status === "ambiguous"));
    const sig = signature([basis, group.groupKey, allocations, exp, extra, reviewRequired, extraConfirmed.get(group.groupKey) || 0]);
    const reviewed = decisions.some(d => d.kind === "review" && d.groupKey === group.groupKey && d.signature === sig);
    const unbilled = extraConfirmed.get(group.groupKey) || 0;
    const candidates = invoiceLines.filter(line => !eligibleByLine.get(line.id)?.some(g => g.groupKey === group.groupKey))
      .map(line => ({ lineId: line.id, name: line.description, deficit: remaining.get(line.id)!, score: Math.max(compatibility(line, group), ...(eligibleByLine.get(line.id) || []).map(peer => compatibility({ ...line, description: peer.name, model: peer.model }, group))), suggested: false }))
      .filter(c => c.score >= 0.35 && units(invoiceLines.find(l => l.id === c.lineId)!.quantity) > (transfers.get(c.lineId) || 0))
      .map(c => ({ ...c, suggested: c.deficit > 0 && c.score >= 0.5 }))
      .sort((a, b) => Number(b.suggested) - Number(a.suggested) || b.score - a.score || b.deficit - a.deficit);
    const hasIdentityLine = (exp > 0 || invoiceLines.some(l => eligibleByLine.get(l.id)?.some(g => g.groupKey === group.groupKey)));
    return { groupKey: group.groupKey, name: group.name || "Producto", physical, expected: exp, extra,
      shortage: Math.max(0, exp - physical), allocations, images, missingImages, reviewRequired, signature: sig, unbilled,
      pending: (reviewRequired && !reviewed) || (extra > unbilled && !(hasIdentityLine && reviewed)), candidates };
  });
  return { products, lines, hasInvoice, staleDecisions,
    pending: products.filter(p => p.pending).length + lines.filter(l => l.pending).length,
    totals: { expected: invoiceLines.reduce((s, l) => s + units(l.quantity), 0), physical: products.reduce((s, p) => s + p.physical, 0),
      extra: products.reduce((s, p) => s + p.extra, 0), shortage: lines.reduce((s, l) => s + l.deficit, 0) } };
}
export function applyReconciliationDecision(args: {
  groups: ReconciliationGroup[]; lines: ReconciliationLine[]; decisions: ReconciliationDecision[];
  kind: ReconciliationDecision["kind"]; groupKey?: string; lineId?: string; quantity?: number; id: string; actorId: string; now: string;
}) {
  const report = reconcileProducts(args.groups, args.lines, args.decisions);
  const product = report.products.find(p => p.groupKey === args.groupKey);
  const line = report.lines.find(l => l.id === args.lineId);
  const basis = reconciliationBasis(args.groups, args.lines);
  const quantity = args.quantity ?? 1;
  if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Cantidad inválida.");
  let sig = basis;
  if (args.kind === "reassign") {
    if (!product || !line || product.extra - product.unbilled < quantity || !product.candidates.some(c => c.lineId === line.id)) throw new Error("La reasignación ya no coincide. Revisá el producto.");
    if (line.original - line.transferred < quantity) throw new Error("La línea no tiene unidades disponibles.");
  } else if (args.kind === "extra") {
    if (!product || product.extra - product.unbilled < quantity) throw new Error("No hay esa cantidad de unidades extra.");
  } else if (args.kind === "review") {
    if (!product) throw new Error("Producto inexistente.");
    if (product.extra > product.unbilled && product.expected === 0) throw new Error("Indicá dónde se cobró o ingresalo como extra.");
    sig = product.signature;
  } else if (args.kind === "shortage") {
    if (!line || !line.deficit) throw new Error("No hay faltante en esta línea.");
    sig = line.signature;
  } else throw new Error("Acción inválida.");
  const decision: ReconciliationDecision = { id: args.id, kind: args.kind, groupKey: args.groupKey, lineId: args.lineId, quantity, signature: sig, actorId: args.actorId, createdAt: args.now };
  return [...args.decisions, decision];
}

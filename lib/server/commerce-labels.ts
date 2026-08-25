import { deflateSync } from "node:zlib";
import bwipjs from "bwip-js/node";
import QRCode from "qrcode";
import sharp from "sharp";

export type CommerceLabelFormat = "svg" | "png" | "pdf";
export type CommerceLabelLayout = "barcode" | "qr" | "combined" | "full";
export type CommerceLabelPage = "label" | "a4";
export type CommerceLabelSize = "30x20" | "40x30" | "50x30";

export type CommerceLabelRecord = {
  productName: string;
  variantLabel?: string | null;
  sku?: string | null;
  price?: number | null;
  currency?: string | null;
  barcode?: { type: string; value: string } | null;
  qr?: { value: string } | null;
};

export type CommerceLabelOptions = {
  format: CommerceLabelFormat;
  layout: CommerceLabelLayout;
  page: CommerceLabelPage;
  size: CommerceLabelSize;
  copies: number;
  marginMm: number;
  showPrice: boolean;
  showSku: boolean;
  showQr: boolean;
};

const SIZE_MM: Record<CommerceLabelSize, { width: number; height: number }> = {
  "30x20": { width: 30, height: 20 },
  "40x30": { width: 40, height: 30 },
  "50x30": { width: 50, height: 30 },
};

function escapeXml(value: string) {
  return value.replace(/[<>&"']/g, (character) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  })[character] ?? character);
}

function svgParts(svg: string) {
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 100 100";
  const inner = svg
    .replace(/<\?xml[^>]*>/g, "")
    .replace(/<!DOCTYPE[^>]*>/g, "")
    .replace(/^\s*<svg[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "");
  return { viewBox, inner };
}

function barcodeSymbology(type: string) {
  if (type === "ean_13") return "ean13";
  if (type === "ean_8") return "ean8";
  if (type === "upc_a") return "upca";
  if (type === "upc_e") return "upce";
  return "code128";
}

function money(value: number, currency: string) {
  return new Intl.NumberFormat("es-AR", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(value);
}

export async function renderCommerceLabelSvg(record: CommerceLabelRecord, options: CommerceLabelOptions) {
  const mm = SIZE_MM[options.size];
  const width = mm.width * 10;
  const height = mm.height * 10;
  const compact = options.size === "30x20";
  const headerHeight = options.layout === "full" ? (compact ? 48 : 62) : 18;
  const label = [record.variantLabel].filter(Boolean).join(" · ");
  const barcodeSource = record.barcode;
  const qrSource = options.showQr ? record.qr : null;

  const barcode = barcodeSource
    ? svgParts(bwipjs.toSVG({
        bcid: barcodeSymbology(barcodeSource.type),
        text: barcodeSource.value,
        scale: 3,
        height: compact ? 8 : 11,
        includetext: true,
        textxalign: "center",
        backgroundcolor: "FFFFFF",
      }))
    : null;
  const qr = qrSource
    ? svgParts(await QRCode.toString(qrSource.value, {
        type: "svg",
        margin: 0,
        errorCorrectionLevel: "M",
      }))
    : null;

  const codeTop = headerHeight + 10;
  const codeHeight = height - codeTop - 12;
  const qrOnly = options.layout === "qr";
  const barcodeOnly = options.layout === "barcode";
  const combined = options.layout === "combined" || options.layout === "full";
  const qrSize = Math.max(60, Math.min(codeHeight, combined ? width * 0.3 : width * 0.72));
  const qrX = qrOnly ? (width - qrSize) / 2 : width - qrSize - 12;
  const barcodeWidth = barcodeOnly ? width - 24 : width - qrSize - 34;

  const details = options.layout === "full" ? `
    <text x="12" y="20" font-family="Arial,sans-serif" font-size="12" font-weight="700" letter-spacing="1.1">EL IGLÚ</text>
    <text x="12" y="36" font-family="Arial,sans-serif" font-size="${compact ? 12 : 14}" font-weight="700">${escapeXml(record.productName)}</text>
    ${label ? `<text x="12" y="${compact ? 49 : 52}" font-family="Arial,sans-serif" font-size="10" fill="#333">${escapeXml(label)}</text>` : ""}
    ${options.showSku && record.sku ? `<text x="${width - 12}" y="20" text-anchor="end" font-family="Arial,sans-serif" font-size="9" fill="#333">${escapeXml(record.sku)}</text>` : ""}
    ${options.showPrice && record.price != null ? `<text x="${width - 12}" y="${compact ? 49 : 52}" text-anchor="end" font-family="Arial,sans-serif" font-size="11" font-weight="700">${escapeXml(money(record.price, record.currency || "ARS"))}</text>` : ""}
  ` : `<text x="10" y="14" font-family="Arial,sans-serif" font-size="9" font-weight="700">EL IGLÚ · ${escapeXml(record.productName)}</text>`;

  const barcodeNode = barcode && !qrOnly
    ? `<svg x="12" y="${codeTop}" width="${Math.max(40, barcodeWidth)}" height="${codeHeight}" viewBox="${barcode.viewBox}" preserveAspectRatio="xMidYMid meet">${barcode.inner}</svg>`
    : "";
  const qrNode = qr && !barcodeOnly
    ? `<svg x="${qrX}" y="${codeTop + Math.max(0, (codeHeight - qrSize) / 2)}" width="${qrSize}" height="${qrSize}" viewBox="${qr.viewBox}" shape-rendering="crispEdges">${qr.inner}</svg>`
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${mm.width}mm" height="${mm.height}mm" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" rx="8" fill="#fff"/>
    <rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="7" fill="none" stroke="#111" stroke-width="1"/>
    ${details}
    ${barcodeNode}
    ${qrNode}
    ${!barcodeNode && !qrNode ? `<text x="${width / 2}" y="${height / 2}" text-anchor="middle" font-family="Arial,sans-serif" font-size="12">Sin código activo</text>` : ""}
  </svg>`;
}

export async function renderCommerceLabelPng(svg: string) {
  return sharp(Buffer.from(svg), { density: 300 }).flatten({ background: "#ffffff" }).png().toBuffer();
}

function mmToPt(value: number) {
  return value * 72 / 25.4;
}

type PdfImage = { width: number; height: number; data: Buffer };

async function svgToPdfImage(svg: string): Promise<PdfImage> {
  const result = await sharp(Buffer.from(svg), { density: 300 })
    .flatten({ background: "#ffffff" })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: result.info.width, height: result.info.height, data: deflateSync(result.data) };
}

function pdfStream(dictionary: string, body: Buffer) {
  return Buffer.concat([
    Buffer.from(`<< ${dictionary} /Length ${body.length} >>\nstream\n`, "binary"),
    body,
    Buffer.from("\nendstream", "binary"),
  ]);
}

export async function renderCommerceLabelsPdf(svgs: string[], options: CommerceLabelOptions) {
  const mm = SIZE_MM[options.size];
  const labelWidth = mmToPt(mm.width);
  const labelHeight = mmToPt(mm.height);
  const images = await Promise.all(svgs.map(svgToPdfImage));
  const expanded = images.flatMap((image) => Array.from({ length: Math.max(1, options.copies) }, () => image));
  const pageWidth = options.page === "a4" ? mmToPt(210) : labelWidth;
  const pageHeight = options.page === "a4" ? mmToPt(297) : labelHeight;
  const margin = options.page === "a4" ? mmToPt(options.marginMm) : 0;
  const columns = options.page === "a4" ? Math.max(1, Math.floor((pageWidth - margin * 2) / labelWidth)) : 1;
  const rows = options.page === "a4" ? Math.max(1, Math.floor((pageHeight - margin * 2) / labelHeight)) : 1;
  const perPage = columns * rows;
  const pages = Array.from({ length: Math.max(1, Math.ceil(expanded.length / perPage)) }, (_, index) => expanded.slice(index * perPage, (index + 1) * perPage));

  const objects: Array<Buffer | null> = [null];
  const reserve = () => { objects.push(null); return objects.length - 1; };
  const add = (value: string | Buffer) => { objects.push(typeof value === "string" ? Buffer.from(value, "binary") : value); return objects.length - 1; };
  const catalogId = reserve();
  const pagesId = reserve();
  const pageIds: number[] = [];

  for (const pageImages of pages) {
    const imageEntries = pageImages.map((image, index) => {
      const id = add(pdfStream(`/Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`, image.data));
      return { id, name: `Im${index + 1}` };
    });
    const commands = pageImages.map((_, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * labelWidth;
      const y = pageHeight - margin - (row + 1) * labelHeight;
      return `q ${labelWidth.toFixed(3)} 0 0 ${labelHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im${index + 1} Do Q`;
    }).join("\n");
    const contentId = add(pdfStream("", Buffer.from(commands, "binary")));
    const xObjects = imageEntries.map((entry) => `/${entry.name} ${entry.id} 0 R`).join(" ");
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${pageWidth.toFixed(3)} ${pageHeight.toFixed(3)}] /Resources << /XObject << ${xObjects} >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }

  objects[catalogId] = Buffer.from(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`, "binary");
  objects[pagesId] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`, "binary");

  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xFF\xFF\xFF\xFF\n", "binary")];
  const offsets = [0];
  let length = chunks[0].length;
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = length;
    const object = Buffer.concat([Buffer.from(`${index} 0 obj\n`, "binary"), objects[index]!, Buffer.from("\nendobj\n", "binary")]);
    chunks.push(object);
    length += object.length;
  }
  const xrefOffset = length;
  const xref = [`xref\n0 ${objects.length}\n`, "0000000000 65535 f \n"];
  for (let index = 1; index < objects.length; index += 1) xref.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  chunks.push(Buffer.from(xref.join(""), "binary"));
  return Buffer.concat(chunks);
}

export function parseCommerceLabelOptions(searchParams: URLSearchParams): CommerceLabelOptions {
  const format = searchParams.get("format");
  const layout = searchParams.get("layout");
  const page = searchParams.get("page");
  const size = searchParams.get("size");
  return {
    format: format === "png" || format === "pdf" ? format : "svg",
    layout: layout === "barcode" || layout === "qr" || layout === "combined" ? layout : "full",
    page: page === "a4" ? "a4" : "label",
    size: size === "30x20" || size === "50x30" ? size : "40x30",
    copies: Math.max(1, Math.min(200, Number(searchParams.get("copies") || 1) || 1)),
    marginMm: Math.max(0, Math.min(30, Number(searchParams.get("marginMm") || 8) || 0)),
    showPrice: searchParams.get("showPrice") !== "false",
    showSku: searchParams.get("showSku") !== "false",
    showQr: searchParams.get("showQr") !== "false",
  };
}

export function commerceLabelSizeMm(size: CommerceLabelSize) {
  return SIZE_MM[size];
}

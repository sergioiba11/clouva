import "server-only";
import sharp from "sharp";
import type { BrandNaming, LogoCandidateVariants, LogoVectorReconstruction } from "./types";

type ViewBox = { x: number; y: number; width: number; height: number };

export type BrandKitFiles = {
  svgs: {
    master: string;
    primary: string;
    symbol: string;
    horizontal: string;
    vertical: string;
    white: string;
    black: string;
    monochrome: string;
    favicon: string;
  };
  pngs: LogoCandidateVariants;
  transparent4096: Buffer;
  profile1024: Buffer;
  printPdf: Buffer;
  brandConfig: Buffer;
};

function readViewBox(svg: string): ViewBox {
  const match = svg.match(/viewBox=["']\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*["']/i);
  if (!match) return { x: 0, y: 0, width: 1000, height: 1000 };
  return { x: Number(match[1]) || 0, y: Number(match[2]) || 0, width: Math.max(1, Number(match[3]) || 1000), height: Math.max(1, Number(match[4]) || 1000) };
}

function innerSvg(svg: string) {
  return svg.replace(/^.*?<svg[^>]*>/is, "").replace(/<\/svg>\s*$/is, "");
}

function nestedSvg(svg: string, x: number, y: number, width: number, height: number) {
  const viewBox = readViewBox(svg);
  return `<svg x="${x}" y="${y}" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}" preserveAspectRatio="xMidYMid meet">${innerSvg(svg)}</svg>`;
}

function recolorSvg(svg: string, color: string) {
  const style = `<style>path,rect,circle,ellipse,polygon,polyline,line{fill:${color}!important;stroke:${color}!important}</style>`;
  return svg.replace(/<svg([^>]*)>/i, `<svg$1>${style}`);
}

function fitSvg(svg: string, width: number, height: number, padding = 0) {
  const viewBox = readViewBox(svg);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${nestedSvg(svg, padding, padding, width - padding * 2, height - padding * 2)}</svg>`;
}

function composeHorizontal(reconstruction: LogoVectorReconstruction) {
  if (!reconstruction.symbolSvg || !reconstruction.wordmarkSvg) return reconstruction.masterSvg;
  const descriptor = reconstruction.descriptorSvg;
  const body = [
    nestedSvg(reconstruction.symbolSvg, 40, 40, 360, 360),
    nestedSvg(reconstruction.wordmarkSvg, 430, descriptor ? 95 : 130, 930, descriptor ? 190 : 240),
    descriptor ? nestedSvg(descriptor, 500, 280, 790, 95) : "",
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1400 440">${body}</svg>`;
}

function composeVertical(reconstruction: LogoVectorReconstruction) {
  if (!reconstruction.symbolSvg || !reconstruction.wordmarkSvg) return reconstruction.masterSvg;
  const descriptor = reconstruction.descriptorSvg;
  const body = [
    nestedSvg(reconstruction.symbolSvg, 190, 40, 620, 420),
    nestedSvg(reconstruction.wordmarkSvg, 80, 480, 840, 235),
    descriptor ? nestedSvg(descriptor, 210, 710, 580, 95) : "",
  ].join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 850">${body}</svg>`;
}

async function renderPng(svg: string, width: number, height: number, background?: string) {
  let image = sharp(Buffer.from(svg)).resize(width, height, { fit: "contain", background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } });
  if (background) image = image.flatten({ background });
  return image.png().toBuffer();
}

function buildPdf(jpeg: Buffer, imageWidth: number, imageHeight: number) {
  const pageWidth = 595;
  const pageHeight = 842;
  const maxWidth = 495;
  const maxHeight = 360;
  const scale = Math.min(maxWidth / imageWidth, maxHeight / imageHeight);
  const drawWidth = imageWidth * scale;
  const drawHeight = imageHeight * scale;
  const x = (pageWidth - drawWidth) / 2;
  const y = (pageHeight - drawHeight) / 2;
  const content = Buffer.from(`q\n${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${x.toFixed(2)} ${y.toFixed(2)} cm\n/Im0 Do\nQ\n`);
  const objects: Buffer[] = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, Buffer.from("\nendstream")]),
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from("endstream")]),
  ];
  const chunks: Buffer[] = [Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary")];
  const offsets = [0];
  let position = chunks[0]?.length ?? 0;
  objects.forEach((object, index) => {
    offsets[index + 1] = position;
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from("\nendobj\n")]);
    chunks.push(chunk);
    position += chunk.length;
  });
  const xrefOffset = position;
  const xref = ["xref", `0 ${objects.length + 1}`, "0000000000 65535 f ", ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `), "trailer", `<< /Size ${objects.length + 1} /Root 1 0 R >>`, "startxref", String(xrefOffset), "%%EOF", ""].join("\n");
  chunks.push(Buffer.from(xref));
  return Buffer.concat(chunks);
}

export async function buildBrandKit(args: {
  reconstruction: LogoVectorReconstruction;
  naming: BrandNaming;
  brandAssetId: string;
  versionId: string;
  palette: string[];
}): Promise<BrandKitFiles> {
  const primary = args.reconstruction.masterSvg;
  const symbol = args.reconstruction.symbolSvg ?? fitSvg(primary, 1000, 1000, 120);
  const horizontal = composeHorizontal(args.reconstruction);
  const vertical = composeVertical(args.reconstruction);
  const white = recolorSvg(primary, "#ffffff");
  const black = recolorSvg(primary, "#000000");
  const monochrome = black;
  const favicon = fitSvg(symbol, 512, 512, 48);

  const [primaryPng, symbolPng, horizontalPng, verticalPng, squarePng, transparentPng, whitePng, blackPng, faviconPng, transparent4096, profile1024] = await Promise.all([
    renderPng(primary, 1400, 1000, "#0a0a0a"),
    renderPng(symbol, 1024, 1024, "#0a0a0a"),
    renderPng(horizontal, 1600, 600, "#0a0a0a"),
    renderPng(vertical, 1000, 1200, "#0a0a0a"),
    renderPng(fitSvg(primary, 1024, 1024, 80), 1024, 1024, "#0a0a0a"),
    renderPng(primary, 1600, 1200),
    renderPng(white, 1600, 1200),
    renderPng(black, 1600, 1200),
    renderPng(favicon, 512, 512),
    renderPng(primary, 4096, 4096),
    renderPng(fitSvg(primary, 1024, 1024, 80), 1024, 1024, "#0a0a0a"),
  ]);

  const printJpeg = await sharp(Buffer.from(primary)).resize(3508, 2480, { fit: "contain", background: "#ffffff" }).flatten({ background: "#ffffff" }).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
  const printPdf = buildPdf(printJpeg, 3508, 2480);
  const brandConfig = Buffer.from(JSON.stringify({
    schema_version: 1,
    brand_id: args.brandAssetId,
    brand_version_id: args.versionId,
    display_name: args.naming.displayName,
    descriptor: args.naming.descriptor,
    palette: args.palette,
    assets: {
      master_svg: "master_svg_url",
      primary_svg: "primary_svg_url",
      symbol_svg: "symbol_svg_url",
      horizontal_svg: "horizontal_svg_url",
      vertical_svg: "vertical_svg_url",
      white_svg: "white_svg_url",
      black_svg: "black_svg_url",
      favicon_svg: "favicon_svg_url",
    },
    validation: args.reconstruction.validation,
  }, null, 2));

  return {
    svgs: { master: primary, primary, symbol, horizontal, vertical, white, black, monochrome, favicon },
    pngs: {
      primary: { bytes: primaryPng, mimeType: "image/png" },
      symbol: { bytes: symbolPng, mimeType: "image/png" },
      horizontal: { bytes: horizontalPng, mimeType: "image/png" },
      vertical: { bytes: verticalPng, mimeType: "image/png" },
      square: { bytes: squarePng, mimeType: "image/png" },
      transparent: { bytes: transparentPng, mimeType: "image/png" },
      white: { bytes: whitePng, mimeType: "image/png" },
      black: { bytes: blackPng, mimeType: "image/png" },
      favicon: { bytes: faviconPng, mimeType: "image/png" },
    },
    transparent4096,
    profile1024,
    printPdf,
    brandConfig,
  };
}

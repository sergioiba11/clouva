import "server-only";

import type { GeminiReferenceImage } from "@/lib/gemini-image";
import type { LayoutConfig } from "./layout-config";
import { callGeminiJson } from "./vip-profile-layout-gemini";
import { sanitizeVisualCorrectionPatch, type VisualCorrectionPatch } from "./visual-correction-patch";

export type VisualCorrectionComparison = { patch:VisualCorrectionPatch; visualScore:number; summary:string|null; structuralMismatch:boolean; costUsd:number; model:string };
export function sanitizeVisualScore(value:unknown){return typeof value==="number"&&Number.isFinite(value)?Math.max(0,Math.min(1,value)):0;}

export async function compareReferenceRender(args:{apiKey:string;target:GeminiReferenceImage;render:GeminiReferenceImage;layout:LayoutConfig}):Promise<VisualCorrectionComparison>{
  if(args.layout.layout_kind!=="precise")return {patch:{changes:[]},visualScore:0,summary:"El layout no es precise.",structuralMismatch:true,costUsd:0,model:"none"};
  const editableScene={
    referenceViewport:args.layout.reference_viewport??null,
    header:args.layout.header??null,
    sections:args.layout.precise_sections.map((section)=>({
      id:section.id,type:section.type,heightVh:section.heightVh,widthPct:section.widthPct,xPct:section.xPct,overlayOpacity:section.background?.overlayOpacity,
      elements:(section.elements??[]).map((element)=>({
        id:element.id,type:element.type,x:element.x,y:element.y,w:element.w,h:element.h,zIndex:element.zIndex,
        fontSizePx:element.fontSizePx,fontFamilyToken:element.fontFamilyToken,textTransform:element.textTransform,letterSpacingPx:element.letterSpacingPx,lineHeight:element.lineHeight,
        opacity:element.opacity,borderWidthPx:element.borderWidthPx,radiusPx:element.radiusPx,color:element.color,backgroundColor:element.backgroundColor,borderColor:element.borderColor,
        shadow:element.shadow,blur:element.blur,imageFit:element.imageFit,imagePosition:element.imagePosition,align:element.align,buttonStyle:element.buttonStyle,
        widget:element.widget,variant:element.variant,columns:element.columns,gapPx:element.gapPx,
      })),
    })),
  };
  const promptText=[
    "Sos el comparador visual de Reference Fidelity V3 de CLOUVA.",
    "Imagen 0=TARGET ORIGINAL. Imagen 1=RENDER ACTUAL REAL de CLOUVA, al mismo viewport.",
    "Puntuá fidelidad perceptual sin inflar el score: 1=excelente coincidencia, 0=muy diferente.",
    "Orden de prioridad: geometría global, estructura, posición, tamaños, proporción, tipografía, imágenes, color, radios, bordes, overlays, sombras/decoración.",
    "No rediseñes, no cambies datos reales, no generes HTML/CSS/JS/JSX/URLs. Solo patch pequeño sobre IDs existentes.",
    "structuralMismatch=true SOLO cuando header/secciones/columnas/composición principal están mal y no se corrigen razonablemente con <=24 deltas.",
    "element.set permitido: x,y,w,h,zIndex,fontSizePx,fontFamilyToken,textTransform,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx,color,backgroundColor,borderColor,shadow,blur,imageFit,imagePosition,align,buttonStyle,variant,columns,gapPx.",
    "element.delta permitido: x,y,w,h,zIndex,fontSizePx,letterSpacingPx,lineHeight,opacity,borderWidthPx,radiusPx,columns,gapPx.",
    "section.set/delta: heightVh,widthPct,xPct; section.set puede incluir overlayOpacity.",
    `ESCENA EDITABLE: ${JSON.stringify(editableScene)}`,
    '{"visualScore":number,"summary":string,"structuralMismatch":boolean,"changes":[{"target":"element"|"section","id":string,"set":{},"delta":{}}]}',
    "Si ya coincide bien, changes=[] pero visualScore debe seguir siendo una evaluación real.",
  ].join("\n");
  const {parsed,costUsd,model}=await callGeminiJson({apiKey:args.apiKey,promptText,images:[args.target,args.render],workload:"reference_precise"});
  const raw=parsed&&typeof parsed==="object"?parsed as Record<string,unknown>:{};
  return {patch:sanitizeVisualCorrectionPatch(raw),visualScore:sanitizeVisualScore(raw.visualScore),summary:typeof raw.summary==="string"?raw.summary.trim().slice(0,500):null,structuralMismatch:raw.structuralMismatch===true,costUsd,model};
}

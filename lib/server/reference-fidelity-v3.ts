import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import type { GeminiReferenceImage } from "@/lib/gemini-image";
import type { VisualCorrectionPatch } from "./visual-correction-patch";

export const REFERENCE_FIDELITY_MAX_ITERATIONS = 3;
export const REFERENCE_FIDELITY_MAX_STRUCTURAL_REGENERATIONS = 1;
export const REFERENCE_FIDELITY_TARGET_SCORE = 0.9;

export type ReferenceViewport = { width:number; height:number; aspectRatio:number };
export type ReferenceFidelityHistoryEntry = {
  iteration:number; scoreBefore:number|null; scoreAfter:number|null; model:string; costUsd:number; corrections:number;
  timestamp:string; structuralMismatch?:boolean; structuralRegeneration?:boolean; summary?:string|null; error?:string|null;
};
export type ReferenceFidelityState = {
  enabled:true; stage:string; versionId:string|null; referenceViewport:ReferenceViewport; iteration:number; maxIterations:number;
  visualScore:number|null; summary:string|null; structuralMismatch:boolean; structuralRegenerationUsed:boolean;
  pendingPatch:VisualCorrectionPatch|null; history:ReferenceFidelityHistoryEntry[]; lastError:string|null;
};

function clampDimension(value:number){return Math.max(240,Math.min(7680,Math.round(value)));}
export function sanitizeReferenceViewport(value:unknown):ReferenceViewport|null{
  if(!value||typeof value!=="object")return null;const raw=value as Record<string,unknown>;const width=typeof raw.width==="number"&&Number.isFinite(raw.width)?clampDimension(raw.width):0,height=typeof raw.height==="number"&&Number.isFinite(raw.height)?clampDimension(raw.height):0;if(!width||!height)return null;return{width,height,aspectRatio:Number((width/height).toFixed(6))};
}
function pngDimensions(buffer:Buffer){if(buffer.length<24||buffer.toString("ascii",1,4)!=="PNG")return null;return sanitizeReferenceViewport({width:buffer.readUInt32BE(16),height:buffer.readUInt32BE(20)});}
function jpegDimensions(buffer:Buffer){if(buffer.length<4||buffer[0]!==0xff||buffer[1]!==0xd8)return null;let offset=2;while(offset+9<buffer.length){if(buffer[offset]!==0xff){offset++;continue;}const marker=buffer[offset+1];if(marker===0xd8||marker===0xd9){offset+=2;continue;}const length=buffer.readUInt16BE(offset+2);if(length<2||offset+2+length>buffer.length)break;if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker))return sanitizeReferenceViewport({width:buffer.readUInt16BE(offset+7),height:buffer.readUInt16BE(offset+5)});offset+=2+length;}return null;}
function webpDimensions(buffer:Buffer){if(buffer.length<30||buffer.toString("ascii",0,4)!=="RIFF"||buffer.toString("ascii",8,12)!=="WEBP")return null;const kind=buffer.toString("ascii",12,16);if(kind==="VP8X")return sanitizeReferenceViewport({width:1+buffer.readUIntLE(24,3),height:1+buffer.readUIntLE(27,3)});if(kind==="VP8 "&&buffer.length>=30)return sanitizeReferenceViewport({width:buffer.readUInt16LE(26)&0x3fff,height:buffer.readUInt16LE(28)&0x3fff});if(kind==="VP8L"&&buffer.length>=25){const b1=buffer[22],b2=buffer[23],b3=buffer[24];return sanitizeReferenceViewport({width:1+(((b2&0x3f)<<8)|b1),height:1+(((b3&0x0f)<<10)|(b2>>6)|((b3&0xf0)<<2))});}return null;}
export function inferReferenceViewport(image:GeminiReferenceImage|null|undefined):ReferenceViewport|null{if(!image?.data)return null;try{const buffer=Buffer.from(image.data,"base64");if(image.mimeType.includes("png"))return pngDimensions(buffer);if(image.mimeType.includes("jpeg")||image.mimeType.includes("jpg"))return jpegDimensions(buffer);if(image.mimeType.includes("webp"))return webpDimensions(buffer);return pngDimensions(buffer)??jpegDimensions(buffer)??webpDimensions(buffer);}catch{return null;}}

export function createReferenceFidelityState(viewport:ReferenceViewport,versionId:string|null=null):ReferenceFidelityState{return{enabled:true,stage:"rendering_reference_preview",versionId,referenceViewport:viewport,iteration:0,maxIterations:REFERENCE_FIDELITY_MAX_ITERATIONS,visualScore:null,summary:null,structuralMismatch:false,structuralRegenerationUsed:false,pendingPatch:null,history:[],lastError:null};}
export function readReferenceFidelityState(layoutAnalysis:unknown):ReferenceFidelityState|null{
  if(!layoutAnalysis||typeof layoutAnalysis!=="object")return null;const raw=(layoutAnalysis as Record<string,unknown>).referenceFidelity;if(!raw||typeof raw!=="object")return null;const v=raw as Record<string,unknown>,viewport=sanitizeReferenceViewport(v.referenceViewport);if(!viewport||v.enabled!==true)return null;const history=Array.isArray(v.history)?v.history.filter((item):item is ReferenceFidelityHistoryEntry=>Boolean(item&&typeof item==="object")).slice(-20):[];
  return{enabled:true,stage:typeof v.stage==="string"?v.stage.slice(0,64):"rendering_reference_preview",versionId:typeof v.versionId==="string"?v.versionId:null,referenceViewport:viewport,iteration:typeof v.iteration==="number"?Math.max(0,Math.min(10,Math.floor(v.iteration))):0,maxIterations:typeof v.maxIterations==="number"?Math.max(1,Math.min(5,Math.floor(v.maxIterations))):REFERENCE_FIDELITY_MAX_ITERATIONS,visualScore:typeof v.visualScore==="number"?Math.max(0,Math.min(1,v.visualScore)):null,summary:typeof v.summary==="string"?v.summary.slice(0,500):null,structuralMismatch:v.structuralMismatch===true,structuralRegenerationUsed:v.structuralRegenerationUsed===true,pendingPatch:v.pendingPatch&&typeof v.pendingPatch==="object"?v.pendingPatch as VisualCorrectionPatch:null,history,lastError:typeof v.lastError==="string"?v.lastError.slice(0,500):null};
}
export function withReferenceFidelityState(layoutAnalysis:unknown,state:ReferenceFidelityState){const base=layoutAnalysis&&typeof layoutAnalysis==="object"?layoutAnalysis as Record<string,unknown>:{};return{...base,referenceFidelity:state};}
export function shouldStopReferenceFidelity(state:ReferenceFidelityState,score:number,correctionCount:number){return score>=REFERENCE_FIDELITY_TARGET_SCORE||state.iteration+1>=state.maxIterations||correctionCount===0;}

function previewSecret(){const secret=process.env.VIP_PROFILE_TASK_SECRET?.trim();if(!secret)throw new Error("VIP_PROFILE_TASK_SECRET no está configurada.");return secret;}
export function signReferencePreview(versionId:string){return createHmac("sha256",previewSecret()).update(`reference-fidelity:${versionId}`).digest("hex");}
export function verifyReferencePreview(versionId:string,token:string){if(!/^[0-9a-f]{64}$/i.test(token))return false;const expected=signReferencePreview(versionId);return timingSafeEqual(Buffer.from(expected,"hex"),Buffer.from(token,"hex"));}
function chromiumCommand(){return process.env.CLOUVA_CHROMIUM_PATH?.trim()||"/usr/bin/chromium";}
async function runChromium(args:string[],timeoutMs:number){await new Promise<void>((resolve,reject)=>{const child=spawn(chromiumCommand(),args,{stdio:["ignore","ignore","pipe"]});let stderr="",settled=false;const finish=(error?:Error)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve();};const timer=setTimeout(()=>{child.kill("SIGKILL");finish(new Error("Chromium excedió el tiempo máximo de captura."));},timeoutMs);child.stderr.on("data",(chunk)=>{stderr=(stderr+String(chunk)).slice(-3000);});child.once("error",(error)=>finish(error));child.once("exit",(code)=>finish(code===0?undefined:new Error(`Chromium no pudo capturar el preview (${code??"sin código"})${stderr?`: ${stderr.slice(-800)}`:""}`)));});}

export async function captureReferencePreview(args:{versionId:string;viewport:ReferenceViewport}):Promise<GeminiReferenceImage>{
  const baseUrl=process.env.APP_BASE_URL?.trim()||"https://clouva.com.ar",token=signReferencePreview(args.versionId),url=`${baseUrl}/reference-fidelity/preview/${encodeURIComponent(args.versionId)}?token=${token}&capture=1`,directory=await mkdtemp(join(tmpdir(),"clouva-reference-fidelity-")),screenshotPath=join(directory,"render.png");
  try{await runChromium(["--headless=new","--no-sandbox","--disable-dev-shm-usage","--disable-gpu","--hide-scrollbars",`--window-size=${args.viewport.width},${args.viewport.height}`,"--force-device-scale-factor=1","--run-all-compositor-stages-before-draw","--virtual-time-budget=5000",`--screenshot=${screenshotPath}`,url],30_000);const bytes=await readFile(screenshotPath);if(!bytes.length)throw new Error("Chromium devolvió una captura vacía.");return{mimeType:"image/png",data:bytes.toString("base64")};}finally{await rm(directory,{recursive:true,force:true}).catch(()=>undefined);}
}

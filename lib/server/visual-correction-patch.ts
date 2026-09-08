import "server-only";

import { sanitizeLayoutConfig, type LayoutConfig, type PreciseSection } from "./layout-config";

const ID_RE = /^[a-z][a-z0-9-]{0,63}$/;
const ELEMENT_NUMERIC_KEYS = new Set(["x","y","w","h","zIndex","fontSizePx","letterSpacingPx","lineHeight","opacity","borderWidthPx","radiusPx","gapPx","columns"]);
const ELEMENT_SET_KEYS = new Set([
  ...ELEMENT_NUMERIC_KEYS,
  "color","backgroundColor","borderColor","shadow","blur","imageFit","imagePosition","align","buttonStyle",
  "fontFamilyToken","textTransform","variant",
]);
const SECTION_NUMERIC_KEYS = new Set(["heightVh","widthPct","xPct"]);
const SECTION_SET_KEYS = new Set([...SECTION_NUMERIC_KEYS,"overlayOpacity"]);

export type VisualCorrectionChange = { target:"element"|"section"; id:string; set?:Record<string,string|number|null>; delta?:Record<string,number> };
export type VisualCorrectionPatch = { changes:VisualCorrectionChange[] };

function safeId(value:unknown):string|null { return typeof value==="string"&&ID_RE.test(value)?value:null; }
function sanitizeSet(raw:unknown,allowed:Set<string>):Record<string,string|number|null>|undefined {
  if(!raw||typeof raw!=="object")return undefined; const result:Record<string,string|number|null>={};
  for(const [key,value] of Object.entries(raw as Record<string,unknown>)){ if(!allowed.has(key))continue; if(typeof value==="number"&&Number.isFinite(value))result[key]=value; else if(typeof value==="string")result[key]=value.slice(0,64); else if(value===null)result[key]=null; }
  return Object.keys(result).length?result:undefined;
}
function sanitizeDelta(raw:unknown,allowed:Set<string>):Record<string,number>|undefined {
  if(!raw||typeof raw!=="object")return undefined; const result:Record<string,number>={};
  for(const [key,value] of Object.entries(raw as Record<string,unknown>)){ if(allowed.has(key)&&typeof value==="number"&&Number.isFinite(value))result[key]=Math.max(-50,Math.min(50,value)); }
  return Object.keys(result).length?result:undefined;
}
export function sanitizeVisualCorrectionPatch(raw:unknown):VisualCorrectionPatch {
  if(!raw||typeof raw!=="object")return {changes:[]}; const rows=Array.isArray((raw as Record<string,unknown>).changes)?(raw as Record<string,unknown>).changes as unknown[]:[]; const changes:VisualCorrectionChange[]=[];
  for(const row of rows.slice(0,64)){ if(!row||typeof row!=="object")continue; const v=row as Record<string,unknown>,target=v.target==="section"?"section":v.target==="element"?"element":null,id=safeId(v.id); if(!target||!id)continue; const set=sanitizeSet(v.set,target==="element"?ELEMENT_SET_KEYS:SECTION_SET_KEYS),delta=sanitizeDelta(v.delta,target==="element"?ELEMENT_NUMERIC_KEYS:SECTION_NUMERIC_KEYS); if(set||delta)changes.push({target,id,set,delta}); }
  return {changes};
}
function applyNumericDelta(target:Record<string,unknown>,delta:Record<string,number>|undefined){ if(!delta)return; for(const [key,amount] of Object.entries(delta)){const current=target[key];if(typeof current==="number"&&Number.isFinite(current))target[key]=current+amount;} }
function findSection(sections:PreciseSection[],id:string):PreciseSection|null { for(const section of sections){if(section.id===id)return section;const nested=section.columns?.length?findSection(section.columns,id):null;if(nested)return nested;}return null; }
function findElement(sections:PreciseSection[],id:string):Record<string,unknown>|null { for(const section of sections){const element=section.elements?.find((entry)=>entry.id===id);if(element)return element as unknown as Record<string,unknown>;const nested=section.columns?.length?findElement(section.columns,id):null;if(nested)return nested;}return null; }

export function applyVisualCorrectionPatch(layout:LayoutConfig,rawPatch:unknown):LayoutConfig|null {
  if(layout.layout_kind!=="precise")return layout; const patch=sanitizeVisualCorrectionPatch(rawPatch);if(!patch.changes.length)return layout; const draft=JSON.parse(JSON.stringify(layout)) as LayoutConfig;
  for(const change of patch.changes){
    if(change.target==="element"){const target=findElement(draft.precise_sections,change.id);if(!target)continue;if(change.set)Object.assign(target,change.set);applyNumericDelta(target,change.delta);continue;}
    const section=findSection(draft.precise_sections,change.id);if(!section)continue;const target=section as unknown as Record<string,unknown>;
    if(change.set){for(const [key,value] of Object.entries(change.set)){if(key==="overlayOpacity")section.background={...(section.background??{}),overlayOpacity:typeof value==="number"?value:null};else target[key]=value;}}
    applyNumericDelta(target,change.delta);
  }
  return sanitizeLayoutConfig(draft);
}

import { FlowModuleCrud } from "@/components/flow-module-crud";
export default function Page(){return <FlowModuleCrud config={{table:"flow_lore_entries",title:"Lore / Vida de Flows",subtitle:"Frases, conceptos, historia y universo Clouva.",createLabel:"Nueva entrada",fields:[{key:"title",label:"Título"},{key:"category",label:"Categoría"},{key:"content",label:"Contenido",type:"textarea"}]}}/>}

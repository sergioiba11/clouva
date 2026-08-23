import { FlowModuleCrud } from "@/components/flow-module-crud";

export default function NotasCreativasPage() {
  return (
    <FlowModuleCrud
      config={{
        table: "flow_flows",
        title: "Notas creativas",
        subtitle: "Letras, barras, melodías, notas de voz e inspiración.",
        createLabel: "Crear nota",
        fields: [
          { key: "title", label: "Título" },
          { key: "type", label: "Tipo" },
          { key: "mood", label: "Mood" },
          { key: "status", label: "Estado" },
          { key: "content", label: "Contenido", type: "textarea" },
        ],
      }}
    />
  );
}

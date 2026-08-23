import { FlowModuleCrud } from "@/components/flow-module-crud";

export default function MiFlowPage() {
  return (
    <FlowModuleCrud
      config={{
        table: "flow_money_entries",
        title: "MI FLOW",
        subtitle: "Dinero, ganancias, gastos, metas e inversiones.",
        createLabel: "Nuevo movimiento",
        fields: [
          { key: "type", label: "Tipo (ingreso/gasto)" },
          { key: "amount", label: "Monto", type: "number" },
          { key: "category", label: "Categoría" },
          { key: "source", label: "Fuente" },
          { key: "date", label: "Fecha", type: "date" },
          { key: "notes", label: "Notas", type: "textarea" },
        ],
      }}
    />
  );
}

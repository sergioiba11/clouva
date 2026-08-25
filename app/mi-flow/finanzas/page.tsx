import { FlowModuleCrud } from "@/components/flow-module-crud";

export default function FinanzasPersonalesPage() {
  return (
    <FlowModuleCrud
      config={{
        table: "flow_money_entries",
        title: "Finanzas personales",
        subtitle: "Registro manual de ingresos y gastos. Esto no modifica el saldo real de MI FLOW, FLOWS ni Diamantes.",
        createLabel: "Nuevo movimiento manual",
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

import { redirect } from "next/navigation";

export default function PagarQrPage() {
  redirect("/mi-flow/billetera?asset=flows&action=pay-qr");
}

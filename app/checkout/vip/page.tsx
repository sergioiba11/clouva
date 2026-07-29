import { redirect } from "next/navigation";

export const metadata = { title: "CLOUVA VIP", robots: { index: false, follow: false } };

export default function VipCheckoutEntryPage() {
  redirect("/vip");
}

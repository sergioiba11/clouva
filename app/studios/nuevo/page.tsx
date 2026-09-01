import { redirect } from "next/navigation";

export default function LegacyNewStudioPage() {
  redirect("/businesses/new?type=studio");
}

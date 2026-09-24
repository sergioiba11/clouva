import { permanentRedirect } from "next/navigation";
import { IGLU_PUBLIC_PATH } from "@/lib/iglu-radio/routes";

export default function IgluHomePage() {
  permanentRedirect(IGLU_PUBLIC_PATH);
}

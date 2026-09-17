import { permanentRedirect } from "next/navigation";
import { IGLU_STUDIO_PATH } from "@/lib/iglu-radio/routes";

export default function IgluHomePage() {
  permanentRedirect(IGLU_STUDIO_PATH);
}

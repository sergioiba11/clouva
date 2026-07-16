import { ClouvaAIChat } from "@/components/clouva-ai/ClouvaAIChat";
import { GeminiModelSelector } from "@/components/clouva-ai/GeminiModelSelector";

export default function ClouvaAIPage() {
  return (
    <>
      <GeminiModelSelector />
      <ClouvaAIChat />
    </>
  );
}

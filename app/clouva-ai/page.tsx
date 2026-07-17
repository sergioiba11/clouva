import { ClouvaAIChat } from "@/components/clouva-ai/ClouvaAIChat";
import { GeminiModelSelector } from "@/components/clouva-ai/GeminiModelSelector";

export default function ClouvaAIPage() {
  return (
    <main className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-black">
      <GeminiModelSelector />
      <ClouvaAIChat />
    </main>
  );
}

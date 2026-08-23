"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

type ClouvaAIAssistantContextValue = {
  open: boolean;
  starterPrompt: string | null;
  openAssistant: (prompt?: string) => void;
  closeAssistant: () => void;
  toggleAssistant: () => void;
  consumeStarterPrompt: () => string | null;
};

const ClouvaAIAssistantContext = createContext<ClouvaAIAssistantContextValue | null>(null);

export function ClouvaAIAssistantProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [starterPrompt, setStarterPrompt] = useState<string | null>(null);
  const starterPromptRef = useRef<string | null>(null);

  const openAssistant = useCallback((prompt?: string) => {
    if (prompt?.trim()) {
      starterPromptRef.current = prompt.trim();
      setStarterPrompt(prompt.trim());
    }
    setOpen(true);
  }, []);

  const closeAssistant = useCallback(() => setOpen(false), []);
  const toggleAssistant = useCallback(() => setOpen((value) => !value), []);
  const consumeStarterPrompt = useCallback(() => {
    const value = starterPromptRef.current;
    starterPromptRef.current = null;
    setStarterPrompt(null);
    return value;
  }, []);

  const value = useMemo(
    () => ({ open, starterPrompt, openAssistant, closeAssistant, toggleAssistant, consumeStarterPrompt }),
    [closeAssistant, consumeStarterPrompt, open, openAssistant, starterPrompt, toggleAssistant],
  );

  return <ClouvaAIAssistantContext.Provider value={value}>{children}</ClouvaAIAssistantContext.Provider>;
}

export function useClouvaAIAssistant() {
  const context = useContext(ClouvaAIAssistantContext);
  if (!context) throw new Error("useClouvaAIAssistant must be used within ClouvaAIAssistantProvider");
  return context;
}

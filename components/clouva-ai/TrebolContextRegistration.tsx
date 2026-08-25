"use client";

import { useTrebolContextRegistration } from "./ClouvaAIAssistantProvider";

export function TrebolContextRegistration(props: {
  scope: string;
  id: string;
  data: Record<string, unknown>;
}) {
  useTrebolContextRegistration(props);
  return null;
}

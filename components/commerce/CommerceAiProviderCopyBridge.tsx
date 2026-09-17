"use client";

import { useEffect, useRef } from "react";

const LEGACY_PROVIDER_PATTERN = /\bGemini\b/gi;
const CANONICAL_PROVIDER_LABEL = "Google Cloud Vertex AI";

function normalizeProviderCopy(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];

  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    if (node.nodeValue && LEGACY_PROVIDER_PATTERN.test(node.nodeValue)) {
      textNodes.push(node);
    }
    LEGACY_PROVIDER_PATTERN.lastIndex = 0;
  }

  for (const node of textNodes) {
    node.nodeValue = node.nodeValue?.replace(LEGACY_PROVIDER_PATTERN, CANONICAL_PROVIDER_LABEL) ?? null;
    LEGACY_PROVIDER_PATTERN.lastIndex = 0;
  }
}

/**
 * Commerce already runs product recognition/generation through Google Cloud
 * Vertex AI. Some legacy UI copy in the large operational dashboard still
 * says "Gemini" because Gemini is the model family running inside Vertex.
 *
 * Keep the user-facing provider name canonical while that dashboard is
 * progressively split into smaller components. This bridge is deliberately
 * scoped to the commerce workspace and never changes API payloads or data.
 */
export function CommerceAiProviderCopyBridge({ children }: { children: React.ReactNode }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    normalizeProviderCopy(root);

    const observer = new MutationObserver(() => normalizeProviderCopy(root));
    observer.observe(root, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, []);

  return <div ref={rootRef}>{children}</div>;
}

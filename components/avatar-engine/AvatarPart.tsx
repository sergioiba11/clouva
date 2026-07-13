import type { AvatarItem } from "@/lib/avatar-engine/types";

type Props = { item: AvatarItem; active?: boolean; color?: string };

export function AvatarPart({ item, active = true, color }: Props) {
  if (!active) return null;
  return <span className={`avatar-part avatar-part-${item.category}`} style={{ "--avatar-part-color": color } as React.CSSProperties} data-part={item.id} />;
}

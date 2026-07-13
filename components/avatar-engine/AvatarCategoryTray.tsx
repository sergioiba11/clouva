"use client";

import { avatarCategories, hasAvatarAssetsForCategory } from "@/lib/avatar-engine/catalog";
import type { AvatarCategory } from "@/lib/avatar-engine/types";

export function AvatarCategoryTray({ active, onChange }: { active: Exclude<AvatarCategory, "body">; onChange: (category: Exclude<AvatarCategory, "body">) => void }) {
  return (
    <nav className="avatar-category-tray" aria-label="Categorías del locker">
      {avatarCategories.map((category) => {
        const enabled = hasAvatarAssetsForCategory(category.id);
        return <button key={category.id} type="button" className={`${active === category.id ? "active" : ""} ${enabled ? "" : "locked"}`} onClick={() => onChange(category.id)}>{category.label}{enabled ? null : <span>Próximamente</span>}</button>;
      })}
    </nav>
  );
}

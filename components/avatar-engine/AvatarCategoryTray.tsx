"use client";

import { avatarCategories } from "@/lib/avatar-engine/catalog";
import type { AvatarCategory } from "@/lib/avatar-engine/types";

export function AvatarCategoryTray({ active, onChange }: { active: Exclude<AvatarCategory, "body">; onChange: (category: Exclude<AvatarCategory, "body">) => void }) {
  return <nav className="avatar-category-tray" aria-label="Categorías del locker">{avatarCategories.map((category) => <button key={category.id} type="button" className={active === category.id ? "active" : ""} onClick={() => onChange(category.id)}>{category.label}</button>)}</nav>;
}

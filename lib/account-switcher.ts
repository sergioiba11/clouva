export type StoredAccount = {
  id: string;
  email: string;
  display_name: string;
  avatar_url?: string | null;
  role: string;
};

const KEY = "clouva.accounts";

export function getAccounts(): StoredAccount[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as StoredAccount[];
  } catch {
    return [];
  }
}

export function saveAccount(account: StoredAccount) {
  if (typeof window === "undefined") return;
  const next = getAccounts().filter((a) => a.id !== account.id);
  next.unshift(account);
  localStorage.setItem(KEY, JSON.stringify(next.slice(0, 10)));
}

export function removeAccount(id: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(getAccounts().filter((a) => a.id !== id)));
}

export async function switchAccount(id: string) {
  const account = getAccounts().find((a) => a.id === id);
  if (!account) return false;
  if (typeof window !== "undefined") {
    localStorage.setItem("clouva.switch_target", id);
    window.location.href = "/login";
  }
  return true;
}

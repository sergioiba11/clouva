export type PlayerKnowledgeProfile = {
  player_id: string;
  birth_date: string | null;
  show_lunar: boolean;
  show_numerology: boolean;
  show_zodiac: boolean;
  knowledge_topics: string[];
  teach_topics: string[];
  created_at?: string;
  updated_at?: string;
};

export type PublicKnowledgeProfile = {
  showLunar: boolean;
  numerologyNumber: number | null;
  zodiacSign: string | null;
  knowledgeTopics: string[];
  teachTopics: string[];
};

function dateParts(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const test = new Date(Date.UTC(year, month - 1, day));
  if (test.getUTCFullYear() !== year || test.getUTCMonth() !== month - 1 || test.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function calculateNumerologyNumber(birthDate: string | null | undefined) {
  const parts = dateParts(birthDate);
  if (!parts) return null;
  let value = `${String(parts.day).padStart(2, "0")}${String(parts.month).padStart(2, "0")}${parts.year}`
    .split("")
    .reduce((sum, digit) => sum + Number(digit), 0);
  while (value >= 10) {
    value = String(value).split("").reduce((sum, digit) => sum + Number(digit), 0);
  }
  return value;
}

export function zodiacSignFromBirthDate(birthDate: string | null | undefined) {
  const parts = dateParts(birthDate);
  if (!parts) return null;
  const { month, day } = parts;
  const value = month * 100 + day;
  if (value >= 321 && value <= 419) return "Aries";
  if (value >= 420 && value <= 520) return "Tauro";
  if (value >= 521 && value <= 620) return "Géminis";
  if (value >= 621 && value <= 722) return "Cáncer";
  if (value >= 723 && value <= 822) return "Leo";
  if (value >= 823 && value <= 922) return "Virgo";
  if (value >= 923 && value <= 1022) return "Libra";
  if (value >= 1023 && value <= 1121) return "Escorpio";
  if (value >= 1122 && value <= 1221) return "Sagitario";
  if (value >= 1222 || value <= 119) return "Capricornio";
  if (value >= 120 && value <= 218) return "Acuario";
  return "Piscis";
}

export function publicKnowledgeProfile(profile: PlayerKnowledgeProfile | null): PublicKnowledgeProfile | null {
  if (!profile) return null;
  const numerologyNumber = profile.show_numerology ? calculateNumerologyNumber(profile.birth_date) : null;
  const zodiacSign = profile.show_zodiac ? zodiacSignFromBirthDate(profile.birth_date) : null;
  const knowledgeTopics = Array.isArray(profile.knowledge_topics) ? profile.knowledge_topics.filter(Boolean) : [];
  const teachTopics = Array.isArray(profile.teach_topics) ? profile.teach_topics.filter(Boolean) : [];
  if (!profile.show_lunar && numerologyNumber === null && !zodiacSign && knowledgeTopics.length === 0 && teachTopics.length === 0) return null;
  return {
    showLunar: profile.show_lunar,
    numerologyNumber,
    zodiacSign,
    knowledgeTopics,
    teachTopics,
  };
}

export function normalizeKnowledgeTopics(value: unknown, max = 16) {
  if (!Array.isArray(value)) return [] as string[];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const clean = item.trim().replace(/\s+/g, " ").slice(0, 60);
    if (!clean) continue;
    const key = clean.toLocaleLowerCase("es");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(clean);
    if (output.length >= max) break;
  }
  return output;
}

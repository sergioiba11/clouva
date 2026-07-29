import { StatCard } from "@/components/os-ui";

export type AchievementStats = {
  temasPublicados: number;
  aniosActivo: number;
  seguidores: number;
  colaboraciones: number;
};

export function AchievementsRow({ stats }: { stats: AchievementStats }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <StatCard label="Temas publicados" value={stats.temasPublicados} />
      <StatCard label="Años activo" value={stats.aniosActivo} />
      <StatCard label="Seguidores" value={stats.seguidores} />
      <StatCard label="Colaboraciones" value={stats.colaboraciones} />
    </div>
  );
}

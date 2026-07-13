"use client";

import dynamic from "next/dynamic";

const AvatarScene = dynamic(() => import("@/components/clouva/AvatarScene").then((mod) => mod.AvatarScene), {
  ssr: false,
  loading: () => <main className="clouva-experience"><div className="clouva-loader">Cargando avatar</div></main>,
});

export function HomeExperience() {
  return <AvatarScene />;
}

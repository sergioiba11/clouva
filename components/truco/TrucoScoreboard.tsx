"use client";

import Link from "next/link";
import { ArrowLeft, Pencil, RotateCcw, Spade, Trophy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CloverIcon } from "@/components/clover-icon";
import styles from "./truco-scoreboard.module.css";

type Team = {
  name: string;
  score: number;
  tone: "violet" | "cyan";
};

type Move = {
  team: number;
  previous: number;
};

type MatchState = {
  limit: 15 | 30;
  teams: [Team, Team];
  games: [number, number];
  history: Move[];
};

const STORAGE_KEY = "clouva-truco-score-v1";

const initialState: MatchState = {
  limit: 30,
  teams: [
    { name: "Nosotros", score: 0, tone: "violet" },
    { name: "Ellos", score: 0, tone: "cyan" },
  ],
  games: [0, 0],
  history: [],
};

function groupsFor(value: number) {
  const groups = Array.from({ length: Math.floor(value / 5) }, () => 5);
  if (value % 5) groups.push(value % 5);
  return groups;
}

function Tally({ value }: { value: number }) {
  const groups = groupsFor(value);

  return (
    <div className={styles.tallies} aria-label={`${value} puntos`}>
      {groups.length === 0 ? <span className={styles.empty}>—</span> : null}
      {groups.map((count, groupIndex) => (
        <span className={styles.tallyGroup} key={`${groupIndex}-${count}`}>
          {[0, 1, 2, 3].map((mark) => (
            <i key={mark} className={mark < count ? styles.marked : undefined} />
          ))}
          <b className={count === 5 ? styles.marked : undefined} />
        </span>
      ))}
    </div>
  );
}

function TeamPanel({
  team,
  index,
  limit,
  winner,
  onAdd,
  onRename,
}: {
  team: Team;
  index: number;
  limit: 15 | 30;
  winner: boolean;
  onAdd: (teamIndex: number, points: number) => void;
  onRename: (teamIndex: number) => void;
}) {
  return (
    <article className={`${styles.team} ${styles[team.tone]} ${winner ? styles.winner : ""}`}>
      <div className={styles.teamHead}>
        <button type="button" className={styles.teamName} onClick={() => onRename(index)}>
          <span>{team.name}</span>
          <Pencil size={14} />
        </button>
        <strong>{team.score}</strong>
      </div>

      <div className={styles.scorePaper}>
        <div>
          <span>Malas</span>
          <Tally value={Math.min(team.score, 15)} />
        </div>
        <div>
          <span>Buenas</span>
          <Tally value={limit === 30 ? Math.max(team.score - 15, 0) : 0} />
        </div>
      </div>

      {winner ? (
        <div className={styles.winnerBanner}>
          <Trophy size={18} />
          Partido
        </div>
      ) : (
        <div className={styles.actions}>
          {[1, 2, 3].map((points) => (
            <button type="button" key={points} onClick={() => onAdd(index, points)}>
              <b>+{points}</b>
              <span>{points === 1 ? "tanto" : "tantos"}</span>
            </button>
          ))}
        </div>
      )}
    </article>
  );
}

export function TrucoScoreboard() {
  const [state, setState] = useState<MatchState>(initialState);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) setState(JSON.parse(saved) as MatchState);
    } catch {
      // El marcador sigue funcionando aunque el navegador bloquee localStorage.
    } finally {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [hydrated, state]);

  const winner = useMemo(
    () => state.teams.findIndex((team) => team.score >= state.limit),
    [state.limit, state.teams],
  );

  function addPoints(teamIndex: number, points: number) {
    if (winner !== -1) return;
    setState((current) => ({
      ...current,
      teams: current.teams.map((team, index) => (
        index === teamIndex
          ? { ...team, score: Math.min(current.limit, team.score + points) }
          : team
      )) as [Team, Team],
      history: [
        ...current.history,
        { team: teamIndex, previous: current.teams[teamIndex].score },
      ],
    }));
  }

  function rename(teamIndex: number) {
    const nextName = window.prompt("Nombre del equipo", state.teams[teamIndex].name)?.trim();
    if (!nextName) return;
    setState((current) => ({
      ...current,
      teams: current.teams.map((team, index) => (
        index === teamIndex ? { ...team, name: nextName.slice(0, 18) } : team
      )) as [Team, Team],
    }));
  }

  function undo() {
    setState((current) => {
      const last = current.history.at(-1);
      if (!last) return current;
      return {
        ...current,
        teams: current.teams.map((team, index) => (
          index === last.team ? { ...team, score: last.previous } : team
        )) as [Team, Team],
        history: current.history.slice(0, -1),
      };
    });
  }

  function setLimit(limit: 15 | 30) {
    if (limit === state.limit) return;
    if (state.teams.some((team) => team.score > 0) && !window.confirm("Cambiar el partido reinicia el tanteador. ¿Seguimos?")) return;
    setState((current) => ({
      ...initialState,
      limit,
      teams: current.teams.map((team) => ({ ...team, score: 0 })) as [Team, Team],
      games: current.games,
    }));
  }

  function newGame() {
    setState((current) => ({
      ...current,
      teams: current.teams.map((team) => ({ ...team, score: 0 })) as [Team, Team],
      games: current.games.map((games, index) => games + (index === winner ? 1 : 0)) as [number, number],
      history: [],
    }));
  }

  return (
    <main className={styles.page}>
      <div className={styles.glow} aria-hidden="true" />

      <header className={styles.header}>
        <Link href="/" className={styles.brand} aria-label="Volver a CLOUVA">
          <CloverIcon size={22} />
          <span>CLOUVA</span>
        </Link>
        <Link href="/" className={styles.back}>
          <ArrowLeft size={16} />
          Volver
        </Link>
      </header>

      <section className={styles.intro}>
        <div>
          <span className={styles.eyebrow}><Spade size={13} /> La mesa está servida</span>
          <h1>Anotador de Truco</h1>
          <p>La cuenta clara. La discusión, para después.</p>
        </div>
        <div className={styles.limit} aria-label="Duración del partido">
          {([15, 30] as const).map((points) => (
            <button
              type="button"
              key={points}
              className={state.limit === points ? styles.active : undefined}
              onClick={() => setLimit(points)}
            >
              A {points}
            </button>
          ))}
        </div>
      </section>

      <div className={styles.series}>
        <span>Partidos</span>
        <strong>{state.games[0]}</strong>
        <i>—</i>
        <strong>{state.games[1]}</strong>
      </div>

      <section className={styles.board}>
        <TeamPanel
          team={state.teams[0]}
          index={0}
          limit={state.limit}
          winner={winner === 0}
          onAdd={addPoints}
          onRename={rename}
        />
        <span className={styles.vs}>VS</span>
        <TeamPanel
          team={state.teams[1]}
          index={1}
          limit={state.limit}
          winner={winner === 1}
          onAdd={addPoints}
          onRename={rename}
        />
      </section>

      <footer className={styles.footer}>
        <button type="button" onClick={undo} disabled={!state.history.length || winner !== -1}>
          <RotateCcw size={16} />
          Deshacer
        </button>
        <span>{winner === -1 ? `Primero en llegar a ${state.limit}` : `${state.teams[winner].name} ganó`}</span>
        <button type="button" className={styles.newGame} onClick={newGame}>
          {winner === -1 ? "Nueva partida" : "Jugar revancha"}
        </button>
      </footer>
    </main>
  );
}

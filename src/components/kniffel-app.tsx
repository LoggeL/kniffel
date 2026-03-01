"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  type Category,
  calculateCategoryScore,
} from "@/lib/kniffel";
import { getSocket } from "@/lib/socket";
import type { AckResponse, PlayerState, RoomState } from "@/lib/types";
import { DiceBox } from "@/components/dice-box";

const CLIENT_ID_KEY = "kniffel-client-id";
const PLAYER_NAME_KEY = "kniffel-player-name";
const ROOM_CODE_KEY = "kniffel-room-code";

interface ScoreCategoryRow {
  category: Category;
  label: string;
  icon?: string;
  description: string;
}

const UPPER_SCORE_ROWS: ScoreCategoryRow[] = [
  { category: "ones", label: "Einser", icon: "⚀", description: "nur Einser zählen" },
  { category: "twos", label: "Zweier", icon: "⚁", description: "nur Zweier zählen" },
  { category: "threes", label: "Dreier", icon: "⚂", description: "nur Dreier zählen" },
  { category: "fours", label: "Vierer", icon: "⚃", description: "nur Vierer zählen" },
  { category: "fives", label: "Fünfer", icon: "⚄", description: "nur Fünfer zählen" },
  { category: "sixes", label: "Sechser", icon: "⚅", description: "nur Sechser zählen" },
];

const LOWER_SCORE_ROWS: ScoreCategoryRow[] = [
  { category: "threeOfAKind", label: "Dreierpasch", description: "Alle Augen zählen" },
  { category: "fourOfAKind", label: "Viererpasch", description: "Alle Augen zählen" },
  { category: "fullHouse", label: "Full House", description: "25 Punkte" },
  { category: "smallStraight", label: "Kleine Straße", description: "30 Punkte" },
  { category: "largeStraight", label: "Große Straße", description: "40 Punkte" },
  { category: "yahtzee", label: "Kniffel (5 gleiche)", description: "50 Punkte" },
  { category: "chance", label: "Chance", description: "Alle Augen zählen" },
];

function buildClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `c-${Math.random().toString(36).slice(2, 10)}`;
}

function findPlayer(room: RoomState | null, playerId: string): PlayerState | null {
  if (!room) {
    return null;
  }
  return room.players.find((player) => player.id === playerId) || null;
}

export function KniffelApp() {
  const socket = getSocket();

  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const savedClientId = localStorage.getItem(CLIENT_ID_KEY) || buildClientId();
    const savedName = localStorage.getItem(PLAYER_NAME_KEY) || "";
    const savedRoomCode = (localStorage.getItem(ROOM_CODE_KEY) || "").toUpperCase();

    localStorage.setItem(CLIENT_ID_KEY, savedClientId);
    setClientId(savedClientId);
    setName(savedName);
    setCodeInput(savedRoomCode);

    const onConnect = () => {
      setConnected(true);

      if (!savedRoomCode) {
        return;
      }

      socket.emit(
        "room:reconnect",
        { code: savedRoomCode, clientId: savedClientId, name: savedName },
        (ack: AckResponse) => {
          if (!ack?.ok) {
            localStorage.removeItem(ROOM_CODE_KEY);
            setRoom(null);
          }
        }
      );
    };

    const onDisconnect = () => {
      setConnected(false);
    };

    const onRoomUpdate = (incoming: RoomState) => {
      setRoom(incoming);
      localStorage.setItem(ROOM_CODE_KEY, incoming.code);
    };

    const onActionError = (message: string) => {
      setError(message);
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onRoomUpdate);
    socket.on("action:error", onActionError);

    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onRoomUpdate);
      socket.off("action:error", onActionError);
    };
  }, [socket]);

  useEffect(() => {
    if (!error) {
      return;
    }
    const timer = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(timer);
  }, [error]);

  const me = useMemo(() => findPlayer(room, clientId), [room, clientId]);
  const currentPlayer = useMemo(() => {
    if (!room?.currentPlayerId) {
      return null;
    }
    return room.players.find((player) => player.id === room.currentPlayerId) || null;
  }, [room]);

  const isHost = Boolean(room && clientId && room.hostId === clientId);
  const isMyTurn = Boolean(room && room.status === "playing" && room.currentPlayerId === clientId);
  const canRoll = Boolean(isMyTurn && room && room.turn.rollsLeft > 0);

  const scorePreview = useMemo(() => {
    const preview: Partial<Record<Category, number>> = {};

    if (!room || !me || !isMyTurn || room.turn.rollsUsed === 0) {
      return preview;
    }

    for (const category of CATEGORIES) {
      if (typeof me.scores[category] === "number") {
        continue;
      }
      preview[category] = calculateCategoryScore(category, room.turn.dice);
    }

    return preview;
  }, [room, me, isMyTurn]);

  const winnerText = useMemo(() => {
    if (!room || room.status !== "finished" || room.winnerIds.length === 0) {
      return "";
    }

    const names = room.winnerIds
      .map((winnerId) => room.players.find((player) => player.id === winnerId)?.name)
      .filter(Boolean);

    return names.join(", ");
  }, [room]);

  const requireName = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Bitte gib zuerst deinen Namen ein.");
      return null;
    }
    localStorage.setItem(PLAYER_NAME_KEY, trimmed);
    return trimmed;
  };

  const ensureClientId = (): string => {
    if (clientId) {
      return clientId;
    }

    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored) {
      setClientId(stored);
      return stored;
    }

    const generated = buildClientId();
    localStorage.setItem(CLIENT_ID_KEY, generated);
    setClientId(generated);
    return generated;
  };

  const clearRoomState = () => {
    localStorage.removeItem(ROOM_CODE_KEY);
    setRoom(null);
  };

  const handleCreateRoom = () => {
    const trimmedName = requireName();
    if (!trimmedName) {
      return;
    }
    const ensuredClientId = ensureClientId();

    socket.emit(
      "room:create",
      { name: trimmedName, clientId: ensuredClientId },
      (ack: AckResponse) => {
        if (!ack?.ok || !ack.code) {
          setError(ack?.error || "Raum konnte nicht erstellt werden.");
          return;
        }
        localStorage.setItem(ROOM_CODE_KEY, ack.code);
      }
    );
  };

  const handleJoinRoom = () => {
    const trimmedName = requireName();
    if (!trimmedName) {
      return;
    }
    const ensuredClientId = ensureClientId();

    const code = codeInput.trim().toUpperCase();
    if (!code) {
      setError("Bitte gib einen Raumcode ein.");
      return;
    }

    socket.emit(
      "room:join",
      { code, name: trimmedName, clientId: ensuredClientId },
      (ack: AckResponse) => {
        if (!ack?.ok || !ack.code) {
          setError(ack?.error || "Raum konnte nicht betreten werden.");
          return;
        }
        localStorage.setItem(ROOM_CODE_KEY, ack.code);
      }
    );
  };

  const handleLeaveRoom = () => {
    if (!room) {
      clearRoomState();
      return;
    }

    socket.emit("room:leave", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) {
        setError(ack?.error || "Raum konnte nicht verlassen werden.");
        return;
      }
      clearRoomState();
    });
  };

  const handleStartGame = () => {
    if (!room) {
      return;
    }
    socket.emit("game:start", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) {
        setError(ack?.error || "Spiel konnte nicht gestartet werden.");
      }
    });
  };

  const handleRoll = () => {
    if (!room) {
      return;
    }
    socket.emit("game:roll", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) {
        setError(ack?.error || "Wurf fehlgeschlagen.");
      }
    });
  };

  const handleToggleHold = (index: number) => {
    if (!room) {
      return;
    }
    socket.emit("game:toggleHold", { code: room.code, index }, (ack: AckResponse) => {
      if (!ack?.ok) {
        setError(ack?.error || "Wuerfel konnte nicht gehalten werden.");
      }
    });
  };

  const handleScore = (category: Category) => {
    if (!room) {
      return;
    }

    socket.emit("game:score", { code: room.code, category }, (ack: AckResponse) => {
      if (!ack?.ok) {
        setError(ack?.error || "Punkte konnten nicht eingetragen werden.");
      }
    });
  };

  const copyCode = async () => {
    if (!room) {
      return;
    }

    try {
      await navigator.clipboard.writeText(room.code);
      setError("Raumcode kopiert.");
    } catch {
      setError("Kopieren nicht verfuegbar.");
    }
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#efe4ca] text-[#163f7b]">
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            "radial-gradient(circle_at_12%_8%, rgba(255,255,255,0.55), transparent 40%), radial-gradient(circle_at_88%_90%, rgba(29,78,164,0.1), transparent 42%), repeating-linear-gradient(0deg, rgba(24,61,124,0.05) 0 1px, transparent 1px 30px), repeating-linear-gradient(90deg, rgba(24,61,124,0.028) 0 1px, transparent 1px 42px)",
        }}
      />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 pb-10 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-[24px] border-2 border-[#2a4f89]/70 bg-[#f8eed8]/90 p-4 shadow-[0_18px_38px_-30px_rgba(15,23,42,0.85)] backdrop-blur sm:p-5">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-[#123f84] sm:text-3xl">
              Kniffel Mehrspieler
            </h1>
            <p className="text-sm text-[#335d99]">Klassische Gewinnkarte fuer 2 bis 6 Spieler</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-[#2a4f89]/60 bg-[#f3e7cd] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#315e99]">
            <span
              className={[
                "h-2 w-2 rounded-full",
                connected ? "bg-[#1f5aab] shadow-[0_0_8px_rgba(32,84,165,0.5)]" : "bg-[#b65353]",
              ].join(" ")}
            />
            {connected ? "Verbunden" : "Getrennt"}
          </div>
        </header>

        {error && <div className="rounded-lg border border-[#2a4f89]/50 bg-[#ecddbf] px-4 py-2 text-sm text-[#214c8f]">{error}</div>}

        {!room && (
          <section className="mx-auto grid w-full max-w-3xl gap-4 rounded-[28px] border-2 border-[#2a4f89]/70 bg-[#f6ecd6]/90 p-5 shadow-[0_28px_60px_-46px_rgba(15,23,42,0.95)] backdrop-blur sm:grid-cols-2 sm:p-8">
            <div className="sm:col-span-2">
              <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-[#315e99]" htmlFor="name-input">
                Dein Name
              </label>
              <input
                id="name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={24}
                placeholder="z. B. Mia"
                className="w-full border-0 border-b-2 border-[#2a4f89]/55 bg-transparent px-1 py-2 text-lg text-[#123f84] outline-none transition placeholder:text-[#6481ad] focus:border-[#123f84]"
              />
            </div>

            <button
              type="button"
              onClick={handleCreateRoom}
              className="rounded-md border border-[#2a4f89]/70 bg-[#e6d8ba] px-4 py-3 font-semibold uppercase tracking-[0.08em] text-[#123f84] transition hover:bg-[#ddcfaf]"
            >
              Raum erstellen
            </button>

            <div className="flex gap-2">
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                maxLength={6}
                placeholder="Code"
                className="w-full border-0 border-b-2 border-[#2a4f89]/55 bg-transparent px-1 py-2 text-lg uppercase tracking-[0.2em] text-[#123f84] outline-none transition placeholder:tracking-normal placeholder:text-[#6481ad] focus:border-[#123f84]"
              />
              <button
                type="button"
                onClick={handleJoinRoom}
                className="rounded-md border border-[#2a4f89]/70 bg-[#dde7f7] px-4 py-3 font-semibold uppercase tracking-[0.08em] text-[#123f84] transition hover:bg-[#cfddf4]"
              >
                Join
              </button>
            </div>
          </section>
        )}

        {room && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border-2 border-[#2a4f89]/70 bg-[#f6ecd5]/90 p-4 shadow-[0_14px_30px_-24px_rgba(15,23,42,0.7)]">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-[#315e99]">Raum</p>
                <div className="flex items-center gap-2">
                  <span className="rounded-md border border-[#2a4f89]/60 bg-[#e6d8bb] px-3 py-1 font-mono text-lg tracking-[0.2em] text-[#123f84]">
                    {room.code}
                  </span>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="rounded-md border border-[#2a4f89]/55 bg-[#f0e4c8] px-3 py-1 text-sm text-[#214c8f] transition hover:bg-[#e4d5b6]"
                  >
                    Kopieren
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="rounded-md border border-[#2a4f89]/65 bg-[#e8d8b7] px-3 py-2 text-sm text-[#123f84] transition hover:bg-[#ddcba8]"
                >
                  Raum verlassen
                </button>
              </div>
            </div>

            {room.status === "lobby" && (
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-[20px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 p-4">
                  <h2 className="text-lg font-semibold text-[#123f84]">Lobby</h2>
                  <p className="mt-1 text-sm text-[#315e99]">
                    Warte auf Mitspieler ({room.players.length}/{room.maxPlayers})
                  </p>
                  <ul className="mt-4 grid gap-2">
                    {room.players.map((player) => (
                      <li
                        key={player.id}
                        className="flex items-center justify-between rounded-md border border-[#2a4f89]/45 bg-[#efe1c2] px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-[#123f84]">{player.name}</span>
                          {player.id === room.hostId && (
                            <span className="rounded-full border border-[#2a4f89]/45 bg-[#d7e5fb] px-2 py-0.5 text-xs text-[#123f84]">
                              Host
                            </span>
                          )}
                          {player.id === clientId && (
                            <span className="rounded-full border border-[#2a4f89]/45 bg-[#e7dbc0] px-2 py-0.5 text-xs text-[#123f84]">
                              Du
                            </span>
                          )}
                        </div>
                        <span
                          className={[
                            "text-xs",
                            player.connected ? "text-[#1f5aab]" : "text-[#6f86ad]",
                          ].join(" ")}
                        >
                          {player.connected ? "online" : "offline"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={handleStartGame}
                    disabled={!isHost || room.players.length < room.minPlayers}
                    className={[
                      "w-full rounded-md border px-5 py-3 font-semibold uppercase tracking-[0.1em] transition lg:w-auto",
                      isHost && room.players.length >= room.minPlayers
                        ? "border-[#2a4f89]/70 bg-[#dde9fa] text-[#123f84] hover:bg-[#cfddf2]"
                        : "cursor-not-allowed border-[#7f92b3]/45 bg-[#e6dcc5]/70 text-[#7f92b3]",
                    ].join(" ")}
                  >
                    Spiel starten
                  </button>
                </div>
              </div>
            )}

            {room.status !== "lobby" && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                  <div className="rounded-[20px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 p-4">
                    <p className="text-sm text-[#315e99]">
                      Runde {Math.max(room.currentRound, 1)} / {room.maxRounds}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-[#123f84]">
                      {room.status === "finished"
                        ? "Spiel beendet"
                        : currentPlayer
                          ? `${currentPlayer.name} ist am Zug`
                          : "Warte auf Spieler"}
                    </p>
                    {isMyTurn && room.status === "playing" && (
                      <p className="mt-1 text-sm text-[#1f5aab]">Du bist dran.</p>
                    )}
                  </div>

                  <div className="rounded-[20px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 px-4 py-3">
                    <p className="text-xs uppercase tracking-[0.14em] text-[#315e99]">Spieler</p>
                    <p className="mt-1 text-sm text-[#214c8f]">
                      {room.players.length} Teilnehmer · {room.maxRounds} Runden
                    </p>
                  </div>
                </div>

                <div className="rounded-[22px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm uppercase tracking-[0.16em] text-[#315e99]">Wuerfel</h3>
                    <div className="text-sm text-[#214c8f]">
                      Wuerfe: {room.turn.rollsUsed} / 3 · Verbleibend: {room.turn.rollsLeft}
                    </div>
                  </div>

                  <DiceBox
                    dice={room.turn.dice}
                    held={room.turn.held}
                    disabled={!isMyTurn || room.turn.rollsUsed === 0 || room.status !== "playing"}
                    rollSequence={room.turn.rollSequence}
                    onToggleHold={handleToggleHold}
                  />

                  <button
                    type="button"
                    onClick={handleRoll}
                    disabled={!canRoll || room.status !== "playing"}
                    className={[
                      "mt-4 w-full rounded-md border px-4 py-3 font-semibold uppercase tracking-[0.08em] transition",
                      canRoll && room.status === "playing"
                        ? "border-[#2a4f89]/70 bg-[#dce8f8] text-[#123f84] hover:bg-[#ccd9ef]"
                        : "cursor-not-allowed border-[#7f92b3]/45 bg-[#e6dcc5]/70 text-[#7f92b3]",
                    ].join(" ")}
                  >
                    Wuerfeln
                  </button>
                </div>

                <div
                  className="rounded-[30px] border border-[#204b88]/70 bg-[#efe2c5] p-3 shadow-[0_26px_60px_-45px_rgba(15,23,42,0.95)] sm:p-4"
                  style={{
                    fontFamily: "var(--font-kniffel-serif), serif",
                    backgroundImage:
                      "radial-gradient(circle_at_top_right, rgba(255,255,255,0.35), transparent 52%), repeating-linear-gradient(0deg, rgba(33,75,135,0.05) 0 1px, transparent 1px 24px)",
                  }}
                >
                  <div className="rounded-[22px] border border-[#2a4f89]/70 bg-[#f4e9d1]/95 p-2 shadow-inner shadow-[#a98f5a1f] sm:p-3">
                    <div className="mb-3 border-b border-[#2a4f89]/60 px-2 pb-2">
                      <p className="text-[11px] uppercase tracking-[0.22em] text-[#2a4f89]">Kniffel-Gewinnkarte</p>
                      <p className="mt-1 text-sm font-semibold text-[#123f84]">Punkteblatt</p>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="min-w-[820px] w-full border-collapse text-sm text-[#1d4a89]">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-30 border border-[#2a4f89]/70 bg-[#e6d8ba] px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em]">
                              Kombination
                            </th>
                            {room.players.map((player) => (
                              <th
                                key={player.id}
                                className={[
                                  "border border-[#2a4f89]/70 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.09em]",
                                  room.currentPlayerId === player.id
                                    ? "bg-[#d5e5fb] text-[#113a78]"
                                    : "bg-[#e6d8ba] text-[#1d4a89]",
                                ].join(" ")}
                              >
                                {player.name}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          <tr>
                            <td
                              colSpan={room.players.length + 1}
                              className="border border-[#2a4f89]/70 bg-[#e0d0af] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em]"
                            >
                              Oberer Teil
                            </td>
                          </tr>

                          {UPPER_SCORE_ROWS.map((row) => (
                            <tr key={row.category}>
                              <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#f4e9d1] px-3 py-2 align-top">
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 text-lg text-[#1f4f93]">{row.icon}</span>
                                  <div>
                                    <div className="font-semibold text-[#143f82]">{row.label}</div>
                                    <div className="text-xs text-[#355d98]">{row.description}</div>
                                  </div>
                                </div>
                              </td>

                              {room.players.map((player) => {
                                const score = player.scores[row.category];
                                const isMyCell = player.id === clientId;
                                const previewValue = scorePreview[row.category];
                                const allowScore =
                                  room.status === "playing" &&
                                  isMyTurn &&
                                  isMyCell &&
                                  typeof score !== "number" &&
                                  typeof previewValue === "number";

                                return (
                                  <td
                                    key={`${player.id}-${row.category}`}
                                    className={[
                                      "border border-[#2a4f89]/65 px-3 py-2 text-center",
                                      room.currentPlayerId === player.id ? "bg-[#e5efff]" : "bg-[#f7ecd8]",
                                    ].join(" ")}
                                  >
                                    {typeof score === "number" && (
                                      <span
                                        className={[
                                          "font-bold",
                                          score === 0
                                            ? "text-[#b52f2f] line-through decoration-2"
                                            : "text-[#123f84]",
                                        ].join(" ")}
                                      >
                                        {score}
                                      </span>
                                    )}

                                    {allowScore && (
                                      <button
                                        type="button"
                                        onClick={() => handleScore(row.category)}
                                        className="rounded-md border border-[#7c8ba5]/70 bg-[#dbe4ee]/65 px-2 py-1 text-xs font-semibold text-[#4a5972] transition hover:bg-[#ced8e6]"
                                      >
                                        {previewValue}
                                      </button>
                                    )}

                                    {typeof score !== "number" && !allowScore && (
                                      <span className="text-[#8a94a8]/80">-</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#ece0c5] px-3 py-2 font-semibold text-[#184587]">
                              Gesamt oberer Teil →
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-upper-total`}
                                className={[
                                  "border border-[#2a4f89]/65 px-3 py-2 text-center font-semibold text-[#123f84]",
                                  room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#f3e6ce]",
                                ].join(" ")}
                              >
                                {player.upperTotal}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#ece0c5] px-3 py-2 text-sm text-[#1f4f93]">
                              Bonus bei 63 oder mehr = 35 →
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-bonus`}
                                className={[
                                  "border border-[#2a4f89]/65 px-3 py-2 text-center font-semibold text-[#123f84]",
                                  room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#f3e6ce]",
                                ].join(" ")}
                              >
                                {player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt oberer Teil
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-upper-with-bonus`}
                                className={[
                                  "border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]",
                                  room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]",
                                ].join(" ")}
                              >
                                {player.upperTotal + player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td
                              colSpan={room.players.length + 1}
                              className="border border-[#2a4f89]/70 bg-[#dccba8] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em]"
                            >
                              Unterer Teil
                            </td>
                          </tr>

                          {LOWER_SCORE_ROWS.map((row) => (
                            <tr key={row.category}>
                              <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#f4e9d1] px-3 py-2 align-top">
                                <div>
                                  <div className="font-semibold text-[#143f82]">{row.label}</div>
                                  <div className="text-xs text-[#355d98]">{row.description}</div>
                                </div>
                              </td>

                              {room.players.map((player) => {
                                const score = player.scores[row.category];
                                const isMyCell = player.id === clientId;
                                const previewValue = scorePreview[row.category];
                                const allowScore =
                                  room.status === "playing" &&
                                  isMyTurn &&
                                  isMyCell &&
                                  typeof score !== "number" &&
                                  typeof previewValue === "number";

                                return (
                                  <td
                                    key={`${player.id}-${row.category}`}
                                    className={[
                                      "border border-[#2a4f89]/65 px-3 py-2 text-center",
                                      room.currentPlayerId === player.id ? "bg-[#e5efff]" : "bg-[#f7ecd8]",
                                    ].join(" ")}
                                  >
                                    {typeof score === "number" && (
                                      <span
                                        className={[
                                          "font-bold",
                                          score === 0
                                            ? "text-[#b52f2f] line-through decoration-2"
                                            : "text-[#123f84]",
                                        ].join(" ")}
                                      >
                                        {score}
                                      </span>
                                    )}

                                    {allowScore && (
                                      <button
                                        type="button"
                                        onClick={() => handleScore(row.category)}
                                        className="rounded-md border border-[#7c8ba5]/70 bg-[#dbe4ee]/65 px-2 py-1 text-xs font-semibold text-[#4a5972] transition hover:bg-[#ced8e6]"
                                      >
                                        {previewValue}
                                      </button>
                                    )}

                                    {typeof score !== "number" && !allowScore && (
                                      <span className="text-[#8a94a8]/80">-</span>
                                    )}
                                  </td>
                                );
                              })}
                            </tr>
                          ))}

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt unterer Teil
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-lower-total`}
                                className={[
                                  "border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]",
                                  room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]",
                                ].join(" ")}
                              >
                                {player.lowerTotal}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt oberer Teil (Übertrag)
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-carried-upper`}
                                className={[
                                  "border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]",
                                  room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]",
                                ].join(" ")}
                              >
                                {player.upperTotal + player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border-2 border-[#2a4f89]/80 bg-[#d6c39c] px-3 py-2 text-base font-bold text-[#0f366f]">
                              Endsumme
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-total`}
                                className={[
                                  "border-2 border-[#2a4f89]/80 px-3 py-2 text-center text-base font-extrabold text-[#0f366f]",
                                  room.currentPlayerId === player.id ? "bg-[#cdddf4]" : "bg-[#e7d5b2]",
                                ].join(" ")}
                              >
                                {player.total}
                              </td>
                            ))}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}
      </div>

      <AnimatePresence>
        {room?.status === "finished" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-[#e2d2af]/85 p-4 backdrop-blur-[2px]"
          >
            <motion.div
              initial={{ y: 30, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full max-w-xl rounded-[26px] border-2 border-[#2a4f89]/70 bg-[#f5ebd5] p-6 text-[#123f84] shadow-[0_24px_54px_-38px_rgba(15,23,42,0.9)]"
            >
              <h2 className="text-2xl font-semibold text-[#123f84]">Spiel vorbei</h2>
              <p className="mt-2 text-[#214c8f]">
                Gewinner: <span className="font-semibold text-[#1f5aab]">{winnerText || "Unbekannt"}</span>
              </p>
              {me && <p className="mt-1 text-sm text-[#315e99]">Dein Endstand: {me.total} Punkte</p>}

              <div className="mt-4 space-y-2">
                {room.players
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded-md border border-[#2a4f89]/50 bg-[#ebddbe] px-3 py-2"
                    >
                      <span className="text-[#123f84]">{player.name}</span>
                      <span className="font-semibold text-[#1f5aab]">{player.total}</span>
                    </div>
                  ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="rounded-md border border-[#2a4f89]/65 bg-[#dbe7f8] px-4 py-2 text-sm font-medium text-[#123f84] transition hover:bg-[#ccd9f0]"
                >
                  Zur Startseite
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

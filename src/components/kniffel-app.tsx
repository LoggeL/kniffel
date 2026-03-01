"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import {
  CATEGORIES,
  CATEGORY_LABELS,
  type Category,
  calculateCategoryScore,
} from "@/lib/kniffel";
import { getSocket } from "@/lib/socket";
import type { AckResponse, PlayerState, RoomState } from "@/lib/types";
import { DiceBox } from "@/components/dice-box";

const CLIENT_ID_KEY = "kniffel-client-id";
const PLAYER_NAME_KEY = "kniffel-player-name";
const ROOM_CODE_KEY = "kniffel-room-code";

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
    <main className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(14,116,144,0.22),_transparent_45%),radial-gradient(circle_at_bottom,_rgba(249,115,22,0.18),_transparent_35%)]" />

      <div className="relative mx-auto flex w-full max-w-7xl flex-col gap-6 p-4 pb-10 sm:p-6 lg:p-8">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 backdrop-blur">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-cyan-100 sm:text-3xl">
              Kniffel Mehrspieler
            </h1>
            <p className="text-sm text-slate-300">Echtzeitspiel fuer 2 bis 6 Spieler</p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-700 px-3 py-1 text-xs uppercase tracking-wide text-slate-300">
            <span
              className={[
                "h-2 w-2 rounded-full",
                connected ? "bg-emerald-400 shadow-[0_0_10px_rgba(16,185,129,0.8)]" : "bg-rose-400",
              ].join(" ")}
            />
            {connected ? "Verbunden" : "Getrennt"}
          </div>
        </header>

        {error && (
          <div className="rounded-xl border border-rose-500/40 bg-rose-950/60 px-4 py-2 text-sm text-rose-200">
            {error}
          </div>
        )}

        {!room && (
          <section className="mx-auto grid w-full max-w-3xl gap-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 shadow-2xl shadow-slate-950/30 backdrop-blur sm:grid-cols-2 sm:p-8">
            <div className="sm:col-span-2">
              <label className="mb-1 block text-sm text-slate-300" htmlFor="name-input">
                Dein Name
              </label>
              <input
                id="name-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={24}
                placeholder="z. B. Mia"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none ring-cyan-400 transition focus:ring-2"
              />
            </div>

            <button
              type="button"
              onClick={handleCreateRoom}
              className="rounded-xl border border-cyan-500/50 bg-cyan-500/15 px-4 py-3 font-medium text-cyan-100 transition hover:bg-cyan-500/25"
            >
              Raum erstellen
            </button>

            <div className="flex gap-2">
              <input
                value={codeInput}
                onChange={(event) => setCodeInput(event.target.value.toUpperCase())}
                maxLength={6}
                placeholder="Code"
                className="w-full rounded-xl border border-slate-700 bg-slate-950/70 px-4 py-3 text-slate-100 outline-none ring-amber-400 transition focus:ring-2"
              />
              <button
                type="button"
                onClick={handleJoinRoom}
                className="rounded-xl border border-amber-500/50 bg-amber-500/15 px-4 py-3 font-medium text-amber-100 transition hover:bg-amber-500/25"
              >
                Join
              </button>
            </div>
          </section>
        )}

        {room && (
          <section className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur">
              <div className="space-y-1">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-400">Raum</p>
                <div className="flex items-center gap-2">
                  <span className="rounded-lg bg-slate-950/70 px-3 py-1 font-mono text-lg tracking-[0.2em] text-cyan-100">
                    {room.code}
                  </span>
                  <button
                    type="button"
                    onClick={copyCode}
                    className="rounded-lg border border-slate-700 px-3 py-1 text-sm text-slate-200 transition hover:border-cyan-400 hover:text-cyan-200"
                  >
                    Kopieren
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-200 transition hover:bg-rose-500/20"
                >
                  Raum verlassen
                </button>
              </div>
            </div>

            {room.status === "lobby" && (
              <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <h2 className="text-lg font-semibold text-slate-100">Lobby</h2>
                  <p className="mt-1 text-sm text-slate-300">
                    Warte auf Mitspieler ({room.players.length}/{room.maxPlayers})
                  </p>
                  <ul className="mt-4 grid gap-2">
                    {room.players.map((player) => (
                      <li
                        key={player.id}
                        className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/50 px-3 py-2"
                      >
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-100">{player.name}</span>
                          {player.id === room.hostId && (
                            <span className="rounded-full bg-cyan-500/15 px-2 py-0.5 text-xs text-cyan-200">
                              Host
                            </span>
                          )}
                          {player.id === clientId && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-200">
                              Du
                            </span>
                          )}
                        </div>
                        <span
                          className={[
                            "text-xs",
                            player.connected ? "text-emerald-300" : "text-slate-500",
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
                      "w-full rounded-xl border px-5 py-3 font-semibold transition lg:w-auto",
                      isHost && room.players.length >= room.minPlayers
                        ? "border-cyan-400/60 bg-cyan-400/20 text-cyan-100 hover:bg-cyan-400/30"
                        : "cursor-not-allowed border-slate-700 bg-slate-800/70 text-slate-500",
                    ].join(" ")}
                  >
                    Spiel starten
                  </button>
                </div>
              </div>
            )}

            {room.status !== "lobby" && (
              <div className="grid gap-4 xl:grid-cols-[360px_1fr]">
                <aside className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <p className="text-sm text-slate-300">
                      Runde {Math.max(room.currentRound, 1)} / {room.maxRounds}
                    </p>
                    <p className="mt-1 text-lg font-semibold text-cyan-100">
                      {room.status === "finished"
                        ? "Spiel beendet"
                        : currentPlayer
                          ? `${currentPlayer.name} ist am Zug`
                          : "Warte auf Spieler"}
                    </p>
                    {isMyTurn && room.status === "playing" && (
                      <p className="mt-1 text-sm text-amber-200">Du bist dran.</p>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    <h3 className="text-sm uppercase tracking-[0.16em] text-slate-400">Wuerfel</h3>
                    <DiceBox
                      dice={room.turn.dice}
                      held={room.turn.held}
                      disabled={!isMyTurn || room.turn.rollsUsed === 0 || room.status !== "playing"}
                      rollSequence={room.turn.rollSequence}
                      onToggleHold={handleToggleHold}
                    />

                    <div className="mt-4 flex items-center justify-between text-sm text-slate-300">
                      <span>Wuerfe: {room.turn.rollsUsed} / 3</span>
                      <span>Verbleibend: {room.turn.rollsLeft}</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleRoll}
                      disabled={!canRoll || room.status !== "playing"}
                      className={[
                        "mt-4 w-full rounded-xl border px-4 py-3 font-semibold transition",
                        canRoll && room.status === "playing"
                          ? "border-amber-400/60 bg-amber-400/20 text-amber-100 hover:bg-amber-400/30"
                          : "cursor-not-allowed border-slate-700 bg-slate-800/70 text-slate-500",
                      ].join(" ")}
                    >
                      Wuerfeln
                    </button>
                  </div>
                </aside>

                <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                  <div className="overflow-x-auto">
                    <table className="min-w-full border-separate border-spacing-0 text-sm">
                      <thead>
                        <tr>
                          <th className="sticky left-0 z-10 border-b border-slate-700 bg-slate-900 px-3 py-2 text-left font-medium text-slate-300">
                            Kategorie
                          </th>
                          {room.players.map((player) => (
                            <th
                              key={player.id}
                              className={[
                                "border-b border-slate-700 px-3 py-2 text-left font-medium",
                                room.currentPlayerId === player.id ? "text-cyan-200" : "text-slate-200",
                              ].join(" ")}
                            >
                              {player.name}
                            </th>
                          ))}
                        </tr>
                      </thead>

                      <tbody>
                        {CATEGORIES.map((category) => (
                          <tr key={category}>
                            <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 text-slate-300">
                              {CATEGORY_LABELS[category]}
                            </td>
                            {room.players.map((player) => {
                              const score = player.scores[category];
                              const isMyCell = player.id === clientId;
                              const previewValue = scorePreview[category];
                              const allowScore =
                                room.status === "playing" &&
                                isMyTurn &&
                                isMyCell &&
                                typeof score !== "number" &&
                                typeof previewValue === "number";

                              return (
                                <td
                                  key={`${player.id}-${category}`}
                                  className={[
                                    "border-b border-slate-800 px-3 py-2",
                                    room.currentPlayerId === player.id ? "bg-cyan-950/25" : "",
                                  ].join(" ")}
                                >
                                  {typeof score === "number" && (
                                    <span className="font-semibold text-slate-100">{score}</span>
                                  )}

                                  {allowScore && (
                                    <button
                                      type="button"
                                      onClick={() => handleScore(category)}
                                      className="rounded-md border border-amber-400/50 bg-amber-400/15 px-2 py-1 text-xs font-semibold text-amber-100 transition hover:bg-amber-400/25"
                                    >
                                      {previewValue} eintragen
                                    </button>
                                  )}

                                  {typeof score !== "number" && !allowScore && (
                                    <span className="text-slate-500">-</span>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}

                        {[
                          ["upperTotal", "Oberer Block"],
                          ["bonus", "Bonus (63+)"],
                          ["lowerTotal", "Unterer Block"],
                          ["total", "Gesamt"],
                        ].map(([key, label]) => (
                          <tr key={key}>
                            <td className="sticky left-0 z-10 border-b border-slate-800 bg-slate-900 px-3 py-2 font-semibold text-slate-200">
                              {label}
                            </td>
                            {room.players.map((player) => (
                              <td
                                key={`${player.id}-${key}`}
                                className={[
                                  "border-b border-slate-800 px-3 py-2 font-semibold",
                                  key === "total" ? "text-cyan-100" : "text-slate-200",
                                ].join(" ")}
                              >
                                {key === "upperTotal" && player.upperTotal}
                                {key === "bonus" && player.bonus}
                                {key === "lowerTotal" && player.lowerTotal}
                                {key === "total" && player.total}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
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
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm"
          >
            <motion.div
              initial={{ y: 30, scale: 0.96, opacity: 0 }}
              animate={{ y: 0, scale: 1, opacity: 1 }}
              exit={{ y: 20, opacity: 0 }}
              className="w-full max-w-xl rounded-3xl border border-cyan-500/30 bg-slate-900 p-6 shadow-2xl"
            >
              <h2 className="text-2xl font-semibold text-cyan-100">Spiel vorbei</h2>
              <p className="mt-2 text-slate-200">
                Gewinner: <span className="font-semibold text-amber-200">{winnerText || "Unbekannt"}</span>
              </p>
              {me && <p className="mt-1 text-sm text-slate-300">Dein Endstand: {me.total} Punkte</p>}

              <div className="mt-4 space-y-2">
                {room.players
                  .slice()
                  .sort((a, b) => b.total - a.total)
                  .map((player) => (
                    <div
                      key={player.id}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-2"
                    >
                      <span className="text-slate-100">{player.name}</span>
                      <span className="font-semibold text-cyan-100">{player.total}</span>
                    </div>
                  ))}
              </div>

              <div className="mt-6 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleLeaveRoom}
                  className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm font-medium text-rose-200 transition hover:bg-rose-500/20"
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

"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  CATEGORIES,
  UPPER_CATEGORIES,
  type Category,
  calculateCategoryScore,
} from "@/lib/kniffel";
import { getSocket } from "@/lib/socket";
import type {
  AckResponse,
  Achievement,
  ChatMessage,
  PlayerState,
  RoomState,
  ScoreActivity,
} from "@/lib/types";
import { ACHIEVEMENT_DEFS } from "@/lib/types";
import dynamic from "next/dynamic";

const DiceBox3D = dynamic(() => import("@/components/dice-box-3d").then((m) => ({ default: m.DiceBox3D })), { ssr: false });
import {
  playDiceRoll,
  playDiceLand,
  playScoreEntry,
  playKniffelFanfare,
  playCelebration,
  playPlacementReveal,
  playChatPop,
  playYourTurn,
  playNudge,
} from "@/lib/sounds";

const CLIENT_ID_KEY = "kniffel-client-id";
const PLAYER_NAME_KEY = "kniffel-player-name";
const ROOM_CODE_KEY = "kniffel-room-code";
const PLAYER_ICON_KEY = "kniffel-player-icon";

const ICON_CHOICES = [
  "🐱", "🐶", "🦊", "🐼", "🐨", "🦁", "🐸", "🐧", "🦉", "🐝",
  "🌟", "🔥", "💎", "🎲", "🎯", "🍀", "🌈", "⚡", "🎵", "🦄",
];


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
  if (!room) return null;
  return room.players.find((p) => p.id === playerId) || null;
}

type CelebrationKind = "kniffel" | "fullHouse" | "largeStraight" | "bonus" | null;

function detectCelebration(
  category: Category,
  dice: number[],
  player: PlayerState | null
): CelebrationKind {
  if (category === "yahtzee") {
    const counts = new Map<number, number>();
    for (const d of dice) counts.set(d, (counts.get(d) || 0) + 1);
    if ([...counts.values()].some((c) => c >= 5)) return "kniffel";
  }
  if (category === "fullHouse") {
    const counts = new Map<number, number>();
    for (const d of dice) counts.set(d, (counts.get(d) || 0) + 1);
    const vals = [...counts.values()].sort((a, b) => a - b);
    if (vals.length === 2 && vals[0] === 2 && vals[1] === 3) return "fullHouse";
  }
  if (category === "largeStraight") {
    const unique = [...new Set(dice)].sort((a, b) => a - b);
    if (unique.length === 5) {
      const j = unique.join(",");
      if (j === "1,2,3,4,5" || j === "2,3,4,5,6") return "largeStraight";
    }
  }
  if (player && (UPPER_CATEGORIES as readonly string[]).includes(category)) {
    const currentUpper = player.upperTotal;
    const scoreVal = calculateCategoryScore(category, dice);
    if (currentUpper < 63 && currentUpper + scoreVal >= 63) return "bonus";
  }
  return null;
}

// --- Haptic feedback ---
function vibrate(pattern: number | number[]) {
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // not available
  }
}

// --- Push notification ---
let notifPermission: NotificationPermission = "default";

function requestNotifPermission() {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    notifPermission = "granted";
    return;
  }
  if (Notification.permission !== "denied") {
    Notification.requestPermission().then((p) => {
      notifPermission = p;
    });
  }
}

function sendTurnNotification() {
  if (typeof Notification === "undefined" || notifPermission !== "granted") return;
  if (document.visibilityState !== "hidden") return;
  try {
    new Notification("Du bist dran! 🎲", {
      body: "Dein Zug bei Kniffel Multiplayer",
      icon: "/favicon.ico",
    });
  } catch {
    // ignore
  }
}

// --- Celebration Overlay ---
// Pre-computed confetti particles (avoid Math.random in render)
const CONFETTI_PARTICLES = Array.from({ length: 20 }, (_, i) => ({
  yOff: Math.random() * 200,
  x1: (Math.random() - 0.5) * 400,
  x2: (Math.random() - 0.5) * 600,
  rot: Math.random() * 720,
  dur: 2 + Math.random(),
  delay: Math.random() * 0.3,
  left: 30 + Math.random() * 40,
  color: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6bff", "#ff9f43"][i % 6],
}));

const WINNER_CONFETTI = Array.from({ length: 30 }, (_, i) => ({
  x1: Math.random() * 100,
  x2: Math.random() * 100,
  rot: Math.random() * 720,
  dur: 2 + Math.random() * 2,
  delay: Math.random() * 0.5,
  color: ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff6bff", "#ff9f43"][i % 6],
}));

function CelebrationOverlay({ kind, onDone }: { kind: CelebrationKind; onDone: () => void }) {
  useEffect(() => {
    const timeout = setTimeout(onDone, kind === "kniffel" ? 3000 : 2000);
    return () => clearTimeout(timeout);
  }, [kind, onDone]);

  if (!kind) return null;

  const configs: Record<string, { text: string; color: string; bg: string }> = {
    kniffel: {
      text: "KNIFFEL!",
      color: "#ffd700",
      bg: "radial-gradient(circle, rgba(255,215,0,0.3) 0%, transparent 70%)",
    },
    fullHouse: {
      text: "Full House!",
      color: "#e74c3c",
      bg: "radial-gradient(circle, rgba(231,76,60,0.2) 0%, transparent 70%)",
    },
    largeStraight: {
      text: "Große Straße!",
      color: "#3498db",
      bg: "radial-gradient(circle, rgba(52,152,219,0.2) 0%, transparent 70%)",
    },
    bonus: {
      text: "Bonus! +35",
      color: "#f39c12",
      bg: "radial-gradient(circle, rgba(243,156,18,0.2) 0%, transparent 70%)",
    },
  };

  const cfg = configs[kind] || configs.kniffel;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="pointer-events-none fixed inset-0 z-[60] flex items-center justify-center"
      style={{ background: cfg.bg }}
    >
      <motion.div
        initial={{ scale: 0.3, opacity: 0, rotate: -10 }}
        animate={{ scale: [0.3, 1.3, 1], opacity: [0, 1, 1], rotate: [-10, 5, 0] }}
        transition={{ duration: 0.6, times: [0, 0.6, 1] }}
        className="text-center"
      >
        <div
          className="text-5xl font-extrabold sm:text-7xl"
          style={{
            color: cfg.color,
            textShadow: `0 0 30px ${cfg.color}80, 0 4px 12px rgba(0,0,0,0.3)`,
            WebkitTextStroke: kind === "kniffel" ? "1px #b8860b" : "none",
          }}
        >
          {cfg.text}
        </div>
        {kind === "kniffel" && (
          <div className="mt-4 flex justify-center gap-2">
            {CONFETTI_PARTICLES.map((p, i) => (
              <motion.div
                key={i}
                initial={{ y: 0, x: 0, opacity: 1, scale: 1 }}
                animate={{
                  y: [0, -(100 + p.yOff), 300],
                  x: [p.x1, p.x2],
                  opacity: [1, 1, 0],
                  scale: [1, 1.2, 0.5],
                  rotate: [0, p.rot],
                }}
                transition={{ duration: p.dur, delay: p.delay }}
                className="absolute h-3 w-3 rounded-sm"
                style={{
                  backgroundColor: p.color,
                  left: `${p.left}%`,
                  top: "50%",
                }}
              />
            ))}
          </div>
        )}
      </motion.div>
    </motion.div>
  );
}

// --- Icon Picker ---
function IconPicker({ selected, onSelect }: { selected: string | null; onSelect: (icon: string) => void }) {
  return (
    <div className="mt-3">
      <p className="mb-2 text-xs uppercase tracking-[0.18em] text-[#315e99]">Dein Icon</p>
      <div className="grid grid-cols-10 gap-1.5">
        {ICON_CHOICES.map((icon) => (
          <button
            key={icon}
            type="button"
            onClick={() => onSelect(icon)}
            className={[
              "flex h-9 w-9 items-center justify-center rounded-md border text-lg transition hover:scale-110",
              selected === icon
                ? "border-[#123f84] bg-[#dde7f7] shadow-sm"
                : "border-[#2a4f89]/30 bg-[#f4e9d1]/60 hover:bg-[#e6d8bb]",
            ].join(" ")}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}


// --- Achievement Toast ---
function AchievementToast({ achievement, onDone }: { achievement: Achievement; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ x: 100, opacity: 0, scale: 0.8 }}
      animate={{ x: 0, opacity: 1, scale: 1 }}
      exit={{ x: 100, opacity: 0, scale: 0.8 }}
      className="flex items-center gap-3 rounded-xl border-2 border-[#2a4f89]/60 bg-[#f5ebd5] px-4 py-3 shadow-lg"
    >
      <span className="text-2xl">{achievement.icon}</span>
      <div>
        <div className="text-sm font-bold text-[#123f84]">{achievement.label}</div>
        <div className="text-xs text-[#315e99]">{achievement.description}</div>
      </div>
    </motion.div>
  );
}

// --- Score Activity Toast ---
function ScoreActivityToast({ activity, onDone }: { activity: ScoreActivity; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <motion.div
      initial={{ y: 60, opacity: 0, scale: 0.9 }}
      animate={{ y: 0, opacity: 1, scale: 1 }}
      exit={{ y: 60, opacity: 0, scale: 0.9 }}
      className="flex items-center gap-2 rounded-xl border border-[#2a4f89]/50 bg-[#f5ebd5]/95 px-4 py-2.5 shadow-lg backdrop-blur"
    >
      <span className="text-lg">{"\ud83c\udfb2"}</span>
      <span className="text-sm text-[#123f84]">
        <span className="font-bold" style={{ color: activity.playerColor }}>{activity.playerName}</span>
        {" hat "}
        <span className="font-semibold">{activity.categoryLabel}</span>
        {" ("}
        <span className="font-bold">{activity.score}</span>
        {") eingetragen"}
      </span>
    </motion.div>
  );
}

// --- Timer Bar ---
function TimerBar({ turnStartedAt, timerSeconds }: { turnStartedAt: number; timerSeconds: number }) {
  const [pct, setPct] = useState(100);

  useEffect(() => {
    const update = () => {
      const elapsed = (Date.now() - turnStartedAt) / 1000;
      const remaining = Math.max(0, 1 - elapsed / timerSeconds);
      setPct(remaining * 100);
    };
    update();
    const iv = setInterval(update, 200);
    return () => clearInterval(iv);
  }, [turnStartedAt, timerSeconds]);

  const color = pct > 50 ? "#2ecc71" : pct > 20 ? "#f39c12" : "#e74c3c";

  return (
    <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-[#e6d8ba]">
      <div
        className="h-full rounded-full transition-all duration-200"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

// --- Emoji Reactions ---
interface FloatingReaction {
  id: string;
  emoji: string;
  playerName: string;
  playerColor: string;
  playerIcon: string | null;
  spawnX: number;
}

const REACTION_EMOJIS = ["👏", "😂", "🤬", "🎉", "🔥", "💀", "😤", "🖕", "❓"];

function ReactionBar({
  onReact,
  reactions,
}: {
  onReact: (emoji: string) => void;
  reactions: FloatingReaction[];
}) {
  return (
    <>
      {/* Floating reactions */}
      <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
        <AnimatePresence>
          {reactions.map((r) => (
            <motion.div
              key={r.id}
              initial={{ opacity: 1, y: 0, x: `${r.spawnX}vw` }}
              animate={{ opacity: 0, y: -200 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 2, ease: "easeOut" }}
              className="absolute bottom-24 flex items-center gap-1"
            >
              <span className="text-3xl drop-shadow-lg">{r.emoji}</span>
              <span
                className="rounded-full bg-black/40 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-sm"
              >
                {r.playerIcon || ""} {r.playerName}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Reaction button bar */}
      <div className="fixed bottom-4 right-4 z-40 flex gap-1.5 rounded-full border-2 border-[#2a4f89]/60 bg-[#f5ebd5]/95 px-3 py-2 shadow-lg backdrop-blur md:bottom-6 md:right-6">
        {REACTION_EMOJIS.map((emoji) => (
          <button
            key={emoji}
            type="button"
            onClick={() => onReact(emoji)}
            className="rounded-full px-1 py-0.5 text-lg transition hover:scale-125 hover:bg-[#e6d8ba] active:scale-90"
          >
            {emoji}
          </button>
        ))}
      </div>
    </>
  );
}

// ===================
// MAIN COMPONENT
// ===================
// --- Animated Scoreboard ---
function AnimatedScoreboard({
  room,
  achievements,
  onLeave,
  onRematch,
  isHost,
}: {
  room: RoomState;
  achievements: Achievement[];
  onLeave: () => void;
  onRematch: () => void;
  isHost: boolean;
}) {
  const sorted = useMemo(
    () => room.players.slice().sort((a, b) => b.total - a.total),
    [room.players]
  );

  // Compute rank with tie-sharing (same score = same rank)
  const rankMap = useMemo(() => {
    const map = new Map<string, number>();
    let rank = 1;
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0 && sorted[i].total === sorted[i - 1].total) {
        map.set(sorted[i].id, map.get(sorted[i - 1].id)!);
      } else {
        map.set(sorted[i].id, rank);
      }
      rank++;
    }
    return map;
  }, [sorted]);
  const [revealedCount, setRevealedCount] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);
  const revealStarted = useRef(false);

  useEffect(() => {
    if (revealStarted.current) return;
    revealStarted.current = true;

    const total = sorted.length;
    // Reveal from last place to first
    let i = 0;
    const reveal = () => {
      if (i >= total) {
        setShowConfetti(true);
        return;
      }
      const place = total - i;
      playPlacementReveal(place);
      i++;
      setRevealedCount(i);
      setTimeout(reveal, place === 1 ? 600 : 1200);
    };
    setTimeout(reveal, 800);
  }, [sorted.length]);

  // Build revealed list (reversed: last place first, winner last)
  const revealOrder = useMemo(() => [...sorted].reverse(), [sorted]);
  const revealed = revealOrder.slice(0, revealedCount);

  return (
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

        <div className="mt-4 space-y-2">
          {revealed.map((player, idx) => {
            const place = rankMap.get(player.id) ?? sorted.indexOf(player) + 1;
            const isWinner = room.winnerIds.includes(player.id);
            const playerAchievements = achievements.filter((a) => a.playerId === player.id);

            return (
              <motion.div
                key={player.id}
                initial={{ x: -40, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ duration: 0.4, delay: idx * 0.1 }}
                className={[
                  "flex items-center justify-between rounded-md border px-3 py-2",
                  isWinner
                    ? "border-[#ffd700] bg-[#fdf6e0]"
                    : "border-[#2a4f89]/50 bg-[#ebddbe]",
                ].join(" ")}
              >
                <div className="flex items-center gap-2 text-[#123f84]">
                  <span className="w-8 text-center font-bold">
                    {isWinner && showConfetti ? "👑" : `${place}.`}
                  </span>
                  {player.icon && <span>{player.icon}</span>}
                  <span className={isWinner ? "font-bold" : ""}>{player.name}</span>
                  {playerAchievements.length > 0 && (
                    <span className="flex gap-0.5">
                      {playerAchievements.map((a) => (
                        <span key={a.type} title={a.label} className="text-sm">
                          {a.icon}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
                <motion.span
                  className="font-semibold text-[#1f5aab]"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.3 }}
                >
                  {player.total}
                </motion.span>
              </motion.div>
            );
          })}
        </div>

        {/* Confetti for winner */}
        {showConfetti && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {WINNER_CONFETTI.map((p, i) => (
              <motion.div
                key={i}
                initial={{ y: -20, x: `${p.x1}%`, opacity: 1 }}
                animate={{
                  y: "120%",
                  x: `${p.x2}%`,
                  rotate: p.rot,
                  opacity: 0,
                }}
                transition={{ duration: p.dur, delay: p.delay }}
                className="absolute h-2 w-2 rounded-sm"
                style={{
                  backgroundColor: p.color,
                }}
              />
            ))}
          </div>
        )}

        <div className="mt-6 flex flex-wrap gap-2">
          {isHost && (
            <button
              type="button"
              onClick={onRematch}
              className="rounded-md border border-[#2a4f89]/65 bg-[#dde9fa] px-4 py-2 text-sm font-medium text-[#123f84] transition hover:bg-[#cfddf2]"
            >
              Nochmal spielen
            </button>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-md border border-[#2a4f89]/65 bg-[#e8d8b7] px-4 py-2 text-sm font-medium text-[#123f84] transition hover:bg-[#ddcba8]"
          >
            Zur Startseite
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ===================
// MAIN COMPONENT
// ===================

export function KniffelApp() {
  const socket = getSocket();
  const searchParams = useSearchParams();

  const [clientId, setClientId] = useState("");
  const [name, setName] = useState("");
  const [codeInput, setCodeInput] = useState("");
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [selectedIcon, setSelectedIcon] = useState<string | null>(null);
  const [celebration, setCelebration] = useState<CelebrationKind>(null);
  const [flashedCell, setFlashedCell] = useState<{ playerId: string; category: Category } | null>(null);
  const [isSpectator, setIsSpectator] = useState(false);

  // Score confirmation state

  // Chat state
  const [floatingReactions, setFloatingReactions] = useState<FloatingReaction[]>([]);

  // Achievement state
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [achievementToasts, setAchievementToasts] = useState<Achievement[]>([]);

  // Score activity feed
  const [scoreActivities, setScoreActivities] = useState<ScoreActivity[]>([]);

  // Mobile scorecard: selected player tab
  const [mobileScorePlayer, setMobileScorePlayer] = useState<string | null>(null);

  // Rename state (lobby)
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Nudge state
  const [nudgeVisible, setNudgeVisible] = useState(false);
  const nudgeCooldownRef = useRef<boolean>(false);
  const nudgeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track previous rollSequence to keep dice in place after scoring
  const prevRollSeqRef = useRef(0);
  const [displayRollSeq, setDisplayRollSeq] = useState(0);

  // Previous turn player for notification
  const prevCurrentPlayerRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room) return;
    if (room.turn.rollSequence !== prevRollSeqRef.current && room.turn.rollSequence > 0) {
      setDisplayRollSeq(room.turn.rollSequence);
      playDiceRoll();
      vibrate(50);
      setTimeout(() => playDiceLand(), 800);
    }
    prevRollSeqRef.current = room.turn.rollSequence;
  }, [room?.turn.rollSequence, room]);

  // Push notification when it becomes my turn
  useEffect(() => {
    if (!room || !clientId) return;
    const currentPid = room.currentPlayerId;
    if (currentPid !== prevCurrentPlayerRef.current) {
      prevCurrentPlayerRef.current = currentPid;
      if (currentPid === clientId && room.status === "playing") {
        sendTurnNotification();
        if (document.visibilityState === "hidden") {
          document.title = "🎲 Dein Zug! - Kniffel";
        }
      }
    }
  }, [room?.currentPlayerId, room?.status, clientId]);

  // Restore title when tab becomes visible
  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === "visible") {
        document.title = "Kniffel Multiplayer";
      }
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, []);

  useEffect(() => {
    const savedClientId = localStorage.getItem(CLIENT_ID_KEY) || buildClientId();
    const savedName = localStorage.getItem(PLAYER_NAME_KEY) || "";
    const savedRoomCode = (localStorage.getItem(ROOM_CODE_KEY) || "").toUpperCase();
    const savedIcon = localStorage.getItem(PLAYER_ICON_KEY) || null;

    localStorage.setItem(CLIENT_ID_KEY, savedClientId);
    setClientId(savedClientId);
    setName(savedName);
    const urlRoom = searchParams.get("room")?.toUpperCase();
    const reconnectCode = urlRoom || savedRoomCode;
    setCodeInput(reconnectCode);
    if (savedIcon) setSelectedIcon(savedIcon);

    const onConnect = () => {
      setConnected(true);
      if (!reconnectCode) return;
      socket.emit(
        "room:reconnect",
        { code: reconnectCode, clientId: savedClientId, name: savedName, icon: savedIcon },
        (ack: AckResponse) => {
          if (!ack?.ok) {
            localStorage.removeItem(ROOM_CODE_KEY);
            setRoom(null);
          }
        }
      );
    };

    const onDisconnect = () => setConnected(false);
    const onRoomUpdate = (incoming: RoomState) => {
      setRoom(incoming);
      localStorage.setItem(ROOM_CODE_KEY, incoming.code);
      // Sync achievements from server
      if (incoming.achievements) {
        setAchievements(incoming.achievements);
      }
      const url = new URL(window.location.href);
      url.searchParams.set("room", incoming.code);
      window.history.replaceState({}, "", url.toString());
    };
    const onActionError = (message: string) => setError(message);
    const onChatMessage = (msg: ChatMessage) => {
      const reaction: FloatingReaction = {
        id: msg.id,
        emoji: msg.text,
        playerName: msg.playerName,
        playerColor: msg.playerColor,
        playerIcon: msg.playerIcon || null,
        spawnX: 5 + Math.random() * 80,
      };
      setFloatingReactions((prev) => [...prev, reaction]);
      setTimeout(() => {
        setFloatingReactions((prev) => prev.filter((r) => r.id !== reaction.id));
      }, 2500);
      playChatPop();
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("room:update", onRoomUpdate);
    socket.on("action:error", onActionError);
    socket.on("chat:message", onChatMessage);
    const onAchievement = (a: Achievement) => {
      setAchievements((prev) => [...prev, a]);
      setAchievementToasts((prev) => [...prev, a]);
    };
    socket.on("achievement:earned", onAchievement);
    const onScoreActivity = (activity: ScoreActivity) => {
      // Only show to other players (not the one who scored)
      if (activity.playerId === savedClientId) return;
      setScoreActivities((prev) => [...prev.slice(-1), activity]);
      setTimeout(() => {
        setScoreActivities((prev) => prev.filter((a) => a.id !== activity.id));
      }, 3500);
    };
    socket.on("score:activity", onScoreActivity);
    const onKicked = () => {
      setError("Du wurdest aus dem Raum entfernt.");
      localStorage.removeItem(ROOM_CODE_KEY);
      setRoom(null);
      setFloatingReactions([]);
      setAchievements([]);
      setIsSpectator(false);
      const url = new URL(window.location.href);
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.toString());
    };
    socket.on("room:kicked", onKicked);
    const onNudge = () => { playNudge(); };
    socket.on("game:nudge", onNudge);
    socket.connect();

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("room:update", onRoomUpdate);
      socket.off("action:error", onActionError);
      socket.off("chat:message", onChatMessage);
      socket.off("achievement:earned", onAchievement);
      socket.off("score:activity", onScoreActivity);
      socket.off("room:kicked", onKicked);
      socket.off("game:nudge", onNudge);
    };
  }, [socket, searchParams]);

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), 3500);
    return () => clearTimeout(timer);
  }, [error]);

  const me = useMemo(() => findPlayer(room, clientId), [room, clientId]);
  const currentPlayer = useMemo(() => {
    if (!room?.currentPlayerId) return null;
    return room.players.find((p) => p.id === room.currentPlayerId) || null;
  }, [room]);

  const activeColor = currentPlayer?.color || undefined;
  const isHost = Boolean(room && clientId && room.hostId === clientId);
  const isMyTurn = Boolean(!isSpectator && room && room.status === "playing" && room.currentPlayerId === clientId);
  const canRoll = Boolean(isMyTurn && room && room.turn.rollsLeft > 0);

  // Play ping when it becomes your turn
  const prevMyTurn = useRef(false);
  useEffect(() => {
    if (isMyTurn && !prevMyTurn.current) {
      playYourTurn();
    }
    prevMyTurn.current = isMyTurn;
  }, [isMyTurn]);

  // Nudge timer: show nudge button after 15s if current player hasn't rolled
  useEffect(() => {
    if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current);
    setNudgeVisible(false);
    if (!room || room.status !== "playing" || !currentPlayer || isMyTurn) return;
    if (room.turn.rollsUsed > 0) return; // already rolled, no nudge
    nudgeTimerRef.current = setTimeout(() => setNudgeVisible(true), 15000);
    return () => { if (nudgeTimerRef.current) clearTimeout(nudgeTimerRef.current); };
  }, [room?.currentPlayerId, room?.turn.rollsUsed, room?.status, isMyTurn]);

  const scorePreview = useMemo(() => {
    const preview: Partial<Record<Category, number>> = {};
    if (!room || !me || !isMyTurn || room.turn.rollsUsed === 0) return preview;
    for (const category of CATEGORIES) {
      if (typeof me.scores[category] === "number") continue;
      preview[category] = calculateCategoryScore(category, room.turn.dice);
    }
    return preview;
  }, [room, me, isMyTurn]);

  // --- Achievement detection ---

  const requireName = (): string | null => {
    const trimmed = name.trim();
    if (!trimmed) { setError("Bitte gib zuerst deinen Namen ein."); return null; }
    localStorage.setItem(PLAYER_NAME_KEY, trimmed);
    return trimmed;
  };

  const ensureClientId = (): string => {
    if (clientId) return clientId;
    const stored = localStorage.getItem(CLIENT_ID_KEY);
    if (stored) { setClientId(stored); return stored; }
    const generated = buildClientId();
    localStorage.setItem(CLIENT_ID_KEY, generated);
    setClientId(generated);
    return generated;
  };

  const clearRoomState = () => {
    localStorage.removeItem(ROOM_CODE_KEY);
    setRoom(null);
    setFloatingReactions([]);
    setAchievements([]);
    setIsSpectator(false);
    const url = new URL(window.location.href);
    url.searchParams.delete("room");
    window.history.replaceState({}, "", url.toString());
  };

  const handleSelectIcon = (icon: string) => {
    setSelectedIcon(icon);
    localStorage.setItem(PLAYER_ICON_KEY, icon);
  };

  const handleCreateRoom = () => {
    const trimmedName = requireName();
    if (!trimmedName) return;
    const ensuredClientId = ensureClientId();
    requestNotifPermission();
    socket.emit(
      "room:create",
      { name: trimmedName, clientId: ensuredClientId, icon: selectedIcon },
      (ack: AckResponse) => {
        if (!ack?.ok || !ack.code) { setError(ack?.error || "Raum konnte nicht erstellt werden."); return; }
        localStorage.setItem(ROOM_CODE_KEY, ack.code);
      }
    );
  };

  const handleJoinRoom = () => {
    const trimmedName = requireName();
    if (!trimmedName) return;
    const ensuredClientId = ensureClientId();
    const code = codeInput.trim().toUpperCase();
    if (!code) { setError("Bitte gib einen Raumcode ein."); return; }
    requestNotifPermission();
    socket.emit(
      "room:join",
      { code, name: trimmedName, clientId: ensuredClientId, icon: selectedIcon },
      (ack: AckResponse) => {
        if (!ack?.ok || !ack.code) { setError(ack?.error || "Raum konnte nicht betreten werden."); return; }
        localStorage.setItem(ROOM_CODE_KEY, ack.code);
      }
    );
  };

  const handleSpectate = () => {
    const trimmedName = requireName();
    if (!trimmedName) return;
    const ensuredClientId = ensureClientId();
    const code = codeInput.trim().toUpperCase();
    if (!code) { setError("Bitte gib einen Raumcode ein."); return; }
    socket.emit(
      "room:spectate",
      { code, name: trimmedName, clientId: ensuredClientId, icon: selectedIcon },
      (ack: AckResponse) => {
        if (!ack?.ok || !ack.code) { setError(ack?.error || "Zuschauen nicht möglich."); return; }
        localStorage.setItem(ROOM_CODE_KEY, ack.code);
        setIsSpectator(true);
      }
    );
  };

  const handleRename = (newName: string) => {
    if (!room) return;
    const trimmed = newName.trim().slice(0, 24);
    if (!trimmed) { setRenamingId(null); return; }
    socket.emit("room:rename", { code: room.code, name: trimmed }, (ack: AckResponse) => {
      if (!ack?.ok) setError(ack?.error || "Namensänderung fehlgeschlagen.");
    });
    setRenamingId(null);
  };

  const handleNudge = () => {
    if (!room || nudgeCooldownRef.current) return;
    nudgeCooldownRef.current = true;
    playNudge();
    socket.emit("game:nudge", { code: room.code });
    setTimeout(() => { nudgeCooldownRef.current = false; }, 2000);
  };

  const handleLeaveRoom = () => {
    if (!room) { clearRoomState(); return; }
    socket.emit("room:leave", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) { setError(ack?.error || "Raum konnte nicht verlassen werden."); return; }
      clearRoomState();
    });
  };

  const handleStartGame = () => {
    if (!room) return;
    socket.emit("game:start", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) setError(ack?.error || "Spiel konnte nicht gestartet werden.");
    });
  };

  const handleRoll = () => {
    if (!room) return;
    requestNotifPermission();
    socket.emit("game:roll", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) setError(ack?.error || "Wurf fehlgeschlagen.");
    });
  };

  const handleToggleHold = (index: number) => {
    if (!room) return;
    // Optimistic update — instantly toggle hold in local state
    setRoom((prev) => {
      if (!prev) return prev;
      const newHeld = [...prev.turn.held];
      newHeld[index] = !newHeld[index];
      return { ...prev, turn: { ...prev.turn, held: newHeld } };
    });
    socket.emit("game:toggleHold", { code: room.code, index }, (ack: AckResponse) => {
      if (!ack?.ok) {
        // Revert on failure
        setRoom((prev) => {
          if (!prev) return prev;
          const reverted = [...prev.turn.held];
          reverted[index] = !reverted[index];
          return { ...prev, turn: { ...prev.turn, held: reverted } };
        });
        setError(ack?.error || "Würfel konnte nicht gehalten werden.");
      }
    });
  };

  const handleScoreDirect = (category: Category) => {
    if (!room) return;
    const celebKind = detectCelebration(category, room.turn.dice, me);

    if (me) {
    }

    socket.emit("game:score", { code: room.code, category }, (ack: AckResponse) => {
      if (!ack?.ok) { setError(ack?.error || "Punkte konnten nicht eingetragen werden."); return; }
      setFlashedCell({ playerId: clientId, category });
      setTimeout(() => setFlashedCell(null), 1500);
      playScoreEntry();
      vibrate([50, 30, 50]);
      if (celebKind === "kniffel") {
        playKniffelFanfare();
        vibrate(200);
        setCelebration("kniffel");
      } else if (celebKind) {
        playCelebration();
        setCelebration(celebKind);
      }
    });
  };


  const handleRematch = () => {
    if (!room) return;
    socket.emit("game:rematch", { code: room.code }, (ack: AckResponse) => {
      if (!ack?.ok) setError(ack?.error || "Rematch fehlgeschlagen.");
      else {
        setAchievements([]);
          }
    });
  };

  const handleTimerToggle = (enabled: boolean) => {
    if (!room) return;
    socket.emit("room:settings", { code: room.code, timerEnabled: enabled });
  };

  const shareUrl = room ? `${typeof window !== "undefined" ? window.location.origin : "https://kniffel.logge.top"}?room=${room.code}` : "";

  const copyCode = async () => {
    if (!room) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setError("Einladungslink kopiert! 🔗");
    } catch {
      setError("Kopieren nicht verfügbar.");
    }
  };

  const shareRoom = async () => {
    if (!room) return;
    if (navigator.share) {
      try {
        await navigator.share({
          title: "🎲 Kniffel Multiplayer",
          text: `Komm in meine Kniffel-Runde! Code: ${room.code}`,
          url: shareUrl,
        });
      } catch { /* cancelled */ }
    } else {
      copyCode();
    }
  };

  const renderScoreCell = (player: PlayerState, row: ScoreCategoryRow) => {
    const score = player.scores[row.category];
    const isMyCell = player.id === clientId && !isSpectator;
    const previewValue = scorePreview[row.category];
    const allowScore = room?.status === "playing" && isMyTurn && isMyCell && typeof score !== "number" && typeof previewValue === "number";
    const isLowerSection = ["threeOfAKind","fourOfAKind","fullHouse","smallStraight","largeStraight","yahtzee","chance"].includes(row.category);
    const isFlashing = flashedCell?.playerId === player.id && flashedCell?.category === row.category;

    return (
      <td
        key={`${player.id}-${row.category}`}
        className={[
          "relative border border-[#2a4f89]/65 px-3 py-2 text-center",
          room?.currentPlayerId === player.id ? "bg-[#e5efff]" : "bg-[#f7ecd8]",
        ].join(" ")}
      >
        <AnimatePresence>
          {isFlashing && (
            <motion.div
              key="flash"
              initial={{ opacity: 0.8 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 1.3 }}
              className="pointer-events-none absolute inset-0 rounded-sm"
              style={{ backgroundColor: me?.color || "#1f4d90" }}
            />
          )}
        </AnimatePresence>
        {typeof score === "number" && (
          <span className={[
            "relative text-sm",
            score === 0
              ? "font-bold text-[#c0392b] line-through decoration-2"
              : isLowerSection && score >= 25
                ? "font-extrabold text-[#0d6e3f]"
                : isLowerSection && score >= 15
                  ? "font-bold text-[#123f84]"
                  : "font-bold text-[#123f84]",
          ].join(" ")}>
            {score === 50 && row.category === "yahtzee" ? "🎯 50" : score}
          </span>
        )}
        {allowScore && (
          <button
            type="button"
            onClick={() => handleScoreDirect(row.category)}
            className="relative min-h-[36px] min-w-[36px] rounded-lg px-2.5 py-1.5 font-bold shadow-md transition hover:brightness-110 active:scale-95"
            style={{
              backgroundColor: previewValue === 0 ? "transparent" : (me?.color || "#1f4d90"),
              color: previewValue === 0 ? (me?.color || "#1f4d90") : "#fff",
              border: previewValue === 0 ? `2px solid ${me?.color || "#1f4d90"}` : "2px solid transparent",
              opacity: previewValue === 0 ? 0.45 : 1,
              boxShadow: previewValue >= 25 ? `0 0 12px ${me?.color || "#1f4d90"}80` : undefined,
              animation: previewValue >= 25 ? "pulse 1.5s ease-in-out infinite" : undefined,
            }}
          >
            {previewValue}
          </button>
        )}
        {typeof score !== "number" && !allowScore && (
          <span className="text-base font-medium text-[#9ba5b7]">—</span>
        )}
      </td>
    );
  };

  // Mobile score card rendering
  const renderMobileScorecard = () => {
    if (!room) return null;
    const viewPlayer = mobileScorePlayer
      ? room.players.find((p) => p.id === mobileScorePlayer) || room.players[0]
      : me || room.players[0];
    if (!viewPlayer) return null;

    const isViewingMe = viewPlayer.id === clientId && !isSpectator;

    return (
      <div className="md:hidden">
        {/* Player tabs */}
        <div className="mb-3 flex gap-1 overflow-x-auto pb-1">
          {room.players.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setMobileScorePlayer(p.id)}
              className={[
                "flex-shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition",
                (mobileScorePlayer || me?.id || room.players[0]?.id) === p.id
                  ? "border-2 text-white"
                  : "border border-[#2a4f89]/40 bg-[#f4e9d1] text-[#123f84]",
              ].join(" ")}
              style={
                (mobileScorePlayer || me?.id || room.players[0]?.id) === p.id
                  ? { backgroundColor: p.color, borderColor: p.color }
                  : undefined
              }
            >
              {p.icon && <span className="mr-1">{p.icon}</span>}
              {p.name}
              {room.currentPlayerId === p.id && " 🎲"}
              {achievements.filter(a => a.playerId === p.id).map((a, i) => (
                <span key={i} className="ml-0.5" title={a.label}>{a.icon}</span>
              ))}
            </button>
          ))}
        </div>

        {/* Score cards */}
        <div className="space-y-1.5">
          <div className="rounded-lg border border-[#2a4f89]/50 bg-[#e6d8ba] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">
            Oberer Teil
          </div>
          {UPPER_SCORE_ROWS.map((row) => {
            const score = viewPlayer.scores[row.category];
            const previewValue = isViewingMe ? scorePreview[row.category] : undefined;
            const allowScore = room.status === "playing" && isMyTurn && isViewingMe && typeof score !== "number" && typeof previewValue === "number";
        
            return (
              <div
                key={row.category}
                className={[
                  "flex items-center justify-between rounded-lg border px-3 py-2.5",
                  "border-[#2a4f89]/40",
                  room.currentPlayerId === viewPlayer.id ? "bg-[#e5efff]" : "bg-[#f7ecd8]",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  {row.icon && <span className="text-base">{row.icon}</span>}
                  <div>
                    <div className="text-sm font-bold text-[#143f82]">{row.label}</div>
                    <div className="text-[11px] text-[#355d98]">{row.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {typeof score === "number" && (
                    <span className={["text-base", score === 0 ? "font-bold text-[#c0392b] line-through decoration-2" : score >= 25 ? "font-extrabold text-[#0d6e3f]" : "font-bold text-[#123f84]"].join(" ")}>
                      {score === 50 && row.category === "yahtzee" ? "🎯 50" : score}
                    </span>
                  )}
                  {allowScore && (
                    <button
                      type="button"
                      onClick={() => handleScoreDirect(row.category)}
                      className="rounded-lg px-3 py-1.5 font-bold shadow-md active:scale-95"
                      style={{
                        backgroundColor: previewValue === 0 ? "transparent" : (me?.color || "#1f4d90"),
                        color: previewValue === 0 ? (me?.color || "#1f4d90") : "#fff",
                        border: previewValue === 0 ? `2px solid ${me?.color || "#1f4d90"}` : "2px solid transparent",
                        opacity: previewValue === 0 ? 0.45 : 1,
                        boxShadow: previewValue >= 25 ? `0 0 12px ${me?.color || "#1f4d90"}80` : undefined,
                        animation: previewValue >= 25 ? "pulse 1.5s ease-in-out infinite" : undefined,
                      }}
                    >
                      {previewValue}
                    </button>
                  )}
                  {typeof score !== "number" && !allowScore && (
                    <span className="text-base text-[#9ba5b7]">—</span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex justify-between rounded-lg border border-[#2a4f89]/50 bg-[#ece0c5] px-3 py-2">
            <span className="text-sm font-semibold text-[#184587]">Oberer Teil</span>
            <span className="font-bold text-[#123f84]">{viewPlayer.upperTotal}</span>
          </div>
          <div className="flex justify-between rounded-lg border border-[#2a4f89]/50 bg-[#ece0c5] px-3 py-2">
            <span className="text-sm text-[#1f4f93]">Bonus (≥63)</span>
            <span className="font-bold text-[#123f84]">{viewPlayer.bonus}</span>
          </div>

          <div className="rounded-lg border border-[#2a4f89]/50 bg-[#dccba8] px-3 py-1.5 text-xs font-semibold uppercase tracking-wider">
            Unterer Teil
          </div>
          {LOWER_SCORE_ROWS.map((row) => {
            const score = viewPlayer.scores[row.category];
            const previewValue = isViewingMe ? scorePreview[row.category] : undefined;
            const allowScore = room.status === "playing" && isMyTurn && isViewingMe && typeof score !== "number" && typeof previewValue === "number";
        
            return (
              <div
                key={row.category}
                className={[
                  "flex items-center justify-between rounded-lg border px-3 py-2.5",
                  "border-[#2a4f89]/40",
                  room.currentPlayerId === viewPlayer.id ? "bg-[#e5efff]" : "bg-[#f7ecd8]",
                ].join(" ")}
              >
                <div>
                  <div className="text-sm font-bold text-[#143f82]">{row.label}</div>
                  <div className="text-[11px] text-[#355d98]">{row.description}</div>
                </div>
                <div className="flex items-center gap-1.5">
                  {typeof score === "number" && (
                    <span className={["text-base font-bold", score === 0 ? "font-bold text-[#c0392b] line-through decoration-2" : "text-[#123f84]"].join(" ")}>
                      {score}
                    </span>
                  )}
                  {allowScore && (
                    <button
                      type="button"
                      onClick={() => handleScoreDirect(row.category)}
                      className="rounded-lg px-3 py-1.5 font-bold shadow-md active:scale-95"
                      style={{
                        backgroundColor: previewValue === 0 ? "transparent" : (me?.color || "#1f4d90"),
                        color: previewValue === 0 ? (me?.color || "#1f4d90") : "#fff",
                        border: previewValue === 0 ? `2px solid ${me?.color || "#1f4d90"}` : "2px solid transparent",
                        opacity: previewValue === 0 ? 0.45 : 1,
                        boxShadow: previewValue >= 25 ? `0 0 12px ${me?.color || "#1f4d90"}80` : undefined,
                        animation: previewValue >= 25 ? "pulse 1.5s ease-in-out infinite" : undefined,
                      }}
                    >
                      {previewValue}
                    </button>
                  )}
                  {typeof score !== "number" && !allowScore && (
                    <span className="text-base text-[#9ba5b7]">—</span>
                  )}
                </div>
              </div>
            );
          })}

          <div className="flex justify-between rounded-lg border-2 border-[#2a4f89]/70 bg-[#d6c39c] px-3 py-2.5">
            <span className="text-base font-bold text-[#0f366f]">Endsumme</span>
            <span className="text-base font-extrabold text-[#0f366f]">{viewPlayer.total}</span>
          </div>
        </div>
      </div>
    );
  };

  return (
    <main className="relative min-h-screen bg-[#efe4ca] text-[#163f7b]" style={{ backgroundImage: "url('/tulips-bg.jpg')", backgroundSize: "cover", backgroundPosition: "center", backgroundAttachment: "fixed" }}>
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
            <p className="text-sm text-[#335d99]">
              Klassische Gewinnkarte für 1 bis 6 Spieler
              {isSpectator && <span className="ml-2 rounded bg-[#dde7f7] px-2 py-0.5 text-xs">Zuschauer</span>}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {room && room.spectatorCount > 0 && (
              <span className="rounded-full border border-[#2a4f89]/50 bg-[#f3e7cd] px-2.5 py-1 text-xs text-[#315e99]">
                👁 {room.spectatorCount}
              </span>
            )}
            <div className="flex items-center gap-2 rounded-full border border-[#2a4f89]/60 bg-[#f3e7cd] px-3 py-1 text-xs uppercase tracking-[0.12em] text-[#315e99]">
              <span className={["h-2 w-2 rounded-full", connected ? "bg-[#1f5aab] shadow-[0_0_8px_rgba(32,84,165,0.5)]" : "bg-[#b65353]"].join(" ")} />
              {connected ? "Verbunden" : "Getrennt"}
            </div>
          </div>
        </header>

        {error && (
          <div className="rounded-lg border border-[#2a4f89]/50 bg-[#ecddbf] px-4 py-2 text-sm text-[#214c8f]">
            {error}
          </div>
        )}

        {!room && (
          <section className="mx-auto flex w-full max-w-4xl flex-col gap-6">
            {/* Player Setup */}
            <div className="rounded-[28px] border-2 border-[#2a4f89]/70 bg-[#f6ecd6]/90 p-5 shadow-[0_28px_60px_-46px_rgba(15,23,42,0.95)] backdrop-blur sm:p-8">
              <div className="mb-5">
                <label className="mb-2 block text-xs uppercase tracking-[0.18em] text-[#315e99]" htmlFor="name-input">
                  Dein Name
                </label>
                <input
                  id="name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={24}
                  placeholder="z. B. Mia"
                  className="w-full border-0 border-b-2 border-[#2a4f89]/55 bg-transparent px-1 py-2 text-lg text-[#123f84] outline-none transition placeholder:text-[#6481ad] focus:border-[#123f84]"
                />
              </div>
              <IconPicker selected={selectedIcon} onSelect={handleSelectIcon} />
            </div>

            {/* Action Cards */}
            <div className="grid gap-5 sm:grid-cols-2">
              {/* Create Room */}
              <div className="rounded-[24px] border-2 border-[#2a4f89]/70 bg-[#f6ecd6]/90 p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.85)] backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e6d8ba] text-xl">🎲</span>
                  <div>
                    <h3 className="text-lg font-semibold text-[#123f84]">Neues Spiel</h3>
                    <p className="text-xs text-[#5a7aad]">Erstelle einen Raum und lade Freunde ein</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleCreateRoom}
                  className="w-full rounded-xl border-2 border-[#2a4f89]/60 bg-[#123f84] px-4 py-3.5 font-semibold uppercase tracking-[0.08em] text-white shadow-md transition hover:bg-[#1a4f9a] active:scale-[0.98]"
                >
                  Raum erstellen
                </button>
              </div>

              {/* Join Room */}
              <div className="rounded-[24px] border-2 border-[#2a4f89]/70 bg-[#f6ecd6]/90 p-6 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.85)] backdrop-blur">
                <div className="mb-4 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#dde7f7] text-xl">🤝</span>
                  <div>
                    <h3 className="text-lg font-semibold text-[#123f84]">Beitreten</h3>
                    <p className="text-xs text-[#5a7aad]">Mit Raumcode einem Spiel beitreten</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    value={codeInput}
                    onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                    maxLength={6}
                    placeholder="CODE"
                    className="flex-1 rounded-xl border-2 border-[#2a4f89]/40 bg-[#f8eed8] px-4 py-3 text-center text-lg font-mono uppercase tracking-[0.25em] text-[#123f84] outline-none transition placeholder:text-[#6481ad]/50 focus:border-[#123f84]"
                  />
                  <button
                    type="button"
                    onClick={handleJoinRoom}
                    className="rounded-xl border-2 border-[#2a4f89]/60 bg-[#dde7f7] px-5 py-3 font-semibold uppercase tracking-[0.08em] text-[#123f84] transition hover:bg-[#cfddf4] active:scale-[0.98]"
                  >
                    Join
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleSpectate}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-[#2a4f89]/30 bg-transparent px-4 py-2 text-sm text-[#5a7aad] transition hover:bg-[#ece0c5]"
                >
                  <span>👁</span> Als Zuschauer beitreten
                </button>
              </div>
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
                  <button type="button" onClick={copyCode} className="rounded-md border border-[#2a4f89]/55 bg-[#f0e4c8] px-3 py-1 text-sm text-[#214c8f] transition hover:bg-[#e4d5b6]">
                    🔗 Link kopieren
                  </button>
                  <button type="button" onClick={shareRoom} className="rounded-md border border-[#2a4f89]/55 bg-[#dde7f7] px-3 py-1 text-sm text-[#214c8f] transition hover:bg-[#cfddf4]">
                    📤 Teilen
                  </button>
                </div>
              </div>
              <button type="button" onClick={handleLeaveRoom} className="rounded-md border border-[#2a4f89]/65 bg-[#e8d8b7] px-3 py-2 text-sm text-[#123f84] transition hover:bg-[#ddcba8]">
                Raum verlassen
              </button>
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
                      <li key={player.id} className="flex items-center justify-between rounded-md border border-[#2a4f89]/45 bg-[#efe1c2] px-3 py-2">
                        <div className="flex items-center gap-2">
                          {player.icon && <span className="text-lg">{player.icon}</span>}
                          {renamingId === player.id ? (
                            <input
                              autoFocus
                              className="rounded border border-[#2a4f89]/50 bg-white px-2 py-0.5 text-sm text-[#123f84] outline-none"
                              value={renameValue}
                              onChange={(e) => setRenameValue(e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") handleRename(renameValue); if (e.key === "Escape") setRenamingId(null); }}
                              onBlur={() => handleRename(renameValue)}
                              maxLength={24}
                            />
                          ) : (
                            <span
                              className="flex items-center gap-2 font-medium text-[#123f84]"
                              onDoubleClick={() => { if (player.id === clientId) { setRenamingId(player.id); setRenameValue(player.name); } }}
                              title={player.id === clientId ? "Doppelklick zum Umbenennen" : undefined}
                            >
                              <span className="inline-block h-3 w-3 rounded-full" style={{ backgroundColor: player.color || "#999" }} />
                              {player.name}
                            </span>
                          )}
                          {player.id === room.hostId && (
                            <span className="rounded-full border border-[#2a4f89]/45 bg-[#d7e5fb] px-2 py-0.5 text-xs text-[#123f84]">Host</span>
                          )}
                          {player.id === clientId && renamingId !== player.id && (
                            <span className="rounded-full border border-[#2a4f89]/45 bg-[#e7dbc0] px-2 py-0.5 text-xs text-[#123f84]">Du</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={["text-xs", player.connected ? "text-[#1f5aab]" : "text-[#6f86ad]"].join(" ")}>
                            {player.connected ? "online" : "offline"}
                          </span>
                          {isHost && player.id !== clientId && (
                            <button
                              type="button"
                              onClick={() => {
                                socket.emit("room:kick", { code: room.code, playerId: player.id }, (ack: AckResponse) => {
                                  if (!ack?.ok) setError(ack?.error || "Spieler konnte nicht entfernt werden.");
                                });
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-full bg-[#e74c3c]/15 text-xs font-bold text-[#e74c3c] transition hover:bg-[#e74c3c]/30 active:scale-90"
                              title="Spieler entfernen"
                            >
                              ✕
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>

                  {/* Timer toggle for host */}
                  {isHost && (
                    <div className="mt-4 flex items-center gap-3 rounded-md border border-[#2a4f89]/35 bg-[#f0e4c8] px-3 py-2">
                      <label className="flex cursor-pointer items-center gap-2 text-sm text-[#123f84]">
                        <input
                          type="checkbox"
                          checked={room.timerEnabled}
                          onChange={(e) => handleTimerToggle(e.target.checked)}
                          className="h-4 w-4 cursor-pointer"
                          style={{ accentColor: "#1f4d90" }}
                        />
                        Zeitlimit pro Zug ({room.timerSeconds}s)
                      </label>
                    </div>
                  )}
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
                {room.status === "playing" && currentPlayer && (
                  <motion.div
                    key={currentPlayer.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35 }}
                    className="flex items-center gap-3 rounded-xl border-l-4 px-4 py-3"
                    style={{ borderLeftColor: currentPlayer.color, backgroundColor: `${currentPlayer.color}18` }}
                  >
                    <div className="h-4 w-4 flex-shrink-0 rounded-full" style={{ backgroundColor: currentPlayer.color }} />
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="font-semibold text-[#123f84]">
                        {isMyTurn ? "Du bist dran" : `${currentPlayer.name} ist am Zug`}
                      </span>
                      {isMyTurn && (
                        <span className="rounded-full px-2 py-0.5 text-xs font-bold text-white" style={{ backgroundColor: currentPlayer.color }}>
                          Dein Zug!
                        </span>
                      )}
                      {!currentPlayer.connected && (
                        <span className="rounded-full bg-[#e74c3c]/20 px-2 py-0.5 text-xs text-[#e74c3c]">
                          Getrennt — warte auf Rückkehr...
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}

                {!isMyTurn && (
                  <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
                    <div
                      className="rounded-[20px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 p-4"
                      style={currentPlayer && room.status === "playing" ? { borderColor: `${currentPlayer.color}70` } : undefined}
                    >
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
                    </div>
                    <div className="rounded-[20px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 px-4 py-3">
                      <p className="text-xs uppercase tracking-[0.14em] text-[#315e99]">Spieler · Runde {Math.max(room.currentRound, 1)}/{room.maxRounds}</p>
                      <p className="mt-1 text-sm text-[#214c8f]">
                        {room.players.length} Teilnehmer · {room.maxRounds} Runden
                        {room.timerEnabled && ` · ${room.timerSeconds}s Timer`}
                      </p>
                    </div>
                  </div>
                )}

                <div className="rounded-[22px] border-2 border-[#2a4f89]/65 bg-[#f4e8cf]/90 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-sm uppercase tracking-[0.16em] text-[#315e99]">Würfel</h3>
                    <div className="text-sm text-[#214c8f]">
                      Würfe: {room.turn.rollsUsed} / 3 · Verbleibend: {room.turn.rollsLeft}
                    </div>
                  </div>

                  {/* Timer bar */}
                  {room.timerEnabled && room.turnStartedAt && room.status === "playing" && (
                    <TimerBar turnStartedAt={room.turnStartedAt} timerSeconds={room.timerSeconds} />
                  )}

                  <DiceBox3D
                    dice={room.turn.dice}
                    held={room.turn.held}
                    disabled={!isMyTurn || room.turn.rollsUsed === 0 || room.status !== "playing"}
                    rollSequence={displayRollSeq}
                    onToggleHold={handleToggleHold}
                    activeColor={activeColor}
                    playerIcon={currentPlayer?.icon}
                  />

                  {!isSpectator && (
                    <div className="mt-4 flex gap-2">
                      <button
                        type="button"
                        onClick={handleRoll}
                        disabled={!canRoll || room.status !== "playing"}
                        className={[
                          "flex-1 rounded-md border px-4 py-3 font-bold uppercase tracking-[0.08em] transition",
                          canRoll && room.status === "playing"
                            ? "cursor-pointer hover:brightness-95 active:scale-[0.98]"
                            : "cursor-not-allowed border-[#7f92b3]/45 bg-[#e6dcc5]/70 text-[#7f92b3]",
                        ].join(" ")}
                        style={
                          canRoll && room.status === "playing"
                            ? { borderColor: activeColor || "#1f4d90", backgroundColor: activeColor || "#1f4d90", color: "#ffffff" }
                            : undefined
                        }
                      >
                        Würfeln
                      </button>
                      {nudgeVisible && !isMyTurn && (
                        <button
                          type="button"
                          onClick={handleNudge}
                          className="rounded-md border border-[#e67e22]/60 bg-[#fef3e2] px-3 py-3 text-lg transition hover:bg-[#fde8c0] active:scale-95"
                          title={`${currentPlayer?.name} antupfen`}
                        >
                          👋
                        </button>
                      )}
                    </div>
                  )}
                </div>

                {/* Score confirmation bar */}

                {/* Mobile scorecard */}
                {renderMobileScorecard()}

                {/* Desktop scorecard */}
                <div
                  className="hidden rounded-[30px] border border-[#204b88]/70 bg-[#efe2c5] p-3 shadow-[0_26px_60px_-45px_rgba(15,23,42,0.95)] sm:p-4 md:block"
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

                    <div className="overflow-x-auto" style={{ overscrollBehaviorX: "contain" }}>
                      <table className="min-w-[820px] w-full border-collapse text-sm text-[#1d4a89]">
                        <thead>
                          <tr>
                            <th className="sticky left-0 z-30 border border-[#2a4f89]/70 bg-[#e6d8ba] px-3 py-2 text-left text-xs font-semibold uppercase tracking-[0.09em]">
                              Kombination
                            </th>
                            {room.players.map((player) => (
                              <th
                                key={player.id}
                                className="border border-[#2a4f89]/70 px-3 py-2 text-center text-xs font-semibold uppercase tracking-[0.09em] text-[#113a78]"
                                style={
                                  room.currentPlayerId === player.id
                                    ? { backgroundColor: `${player.color}35`, borderBottom: `3px solid ${player.color}` }
                                    : { backgroundColor: "#e6d8ba" }
                                }
                              >
                                <span className="flex items-center justify-center gap-1">
                                  {room.currentPlayerId === player.id && (
                                    <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: player.color }} />
                                  )}
                                  {player.icon && <span className="text-sm">{player.icon}</span>}
                                  {player.name}
                                  {!player.connected && <span className="text-[10px] text-[#e74c3c]">⚡</span>}
                                  {isHost && player.id !== clientId && room.status === "playing" && (
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); socket.emit("room:kick", { code: room.code, playerId: player.id }); }}
                                      className="text-[10px] text-[#e74c3c] hover:text-[#c0392b] ml-0.5"
                                      title="Kicken"
                                    >✕</button>
                                  )}
                                </span>
                                {achievements.filter(a => a.playerId === player.id).length > 0 && (
                                  <span className="flex items-center justify-center gap-0.5 mt-0.5 text-xs">
                                    {achievements.filter(a => a.playerId === player.id).map((a, i) => (
                                      <span key={i} title={a.label}>{a.icon}</span>
                                    ))}
                                  </span>
                                )}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          <tr>
                            <td colSpan={room.players.length + 1} className="border border-[#2a4f89]/70 bg-[#e0d0af] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em]">
                              Oberer Teil
                            </td>
                          </tr>

                          {UPPER_SCORE_ROWS.map((row) => (
                            <tr key={row.category}>
                              <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#f4e9d1] px-3 py-2 align-top">
                                <div className="flex items-start gap-2">
                                  <span className="mt-0.5 text-lg text-[#1f4f93]">{row.icon}</span>
                                  <div>
                                    <div className="text-[15px] font-bold text-[#143f82]">{row.label}</div>
                                    <div className="text-xs text-[#355d98]">{row.description}</div>
                                  </div>
                                </div>
                              </td>
                              {room.players.map((player) => renderScoreCell(player, row))}
                            </tr>
                          ))}

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#ece0c5] px-3 py-2 font-semibold text-[#184587]">
                              Gesamt oberer Teil &rarr;
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-upper-total`} className={["border border-[#2a4f89]/65 px-3 py-2 text-center font-semibold text-[#123f84]", room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#f3e6ce]"].join(" ")}>
                                {player.upperTotal}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#ece0c5] px-3 py-2 text-sm text-[#1f4f93]">
                              Bonus bei 63 oder mehr = 35 &rarr;
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-bonus`} className={["border border-[#2a4f89]/65 px-3 py-2 text-center font-semibold text-[#123f84]", room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#f3e6ce]"].join(" ")}>
                                {player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt oberer Teil
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-upper-with-bonus`} className={["border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]", room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]"].join(" ")}>
                                {player.upperTotal + player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td colSpan={room.players.length + 1} className="border border-[#2a4f89]/70 bg-[#dccba8] px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.1em]">
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
                              {room.players.map((player) => renderScoreCell(player, row))}
                            </tr>
                          ))}

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt unterer Teil
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-lower-total`} className={["border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]", room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]"].join(" ")}>
                                {player.lowerTotal}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border border-[#2a4f89]/65 bg-[#e3d4b4] px-3 py-2 font-semibold text-[#123f84]">
                              Gesamt oberer Teil (Übertrag)
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-carried-upper`} className={["border border-[#2a4f89]/65 px-3 py-2 text-center font-bold text-[#123f84]", room.currentPlayerId === player.id ? "bg-[#dceafb]" : "bg-[#efdfc2]"].join(" ")}>
                                {player.upperTotal + player.bonus}
                              </td>
                            ))}
                          </tr>

                          <tr>
                            <td className="sticky left-0 z-20 border-2 border-[#2a4f89]/80 bg-[#d6c39c] px-3 py-2 text-base font-bold text-[#0f366f]">
                              Endsumme
                            </td>
                            {room.players.map((player) => (
                              <td key={`${player.id}-total`} className={["border-2 border-[#2a4f89]/80 px-3 py-2 text-center text-base font-extrabold text-[#0f366f]", room.currentPlayerId === player.id ? "bg-[#cdddf4]" : "bg-[#e7d5b2]"].join(" ")}>
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

      {/* Emoji Reactions */}
      {room && (
        <ReactionBar
          onReact={(emoji) => { if (room) socket.emit("chat:send", { code: room.code, text: emoji, isReaction: true }); }}
          reactions={floatingReactions}
        />
      )}

      {/* Achievement toasts */}
      <div className="fixed right-4 top-4 z-[70] flex flex-col gap-2">
        <AnimatePresence>
          {achievementToasts.map((a, i) => (
            <AchievementToast
              key={`${a.type}-${a.playerId}-${i}`}
              achievement={a}
              onDone={() => setAchievementToasts((prev) => prev.filter((_, j) => j !== i))}
            />
          ))}
        </AnimatePresence>
      </div>

      {/* Score activity toasts */}
      <div className="fixed bottom-20 left-1/2 z-[65] flex -translate-x-1/2 flex-col gap-2">
        <AnimatePresence>
          {scoreActivities.map((a) => (
            <ScoreActivityToast
              key={a.id}
              activity={a}
              onDone={() => setScoreActivities((prev) => prev.filter((x) => x.id !== a.id))}
            />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {celebration && (
          <CelebrationOverlay kind={celebration} onDone={() => setCelebration(null)} />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {room?.status === "finished" && (
          <AnimatedScoreboard
            room={room}
            achievements={achievements}
            onLeave={handleLeaveRoom}
            onRematch={handleRematch}
            isHost={isHost}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

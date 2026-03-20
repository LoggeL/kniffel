import type { Category } from "@/lib/kniffel";

export type ScoreMap = Record<Category, number | null>;

export interface PlayerState {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  connected: boolean;
  disconnectedAt: number | null;
  scores: ScoreMap;
  upperTotal: number;
  lowerTotal: number;
  bonus: number;
  total: number;
  filledCategories: number;
}

export interface TurnState {
  dice: number[];
  held: boolean[];
  rollsUsed: number;
  rollsLeft: number;
  rollSequence: number;
}

export interface SpectatorState {
  id: string;
  name: string;
  icon: string | null;
}

export interface ChatMessage {
  id: string;
  playerId: string;
  playerName: string;
  playerIcon: string | null;
  playerColor: string;
  text: string;
  isReaction: boolean;
  timestamp: number;
}

export interface RoomState {
  code: string;
  status: "lobby" | "playing" | "finished";
  hostId: string;
  currentPlayerId: string | null;
  currentRound: number;
  maxRounds: number;
  minPlayers: number;
  maxPlayers: number;
  winnerIds: string[];
  turn: TurnState;
  players: PlayerState[];
  spectators: SpectatorState[];
  spectatorCount: number;
  timerEnabled: boolean;
  timerSeconds: number;
  turnStartedAt: number | null;
  chatMessages: ChatMessage[];
}

export interface AckResponse {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
}

export type AchievementType =
  | "kniffel"
  | "strassenfeger"
  | "bonus"
  | "nullPunkte"
  | "perfekterWurf"
  | "fullHouseParty";

export interface Achievement {
  type: AchievementType;
  label: string;
  description: string;
  icon: string;
  playerId: string;
}

export const ACHIEVEMENT_DEFS: Record<AchievementType, { label: string; description: string; icon: string }> = {
  kniffel: { label: "Kniffel!", description: "50 Punkte mit 5 gleichen", icon: "🎯" },
  strassenfeger: { label: "Straßenfeger", description: "Kleine + Große Straße", icon: "🧹" },
  bonus: { label: "Bonus!", description: "63+ im oberen Teil", icon: "⭐" },
  nullPunkte: { label: "Null Punkte", description: "0 in einer Kategorie", icon: "💀" },
  perfekterWurf: { label: "Perfekter Wurf", description: "Beim ersten Wurf eingetragen", icon: "✨" },
  fullHouseParty: { label: "Full House Party", description: "Full House erzielt", icon: "🏠" },
};

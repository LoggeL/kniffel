import type { Category } from "@/lib/kniffel";

export type ScoreMap = Record<Category, number | null>;

export interface PlayerState {
  id: string;
  name: string;
  connected: boolean;
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
}

export interface AckResponse {
  ok: boolean;
  error?: string;
  code?: string;
  playerId?: string;
}

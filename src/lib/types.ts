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

export interface ScoreActivity {
  playerName: string;
  playerColor: string;
  playerIcon: string | null;
  category: string;
  categoryLabel: string;
  score: number;
  playerId: string;
  id: string;
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
  achievements: Achievement[];
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
  | "fullHouseParty"
  | "wuerfelkoenig"
  | "schnecke"
  | "nullUndNichtig"
  | "untereLiga"
  | "perfektionist"
  | "glueckspilz"
  | "pechvogel"
  | "maximalist"
  | "minimalist"
  | "dominator"
  | "comebackKid"
  | "speedRunner"
  | "paschParty"
  | "chanceMeister"
  | "luckySeven"
  | "yahtzeeJr"
  | "sammler"
  | "wiederholungstaeter"
  | "letzterDruecker"
  | "highRoller"
  | "lowRoller"
  | "balanced";

export interface Achievement {
  type: AchievementType;
  label: string;
  description: string;
  icon: string;
  playerId: string;
}

export const ACHIEVEMENT_DEFS: Record<AchievementType, { label: string; description: string; icon: string }> = {
  kniffel: { label: "Kniffel!", description: "50 Punkte mit 5 gleichen", icon: "\ud83c\udfaf" },
  strassenfeger: { label: "Stra\u00dfenfeger", description: "Kleine + Gro\u00dfe Stra\u00dfe", icon: "\ud83e\uddf9" },
  bonus: { label: "Bonus!", description: "63+ im oberen Teil", icon: "\u2b50" },
  nullPunkte: { label: "Null Punkte", description: "0 in einer Kategorie", icon: "\ud83d\udc80" },
  perfekterWurf: { label: "Perfekter Wurf", description: "Beim ersten Wurf eingetragen", icon: "\u2728" },
  fullHouseParty: { label: "Full House Party", description: "Full House erzielt", icon: "\ud83c\udfe0" },
  wuerfelkoenig: { label: "W\u00fcrfelk\u00f6nig", description: "4+ Mal beim ersten Wurf eingetragen", icon: "\ud83d\udc51" },
  schnecke: { label: "Schnecke", description: "5 Z\u00fcge hintereinander alle 3 W\u00fcrfe gebraucht", icon: "\ud83d\udc0c" },
  nullUndNichtig: { label: "Null und Nichtig", description: "0 in 3+ Kategorien", icon: "\ud83d\udea8" },
  untereLiga: { label: "Untere Liga", description: "Keine 0 im unteren Teil", icon: "\ud83c\udfc6" },
  perfektionist: { label: "Perfektionist", description: "Keine einzige 0 im gesamten Spiel", icon: "\ud83d\udc8e" },
  glueckspilz: { label: "Gl\u00fcckspilz", description: "Kniffel beim ersten Wurf", icon: "\ud83c\udf40" },
  pechvogel: { label: "Pechvogel", description: "0 Punkte bei Kniffel", icon: "\ud83e\udea6" },
  maximalist: { label: "Maximalist", description: "30 Punkte in einer oberen Kategorie", icon: "\ud83d\udcc8" },
  minimalist: { label: "Minimalist", description: "Gewonnen mit weniger als 150 Punkten", icon: "\ud83c\udf31" },
  dominator: { label: "Dominator", description: "Mit 100+ Punkten Vorsprung gewonnen", icon: "\ud83d\udca5" },
  comebackKid: { label: "Comeback Kid", description: "50+ Punkte R\u00fcckstand aufgeholt und gewonnen", icon: "\ud83d\ude80" },
  speedRunner: { label: "Speed Runner", description: "Spiel in unter 5 Minuten beendet", icon: "\u23f1\ufe0f" },
  paschParty: { label: "Pasch Party", description: "Dreier- & Viererpasch mit je 20+", icon: "\ud83c\udf89" },
  chanceMeister: { label: "Chance-Meister", description: "30+ Punkte bei Chance", icon: "\ud83c\udfb0" },
  luckySeven: { label: "Lucky Seven", description: "Augensumme genau 7", icon: "\ud83c\udd97" },
  yahtzeeJr: { label: "Yahtzee Jr", description: "4 gleiche beim ersten Wurf", icon: "\ud83d\udc76" },
  sammler: { label: "Sammler", description: "5 verschiedene Augenzahlen in einem Wurf", icon: "\ud83e\udde9" },
  wiederholungstaeter: { label: "Wiederholungst\u00e4ter", description: "Gleiche Punktzahl in 3+ oberen Kategorien", icon: "\ud83d\udd01" },
  letzterDruecker: { label: "Letzter Dr\u00fccker", description: "Punkte in der allerletzten Kategorie erzielt", icon: "\u23f0" },
  highRoller: { label: "High Roller", description: "Gesamtpunktzahl 300+", icon: "\ud83d\udcb0" },
  lowRoller: { label: "Low Roller", description: "Gesamtpunktzahl unter 100", icon: "\ud83e\udee3" },
  balanced: { label: "Balanced", description: "Oberer = Unterer Teil (\u00b15 Punkte)", icon: "\u2696\ufe0f" },
};

export const UPPER_CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
] as const;

export const LOWER_CATEGORIES = [
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
] as const;

export const CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES] as const;

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  ones: "Einser",
  twos: "Zweier",
  threes: "Dreier",
  fours: "Vierer",
  fives: "Fünfer",
  sixes: "Sechser",
  threeOfAKind: "Dreierpasch",
  fourOfAKind: "Viererpasch",
  fullHouse: "Full House",
  smallStraight: "Kleine Straße",
  largeStraight: "Große Straße",
  yahtzee: "Kniffel",
  chance: "Chance",
};

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function hasCount(dice: number[], target: number): boolean {
  const counts = new Map<number, number>();
  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }
  return [...counts.values()].some((count) => count >= target);
}

function isFullHouse(dice: number[]): boolean {
  const counts = new Map<number, number>();
  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }
  const values = [...counts.values()].sort((a, b) => a - b);
  return values.length === 2 && values[0] === 2 && values[1] === 3;
}

function isSmallStraight(dice: number[]): boolean {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const sequences = [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
    [3, 4, 5, 6],
  ];

  return sequences.some((sequence) => sequence.every((value) => unique.includes(value)));
}

function isLargeStraight(dice: number[]): boolean {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  if (unique.length !== 5) {
    return false;
  }
  const joined = unique.join(",");
  return joined === "1,2,3,4,5" || joined === "2,3,4,5,6";
}

export function calculateCategoryScore(category: Category, dice: number[]): number {
  const total = sum(dice);

  switch (category) {
    case "ones":
      return dice.filter((die) => die === 1).length;
    case "twos":
      return dice.filter((die) => die === 2).length * 2;
    case "threes":
      return dice.filter((die) => die === 3).length * 3;
    case "fours":
      return dice.filter((die) => die === 4).length * 4;
    case "fives":
      return dice.filter((die) => die === 5).length * 5;
    case "sixes":
      return dice.filter((die) => die === 6).length * 6;
    case "threeOfAKind":
      return hasCount(dice, 3) ? total : 0;
    case "fourOfAKind":
      return hasCount(dice, 4) ? total : 0;
    case "fullHouse":
      return isFullHouse(dice) ? 25 : 0;
    case "smallStraight":
      return isSmallStraight(dice) ? 30 : 0;
    case "largeStraight":
      return isLargeStraight(dice) ? 40 : 0;
    case "yahtzee":
      return hasCount(dice, 5) ? 50 : 0;
    case "chance":
      return total;
    default:
      return 0;
  }
}

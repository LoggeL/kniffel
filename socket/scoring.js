const { UPPER_CATEGORIES, LOWER_CATEGORIES, CATEGORIES } = require("./constants");

function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}

function getCounts(dice) {
  const counts = new Map();
  for (const die of dice) {
    counts.set(die, (counts.get(die) || 0) + 1);
  }
  return counts;
}

function hasCount(dice, target) {
  for (const count of getCounts(dice).values()) {
    if (count >= target) {
      return true;
    }
  }
  return false;
}

function isFullHouse(dice) {
  const values = [...getCounts(dice).values()].sort((a, b) => a - b);
  return values.length === 2 && values[0] === 2 && values[1] === 3;
}

function isSmallStraight(dice) {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  const sequences = [
    [1, 2, 3, 4],
    [2, 3, 4, 5],
    [3, 4, 5, 6],
  ];

  return sequences.some((sequence) => sequence.every((value) => unique.includes(value)));
}

function isLargeStraight(dice) {
  const unique = [...new Set(dice)].sort((a, b) => a - b);
  if (unique.length !== 5) {
    return false;
  }

  const joined = unique.join(",");
  return joined === "1,2,3,4,5" || joined === "2,3,4,5,6";
}

function calculateCategoryScore(category, dice) {
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

function getScoreSummary(scores) {
  const upperTotal = UPPER_CATEGORIES.reduce((total, category) => total + (scores[category] || 0), 0);
  const lowerTotal = LOWER_CATEGORIES.reduce((total, category) => total + (scores[category] || 0), 0);
  const bonus = upperTotal >= 63 ? 35 : 0;
  const total = upperTotal + lowerTotal + bonus;
  const filledCategories = CATEGORIES.reduce(
    (count, category) => count + (typeof scores[category] === "number" ? 1 : 0),
    0
  );

  return {
    upperTotal,
    lowerTotal,
    bonus,
    total,
    filledCategories,
  };
}

module.exports = {
  calculateCategoryScore,
  getScoreSummary,
};

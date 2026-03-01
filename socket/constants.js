const UPPER_CATEGORIES = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
];

const LOWER_CATEGORIES = [
  "threeOfAKind",
  "fourOfAKind",
  "fullHouse",
  "smallStraight",
  "largeStraight",
  "yahtzee",
  "chance",
];

const CATEGORIES = [...UPPER_CATEGORIES, ...LOWER_CATEGORIES];

function createEmptyScores() {
  return CATEGORIES.reduce((acc, category) => {
    acc[category] = null;
    return acc;
  }, {});
}

module.exports = {
  UPPER_CATEGORIES,
  LOWER_CATEGORIES,
  CATEGORIES,
  createEmptyScores,
};

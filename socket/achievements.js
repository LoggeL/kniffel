const { UPPER_CATEGORIES } = require("./constants");
const { calculateCategoryScore, getScoreSummary } = require("./scoring");

const ACHIEVEMENT_DEFS = {
  kniffel: { label: "Kniffel!", description: "50 Punkte mit 5 gleichen", icon: "🎯" },
  strassenfeger: { label: "Straßenfeger", description: "Kleine + Große Straße", icon: "🧹" },
  bonus: { label: "Bonus!", description: "63+ im oberen Teil", icon: "⭐" },
  nullPunkte: { label: "Null Punkte", description: "0 in einer Kategorie", icon: "💀" },
  perfekterWurf: { label: "Perfekter Wurf", description: "Beim ersten Wurf eingetragen", icon: "✨" },
  fullHouseParty: { label: "Full House Party", description: "Full House erzielt", icon: "🏠" },
};

function detectNewAchievements(player, category, dice, rollsUsed, existingAchievements) {
  const earned = new Set(existingAchievements.filter(a => a.playerId === player.id).map(a => a.type));
  const newOnes = [];
  const score = calculateCategoryScore(category, dice);

  // Kniffel
  if (category === "yahtzee" && score === 50 && !earned.has("kniffel")) {
    newOnes.push({ ...ACHIEVEMENT_DEFS.kniffel, type: "kniffel", playerId: player.id });
  }

  // Full House
  if (category === "fullHouse" && score === 25 && !earned.has("fullHouseParty")) {
    newOnes.push({ ...ACHIEVEMENT_DEFS.fullHouseParty, type: "fullHouseParty", playerId: player.id });
  }

  // Null Punkte
  if (score === 0 && !earned.has("nullPunkte")) {
    newOnes.push({ ...ACHIEVEMENT_DEFS.nullPunkte, type: "nullPunkte", playerId: player.id });
  }

  // Perfekter Wurf (scored on first roll)
  if (rollsUsed === 1 && score > 0 && !earned.has("perfekterWurf")) {
    newOnes.push({ ...ACHIEVEMENT_DEFS.perfekterWurf, type: "perfekterWurf", playerId: player.id });
  }

  // Bonus (upper section >= 63)
  if (UPPER_CATEGORIES.includes(category) && !earned.has("bonus")) {
    const summary = getScoreSummary(player.scores);
    if (summary.upperTotal >= 63) {
      newOnes.push({ ...ACHIEVEMENT_DEFS.bonus, type: "bonus", playerId: player.id });
    }
  }

  // Straßenfeger (both straights scored)
  if ((category === "smallStraight" || category === "largeStraight") && !earned.has("strassenfeger")) {
    const small = typeof player.scores.smallStraight === "number" && player.scores.smallStraight > 0;
    const large = typeof player.scores.largeStraight === "number" && player.scores.largeStraight > 0;
    if (small && large) {
      newOnes.push({ ...ACHIEVEMENT_DEFS.strassenfeger, type: "strassenfeger", playerId: player.id });
    }
  }

  return newOnes;
}

module.exports = { detectNewAchievements, ACHIEVEMENT_DEFS };

const { UPPER_CATEGORIES, LOWER_CATEGORIES, CATEGORIES } = require("./constants");
const { calculateCategoryScore, getScoreSummary } = require("./scoring");

const ACHIEVEMENT_DEFS = {
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

function initPlayerStats() {
  return {
    firstRollScores: 0,
    consecutive3Rolls: 0,
    maxConsecutive3Rolls: 0,
    wasLosingBy50: false,
  };
}

function ensurePlayerStats(room, playerId) {
  if (!room.playerStats) room.playerStats = {};
  if (!room.playerStats[playerId]) room.playerStats[playerId] = initPlayerStats();
  return room.playerStats[playerId];
}

function updatePlayerStats(room, player, rollsUsed) {
  const stats = ensurePlayerStats(room, player.id);

  // Track first roll scores
  if (rollsUsed === 1) {
    stats.firstRollScores += 1;
  }

  // Track consecutive 3-roll turns
  if (rollsUsed === 3) {
    stats.consecutive3Rolls += 1;
    if (stats.consecutive3Rolls > stats.maxConsecutive3Rolls) {
      stats.maxConsecutive3Rolls = stats.consecutive3Rolls;
    }
  } else {
    stats.consecutive3Rolls = 0;
  }

  // Track comebackKid: check if this player is currently losing by 50+
  if (room.players.length > 1) {
    const myTotal = getScoreSummary(player.scores).total;
    const maxOther = Math.max(
      ...room.players.filter((p) => p.id !== player.id).map((p) => getScoreSummary(p.scores).total)
    );
    if (maxOther - myTotal >= 50) {
      stats.wasLosingBy50 = true;
    }
  }
}

function detectNewAchievements(player, category, dice, rollsUsed, existingAchievements, room) {
  const earned = new Set(existingAchievements.filter((a) => a.playerId === player.id).map((a) => a.type));
  const newOnes = [];
  const score = calculateCategoryScore(category, dice);

  function add(type) {
    if (!earned.has(type)) {
      newOnes.push({ ...ACHIEVEMENT_DEFS[type], type, playerId: player.id });
      earned.add(type);
    }
  }

  // Kniffel
  if (category === "yahtzee" && score === 50) add("kniffel");

  // Full House Party
  if (category === "fullHouse" && score === 25) add("fullHouseParty");

  // Null Punkte
  if (score === 0) add("nullPunkte");

  // Perfekter Wurf (scored on first roll with positive score)
  if (rollsUsed === 1 && score > 0) add("perfekterWurf");

  // Bonus (upper section >= 63)
  if (UPPER_CATEGORIES.includes(category)) {
    const summary = getScoreSummary(player.scores);
    if (summary.upperTotal >= 63) add("bonus");
  }

  // Stra\u00dfenfeger (both straights scored > 0)
  if (category === "smallStraight" || category === "largeStraight") {
    const small = typeof player.scores.smallStraight === "number" && player.scores.smallStraight > 0;
    const large = typeof player.scores.largeStraight === "number" && player.scores.largeStraight > 0;
    if (small && large) add("strassenfeger");
  }

  // W\u00fcrfelk\u00f6nig - scored 4+ times on first roll
  if (room && room.playerStats && room.playerStats[player.id]) {
    const stats = room.playerStats[player.id];
    if (stats.firstRollScores >= 4) add("wuerfelkoenig");
  }

  // Schnecke - used all 3 rolls for 5 turns in a row
  if (room && room.playerStats && room.playerStats[player.id]) {
    const stats = room.playerStats[player.id];
    if (stats.maxConsecutive3Rolls >= 5) add("schnecke");
  }

  // Null und Nichtig - scored 0 in 3+ categories
  {
    const zeroCount = CATEGORIES.filter((c) => player.scores[c] === 0).length;
    if (zeroCount >= 3) add("nullUndNichtig");
  }

  // Untere Liga - no zeros in lower section (all scored and > 0)
  {
    const lowerAllScored = LOWER_CATEGORIES.every((c) => typeof player.scores[c] === "number");
    const lowerNoZeros = LOWER_CATEGORIES.every((c) => player.scores[c] > 0);
    if (lowerAllScored && lowerNoZeros) add("untereLiga");
  }

  // Gl\u00fcckspilz - got Kniffel on first roll
  if (category === "yahtzee" && score === 50 && rollsUsed === 1) add("glueckspilz");

  // Pechvogel - scored 0 in Kniffel category
  if (category === "yahtzee" && score === 0) add("pechvogel");

  // Maximalist - scored 30 in any single upper category
  if (UPPER_CATEGORIES.includes(category) && score >= 30) add("maximalist");

  // Pasch Party - both Dreierpasch and Viererpasch with 20+ each
  if (category === "threeOfAKind" || category === "fourOfAKind") {
    const three = player.scores.threeOfAKind;
    const four = player.scores.fourOfAKind;
    if (typeof three === "number" && three >= 20 && typeof four === "number" && four >= 20) add("paschParty");
  }

  // Chance-Meister - scored 30+ in Chance
  if (category === "chance" && score >= 30) add("chanceMeister");

  // Lucky Seven - dice sum = 7
  {
    const diceSum = dice.reduce((a, b) => a + b, 0);
    if (diceSum === 7) add("luckySeven");
  }

  // Yahtzee Jr - 4 of a kind on first roll
  if (rollsUsed === 1) {
    const counts = {};
    for (const d of dice) counts[d] = (counts[d] || 0) + 1;
    if (Object.values(counts).some((c) => c >= 4)) add("yahtzeeJr");
  }

  // Sammler - 5 different values in one roll
  {
    const unique = new Set(dice);
    if (unique.size === 5) add("sammler");
  }

  // Wiederholungst\u00e4ter - same score in 3+ upper categories
  {
    const upperScores = UPPER_CATEGORIES.map((c) => player.scores[c]).filter((s) => typeof s === "number" && s > 0);
    const scoreCounts = {};
    for (const s of upperScores) scoreCounts[s] = (scoreCounts[s] || 0) + 1;
    if (Object.values(scoreCounts).some((c) => c >= 3)) add("wiederholungstaeter");
  }

  // Letzter Dr\u00fccker - scored non-zero on very last category
  {
    const filled = CATEGORIES.filter((c) => typeof player.scores[c] === "number").length;
    if (filled === 13 && score > 0) add("letzterDruecker");
  }

  return newOnes;
}

function detectGameEndAchievements(room) {
  const newOnes = [];
  const earned = new Set(room.achievements.map((a) => `${a.playerId}:${a.type}`));

  function add(playerId, type) {
    const key = `${playerId}:${type}`;
    if (!earned.has(key)) {
      newOnes.push({ ...ACHIEVEMENT_DEFS[type], type, playerId });
      earned.add(key);
    }
  }

  const winnerIds = room.winnerIds || [];

  for (const p of room.players) {
    const summary = getScoreSummary(p.scores);
    const isWinner = winnerIds.includes(p.id);

    // Perfektionist - no zeros in any category
    const hasZero = CATEGORIES.some((c) => p.scores[c] === 0);
    if (!hasZero) add(p.id, "perfektionist");

    // High Roller - total 300+
    if (summary.total >= 300) add(p.id, "highRoller");

    // Low Roller - total under 100
    if (summary.total < 100) add(p.id, "lowRoller");

    // Balanced - upper equals lower \u00b15
    if (Math.abs(summary.upperTotal - summary.lowerTotal) <= 5) add(p.id, "balanced");

    // Minimalist - won with less than 150
    if (isWinner && summary.total < 150) add(p.id, "minimalist");

    // Dominator - won with 100+ point lead
    if (isWinner && room.players.length > 1) {
      const others = room.players.filter((o) => o.id !== p.id);
      const secondBest = Math.max(...others.map((o) => getScoreSummary(o.scores).total));
      if (summary.total - secondBest >= 100) add(p.id, "dominator");
    }

    // Comeback Kid - was losing by 50+ but won
    if (isWinner && room.playerStats && room.playerStats[p.id]) {
      if (room.playerStats[p.id].wasLosingBy50) add(p.id, "comebackKid");
    }

    // Speed Runner - game finished in under 5 minutes
    if (room.gameStartedAt && room.finishedAt) {
      const elapsed = room.finishedAt - room.gameStartedAt;
      if (elapsed < 5 * 60 * 1000) add(p.id, "speedRunner");
    }
  }

  return newOnes;
}

module.exports = { detectNewAchievements, detectGameEndAchievements, updatePlayerStats, ensurePlayerStats, ACHIEVEMENT_DEFS };

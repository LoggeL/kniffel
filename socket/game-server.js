const { CATEGORIES, createEmptyScores } = require("./constants");
const { calculateCategoryScore, getScoreSummary } = require("./scoring");
const { saveRoom, loadActiveRooms, cleanupFinished, deleteRoom } = require("./db");

const rooms = new Map();
const turnTimers = new Map();
const disconnectTimers = new Map();

const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIN_PLAYERS = 1;
const MAX_PLAYERS = 6;
const MAX_ROUNDS = 13;
const PLAYER_COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6", "#1abc9c"];
const DISCONNECT_GRACE_MS = 60000;
const MAX_CHAT_MESSAGES = 50;

function randomDieValue() {
  return Math.floor(Math.random() * 6) + 1;
}

function normalizeName(name) {
  return String(name || "").trim().slice(0, 24);
}

function normalizeIcon(icon) {
  const s = String(icon || "").trim();
  if (!s || s.length > 4) return null;
  return s;
}

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase().slice(0, 6);
}

function makeTurnState() {
  return {
    dice: [0, 0, 0, 0, 0],
    held: [false, false, false, false, false],
    rollsUsed: 0,
    rollSequence: 0,
  };
}

function generateRoomCode() {
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i += 1) {
      code += ROOM_CODE_CHARSET[Math.floor(Math.random() * ROOM_CODE_CHARSET.length)];
    }
  } while (rooms.has(code));
  return code;
}

function sendAck(ack, payload) {
  if (typeof ack === "function") ack(payload);
}

function sendError(socket, ack, message) {
  sendAck(ack, { ok: false, error: message });
  socket.emit("action:error", message);
}

function getRoom(code) {
  return rooms.get(normalizeCode(code));
}

function getPlayerById(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function getCurrentPlayer(room) {
  if (room.status !== "playing") return null;
  return room.players[room.turnIndex] || null;
}

function getWinnerIds(room) {
  const scored = room.players.map((p) => ({
    id: p.id,
    total: getScoreSummary(p.scores).total,
  }));
  const maxTotal = scored.reduce((m, p) => Math.max(m, p.total), 0);
  return scored.filter((p) => p.total === maxTotal).map((p) => p.id);
}

function isGameOver(room) {
  return room.players.every((p) =>
    CATEGORIES.every((c) => typeof p.scores[c] === "number")
  );
}

function getCurrentRound(room) {
  if (room.status !== "playing" || room.players.length === 0) return 0;
  const totalFilled = room.players.reduce(
    (t, p) => t + getScoreSummary(p.scores).filledCategories, 0
  );
  return Math.min(MAX_ROUNDS, Math.floor(totalFilled / room.players.length) + 1);
}

function serializeRoom(room) {
  return {
    code: room.code,
    status: room.status,
    hostId: room.hostId,
    currentPlayerId: getCurrentPlayer(room)?.id || null,
    currentRound: getCurrentRound(room),
    maxRounds: MAX_ROUNDS,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    winnerIds: room.winnerIds,
    timerEnabled: room.timerEnabled || false,
    timerSeconds: room.timerSeconds || 60,
    turnStartedAt: room.turnStartedAt || null,
    spectatorCount: (room.spectators || []).length,
    spectators: (room.spectators || []).map((s) => ({
      id: s.id,
      name: s.name,
      icon: s.icon || null,
    })),
    chatMessages: room.chatMessages || [],
    turn: {
      dice: room.turn.dice,
      held: room.turn.held,
      rollsUsed: room.turn.rollsUsed,
      rollsLeft: Math.max(0, 3 - room.turn.rollsUsed),
      rollSequence: room.turn.rollSequence,
    },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      color: p.color || PLAYER_COLORS[0],
      icon: p.icon || null,
      connected: p.connected,
      disconnectedAt: p.disconnectedAt || null,
      scores: p.scores,
      ...getScoreSummary(p.scores),
    })),
  };
}

function emitRoomUpdate(io, code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit("room:update", serializeRoom(room));
}

function persistRoom(room) {
  saveRoom(room.code, room);
}

function ensureActor(socket, room, ack) {
  const playerId = socket.data.clientId;
  if (!playerId) {
    sendError(socket, ack, "Spieler-ID fehlt. Bitte Raum neu betreten.");
    return null;
  }
  const player = getPlayerById(room, playerId);
  if (!player) {
    sendError(socket, ack, "Spieler wurde im Raum nicht gefunden.");
    return null;
  }
  return player;
}

// --- Timer management ---

function clearTurnTimer(code) {
  const handle = turnTimers.get(code);
  if (handle) {
    clearTimeout(handle);
    turnTimers.delete(code);
  }
}

function startTurnTimer(io, room) {
  clearTurnTimer(room.code);
  if (!room.timerEnabled || room.status !== "playing") return;

  room.turnStartedAt = Date.now();

  const handle = setTimeout(() => {
    turnTimers.delete(room.code);
    autoScoreCurrentTurn(io, room.code, "timer");
  }, room.timerSeconds * 1000);

  turnTimers.set(room.code, handle);
}

function autoScoreCurrentTurn(io, code, reason) {
  const room = rooms.get(code);
  if (!room || room.status !== "playing") return;

  const player = getCurrentPlayer(room);
  if (!player) return;

  const category = CATEGORIES.find((c) => typeof player.scores[c] !== "number");
  if (!category) return;

  if (room.turn.rollsUsed === 0) {
    player.scores[category] = 0;
  } else {
    player.scores[category] = calculateCategoryScore(category, room.turn.dice);
  }

  advanceTurn(io, room);
}

function advanceTurn(io, room) {
  clearTurnTimer(room.code);

  if (isGameOver(room)) {
    room.status = "finished";
    room.winnerIds = getWinnerIds(room);
    room.finishedAt = Date.now();
  } else {
    room.turnIndex = (room.turnIndex + 1) % room.players.length;
    room.turn = makeTurnState();
    room.turnStartedAt = null;
    startTurnTimer(io, room);

    // If next player is disconnected, start disconnect countdown
    const nextPlayer = getCurrentPlayer(room);
    if (nextPlayer && !nextPlayer.connected) {
      startDisconnectCountdown(io, room.code, nextPlayer.id);
    }
  }

  persistRoom(room);
  emitRoomUpdate(io, room.code);
}

// --- Disconnect grace period ---

function disconnectKey(code, playerId) {
  return `${code}:${playerId}`;
}

function clearDisconnectTimer(code, playerId) {
  const key = disconnectKey(code, playerId);
  const handle = disconnectTimers.get(key);
  if (handle) {
    clearTimeout(handle);
    disconnectTimers.delete(key);
  }
}

function startDisconnectCountdown(io, code, playerId) {
  const key = disconnectKey(code, playerId);
  if (disconnectTimers.has(key)) return; // already running

  const room = rooms.get(code);
  if (!room) return;

  const player = getPlayerById(room, playerId);
  if (player) {
    player.disconnectedAt = Date.now();
  }

  const handle = setTimeout(() => {
    disconnectTimers.delete(key);
    const r = rooms.get(code);
    if (!r || r.status !== "playing") return;

    const current = getCurrentPlayer(r);
    if (current && current.id === playerId && !current.connected) {
      autoScoreCurrentTurn(io, code, "disconnect");
    }
  }, DISCONNECT_GRACE_MS);

  disconnectTimers.set(key, handle);
}

// --- Chat ---

function addChatMessage(room, message) {
  if (!room.chatMessages) room.chatMessages = [];
  room.chatMessages.push(message);
  if (room.chatMessages.length > MAX_CHAT_MESSAGES) {
    room.chatMessages = room.chatMessages.slice(-MAX_CHAT_MESSAGES);
  }
}

// --- Registration ---

function registerGameHandlers(io) {
  // Load persisted rooms on startup
  const persisted = loadActiveRooms();
  for (const [code, state] of persisted) {
    rooms.set(code, state);
  }

  // Cleanup finished rooms every 10 minutes
  setInterval(() => {
    cleanupFinished();
    // Also clean up in-memory finished rooms older than 1 hour
    const cutoff = Date.now() - 3600000;
    for (const [code, room] of rooms) {
      if (room.status === "finished" && room.finishedAt && room.finishedAt < cutoff) {
        rooms.delete(code);
      }
    }
  }, 600000);

  io.on("connection", (socket) => {

    // --- ROOM:CREATE ---
    socket.on("room:create", (payload = {}, ack) => {
      const name = normalizeName(payload.name);
      const incomingId = String(payload.clientId || "").trim();
      const icon = normalizeIcon(payload.icon);

      if (!name) { sendError(socket, ack, "Bitte gib einen Namen ein."); return; }
      if (!incomingId) { sendError(socket, ack, "Ungültige Spieler-ID."); return; }

      const code = generateRoomCode();
      const player = {
        id: incomingId, name, icon,
        color: PLAYER_COLORS[0],
        socketId: socket.id,
        connected: true,
        disconnectedAt: null,
        scores: createEmptyScores(),
      };

      const room = {
        code,
        status: "lobby",
        hostId: player.id,
        players: [player],
        spectators: [],
        turnIndex: 0,
        turn: makeTurnState(),
        winnerIds: [],
        timerEnabled: false,
        timerSeconds: 60,
        turnStartedAt: null,
        chatMessages: [],
        finishedAt: null,
      };

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.clientId = player.id;
      socket.data.isSpectator = false;

      persistRoom(room);
      sendAck(ack, { ok: true, code, playerId: player.id });
      emitRoomUpdate(io, code);
    });

    // --- ROOM:JOIN ---
    socket.on("room:join", (payload = {}, ack) => {
      const code = normalizeCode(payload.code);
      const name = normalizeName(payload.name);
      const incomingId = String(payload.clientId || "").trim();
      const icon = normalizeIcon(payload.icon);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (!name) { sendError(socket, ack, "Bitte gib einen Namen ein."); return; }
      if (!incomingId) { sendError(socket, ack, "Ungültige Spieler-ID."); return; }

      if (room.status !== "lobby") {
        sendError(socket, ack, "Das Spiel läuft bereits.");
        return;
      }

      let player = getPlayerById(room, incomingId);

      if (!player && room.players.length >= MAX_PLAYERS) {
        sendError(socket, ack, `Dieser Raum ist voll (${MAX_PLAYERS} Spieler).`);
        return;
      }

      if (player && player.connected) {
        sendError(socket, ack, "Dieser Spielername ist bereits verbunden.");
        return;
      }

      if (player) {
        player.connected = true;
        player.socketId = socket.id;
        player.name = name;
        player.disconnectedAt = null;
        if (icon) player.icon = icon;
      } else {
        player = {
          id: incomingId, name, icon,
          color: PLAYER_COLORS[room.players.length % PLAYER_COLORS.length],
          socketId: socket.id,
          connected: true,
          disconnectedAt: null,
          scores: createEmptyScores(),
        };
        room.players.push(player);
      }

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.clientId = player.id;
      socket.data.isSpectator = false;

      persistRoom(room);
      sendAck(ack, { ok: true, code: room.code, playerId: player.id });
      emitRoomUpdate(io, room.code);
    });

    // --- ROOM:SPECTATE ---
    socket.on("room:spectate", (payload = {}, ack) => {
      const code = normalizeCode(payload.code);
      const name = normalizeName(payload.name);
      const incomingId = String(payload.clientId || "").trim();
      const icon = normalizeIcon(payload.icon);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (!name) { sendError(socket, ack, "Bitte gib einen Namen ein."); return; }
      if (!incomingId) { sendError(socket, ack, "Ungültige Spieler-ID."); return; }

      if (!room.spectators) room.spectators = [];

      // Check if already a spectator
      let spec = room.spectators.find((s) => s.id === incomingId);
      if (spec) {
        spec.name = name;
        spec.socketId = socket.id;
        if (icon) spec.icon = icon;
      } else {
        spec = { id: incomingId, name, icon, socketId: socket.id };
        room.spectators.push(spec);
      }

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.clientId = incomingId;
      socket.data.isSpectator = true;

      persistRoom(room);
      sendAck(ack, { ok: true, code: room.code, playerId: incomingId });
      emitRoomUpdate(io, room.code);
    });

    // --- ROOM:RECONNECT ---
    socket.on("room:reconnect", (payload = {}, ack) => {
      const code = normalizeCode(payload.code);
      const incomingId = String(payload.clientId || "").trim();
      const room = getRoom(code);

      if (!room) {
        sendAck(ack, { ok: false, error: "Raum nicht mehr verfügbar." });
        return;
      }

      // Check if spectator first
      const spec = (room.spectators || []).find((s) => s.id === incomingId);
      if (spec) {
        spec.socketId = socket.id;
        if (payload.name) { const n = normalizeName(payload.name); if (n) spec.name = n; }
        const ri = normalizeIcon(payload.icon);
        if (ri) spec.icon = ri;

        socket.join(room.code);
        socket.data.roomCode = room.code;
        socket.data.clientId = incomingId;
        socket.data.isSpectator = true;

        sendAck(ack, { ok: true, code: room.code, playerId: incomingId });
        emitRoomUpdate(io, room.code);
        return;
      }

      const player = getPlayerById(room, incomingId);
      if (!player) {
        sendAck(ack, { ok: false, error: "Spieler im Raum nicht gefunden." });
        return;
      }

      if (payload.name) {
        const n = normalizeName(payload.name);
        if (n) player.name = n;
      }
      const ri = normalizeIcon(payload.icon);
      if (ri) player.icon = ri;

      player.connected = true;
      player.socketId = socket.id;
      player.disconnectedAt = null;

      // Clear disconnect timer if any
      clearDisconnectTimer(room.code, player.id);

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.clientId = player.id;
      socket.data.isSpectator = false;

      persistRoom(room);
      sendAck(ack, { ok: true, code: room.code, playerId: player.id });
      emitRoomUpdate(io, room.code);
    });

    // --- ROOM:LEAVE ---
    socket.on("room:leave", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }

      const playerId = socket.data.clientId;

      // Check if spectator
      if (socket.data.isSpectator) {
        room.spectators = (room.spectators || []).filter((s) => s.id !== playerId);
        socket.leave(room.code);
        socket.data.roomCode = undefined;
        persistRoom(room);
        sendAck(ack, { ok: true });
        emitRoomUpdate(io, room.code);
        return;
      }

      const index = room.players.findIndex((p) => p.id === playerId);
      if (index === -1) { sendError(socket, ack, "Spieler wurde im Raum nicht gefunden."); return; }

      room.players.splice(index, 1);
      socket.leave(room.code);
      socket.data.roomCode = undefined;
      clearDisconnectTimer(code, playerId);

      if (room.players.length === 0) {
        clearTurnTimer(room.code);
        rooms.delete(room.code);
        deleteRoom(room.code);
        sendAck(ack, { ok: true });
        return;
      }

      if (room.hostId === playerId) {
        room.hostId = room.players[0].id;
      }

      if (room.status === "playing") {
        if (index < room.turnIndex) {
          room.turnIndex -= 1;
        } else if (index === room.turnIndex) {
          room.turnIndex = room.turnIndex % room.players.length;
          room.turn = makeTurnState();
        }

        if (isGameOver(room)) {
          room.status = "finished";
          room.winnerIds = getWinnerIds(room);
          room.finishedAt = Date.now();
          clearTurnTimer(room.code);
        }
      }

      if (room.status === "finished") {
        room.winnerIds = getWinnerIds(room);
      }

      persistRoom(room);
      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- ROOM:SETTINGS (host sets timer) ---
    socket.on("room:settings", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (room.status !== "lobby") { sendError(socket, ack, "Einstellungen nur in der Lobby änderbar."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;
      if (room.hostId !== player.id) { sendError(socket, ack, "Nur der Host kann Einstellungen ändern."); return; }

      if (typeof payload.timerEnabled === "boolean") {
        room.timerEnabled = payload.timerEnabled;
      }
      if (typeof payload.timerSeconds === "number" && payload.timerSeconds >= 15 && payload.timerSeconds <= 300) {
        room.timerSeconds = payload.timerSeconds;
      }

      persistRoom(room);
      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- GAME:START ---
    socket.on("game:start", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;

      if (room.status !== "lobby") { sendError(socket, ack, "Das Spiel wurde bereits gestartet."); return; }
      if (room.hostId !== player.id) { sendError(socket, ack, "Nur der Host kann das Spiel starten."); return; }

      if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
        sendError(socket, ack, `Zum Starten werden ${MIN_PLAYERS}-${MAX_PLAYERS} Spieler benötigt.`);
        return;
      }

      for (const p of room.players) {
        p.scores = createEmptyScores();
      }

      // Shuffle player order
      for (let i = room.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
      }
      room.status = "playing";
      room.turnIndex = 0;
      room.turn = makeTurnState();
      room.winnerIds = [];
      room.turnStartedAt = null;
      room.finishedAt = null;

      startTurnTimer(io, room);
      persistRoom(room);
      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- GAME:REMATCH ---
    socket.on("game:rematch", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;

      if (room.status !== "finished") { sendError(socket, ack, "Das Spiel ist noch nicht beendet."); return; }
      if (room.hostId !== player.id) { sendError(socket, ack, "Nur der Host kann ein Rematch starten."); return; }

      // Reset scores for all players
      for (const p of room.players) {
        p.scores = createEmptyScores();
      }

      // Shuffle player order
      for (let i = room.players.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [room.players[i], room.players[j]] = [room.players[j], room.players[i]];
      }

      room.status = "playing";
      room.turnIndex = 0;
      room.turn = makeTurnState();
      room.winnerIds = [];
      room.turnStartedAt = null;
      room.finishedAt = null;

      startTurnTimer(io, room);
      persistRoom(room);
      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- GAME:ROLL ---
    socket.on("game:roll", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (room.status !== "playing") { sendError(socket, ack, "Das Spiel ist nicht aktiv."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;

      const currentPlayer = getCurrentPlayer(room);
      if (!currentPlayer || currentPlayer.id !== player.id) {
        sendError(socket, ack, "Du bist gerade nicht am Zug.");
        return;
      }

      if (room.turn.rollsUsed >= 3) {
        sendError(socket, ack, "Du hast in dieser Runde bereits 3-mal gewürfelt.");
        return;
      }

      room.turn.dice = room.turn.dice.map((d, i) =>
        room.turn.held[i] ? d : randomDieValue()
      );
      room.turn.rollsUsed += 1;
      room.turn.rollSequence += 1;

      persistRoom(room);
      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- GAME:TOGGLEHOLD ---
    socket.on("game:toggleHold", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (room.status !== "playing") { sendError(socket, ack, "Das Spiel ist nicht aktiv."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;

      const currentPlayer = getCurrentPlayer(room);
      if (!currentPlayer || currentPlayer.id !== player.id) {
        sendError(socket, ack, "Du bist gerade nicht am Zug.");
        return;
      }

      if (room.turn.rollsUsed === 0) {
        sendError(socket, ack, "Halte Würfel erst nach dem ersten Wurf.");
        return;
      }

      const index = Number(payload.index);
      if (!Number.isInteger(index) || index < 0 || index > 4) {
        sendError(socket, ack, "Ungültiger Würfelindex.");
        return;
      }

      room.turn.held[index] = !room.turn.held[index];

      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    // --- GAME:SCORE ---
    socket.on("game:score", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const category = String(payload.category || "");
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }
      if (room.status !== "playing") { sendError(socket, ack, "Das Spiel ist nicht aktiv."); return; }

      const player = ensureActor(socket, room, ack);
      if (!player) return;

      const currentPlayer = getCurrentPlayer(room);
      if (!currentPlayer || currentPlayer.id !== player.id) {
        sendError(socket, ack, "Du bist gerade nicht am Zug.");
        return;
      }

      if (room.turn.rollsUsed === 0) {
        sendError(socket, ack, "Du musst mindestens einmal würfeln.");
        return;
      }

      if (!CATEGORIES.includes(category)) {
        sendError(socket, ack, "Ungültige Kategorie.");
        return;
      }

      if (typeof player.scores[category] === "number") {
        sendError(socket, ack, "Diese Kategorie wurde bereits eingetragen.");
        return;
      }

      player.scores[category] = calculateCategoryScore(category, room.turn.dice);

      sendAck(ack, { ok: true });
      advanceTurn(io, room);
    });

    // --- CHAT:SEND ---
    socket.on("chat:send", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) { sendError(socket, ack, "Raum wurde nicht gefunden."); return; }

      const playerId = socket.data.clientId;
      if (!playerId) { sendError(socket, ack, "Spieler-ID fehlt."); return; }

      const text = String(payload.text || "").trim().slice(0, 500);
      if (!text) { sendAck(ack, { ok: false, error: "Leere Nachricht." }); return; }

      // Find player or spectator
      let senderName = "Unbekannt";
      let senderIcon = null;
      let senderColor = "#999";

      const player = getPlayerById(room, playerId);
      if (player) {
        senderName = player.name;
        senderIcon = player.icon;
        senderColor = player.color;
      } else {
        const spec = (room.spectators || []).find((s) => s.id === playerId);
        if (spec) {
          senderName = spec.name;
          senderIcon = spec.icon;
          senderColor = "#888";
        }
      }

      const isReaction = ["👏", "😂", "🤬", "🎉"].includes(text);

      const msg = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        playerId,
        playerName: senderName,
        playerIcon: senderIcon,
        playerColor: senderColor,
        text,
        isReaction,
        timestamp: Date.now(),
      };

      addChatMessage(room, msg);
      io.to(code).emit("chat:message", msg);
      persistRoom(room);
      sendAck(ack, { ok: true });
    });

    // --- DISCONNECT ---
    socket.on("disconnect", () => {
      const code = normalizeCode(socket.data.roomCode);
      const room = getRoom(code);
      if (!room) return;

      const playerId = socket.data.clientId;

      // Handle spectator disconnect
      if (socket.data.isSpectator) {
        room.spectators = (room.spectators || []).filter((s) => s.socketId !== socket.id);
        emitRoomUpdate(io, room.code);
        return;
      }

      const player = getPlayerById(room, playerId);
      if (!player) return;

      if (player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
        player.disconnectedAt = Date.now();

        // If it's this player's turn, start disconnect countdown
        if (room.status === "playing") {
          const current = getCurrentPlayer(room);
          if (current && current.id === playerId) {
            startDisconnectCountdown(io, room.code, playerId);
          }
        }
      }

      persistRoom(room);
      emitRoomUpdate(io, room.code);
    });
  });
}

module.exports = {
  registerGameHandlers,
};

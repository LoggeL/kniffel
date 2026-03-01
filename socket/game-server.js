const { CATEGORIES, createEmptyScores } = require("./constants");
const { calculateCategoryScore, getScoreSummary } = require("./scoring");

const rooms = new Map();
const ROOM_CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 6;
const MAX_ROUNDS = 13;

function randomDieValue() {
  return Math.floor(Math.random() * 6) + 1;
}

function normalizeName(name) {
  return String(name || "").trim().slice(0, 24);
}

function normalizeCode(code) {
  return String(code || "")
    .trim()
    .toUpperCase()
    .slice(0, 6);
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
  if (typeof ack === "function") {
    ack(payload);
  }
}

function sendError(socket, ack, message) {
  sendAck(ack, { ok: false, error: message });
  socket.emit("action:error", message);
}

function getRoom(code) {
  return rooms.get(normalizeCode(code));
}

function getPlayerById(room, playerId) {
  return room.players.find((player) => player.id === playerId) || null;
}

function getCurrentPlayer(room) {
  if (room.status !== "playing") {
    return null;
  }
  return room.players[room.turnIndex] || null;
}

function getWinnerIds(room) {
  const playersWithScores = room.players.map((player) => ({
    id: player.id,
    total: getScoreSummary(player.scores).total,
  }));

  const maxTotal = playersWithScores.reduce((max, player) => Math.max(max, player.total), 0);
  return playersWithScores.filter((player) => player.total === maxTotal).map((player) => player.id);
}

function isGameOver(room) {
  return room.players.every((player) =>
    CATEGORIES.every((category) => typeof player.scores[category] === "number")
  );
}

function getCurrentRound(room) {
  if (room.status !== "playing" || room.players.length === 0) {
    return 0;
  }

  const totalTurnsTaken = room.players.reduce(
    (total, player) => total + getScoreSummary(player.scores).filledCategories,
    0
  );

  return Math.min(MAX_ROUNDS, Math.floor(totalTurnsTaken / room.players.length) + 1);
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
    turn: {
      dice: room.turn.dice,
      held: room.turn.held,
      rollsUsed: room.turn.rollsUsed,
      rollsLeft: Math.max(0, 3 - room.turn.rollsUsed),
      rollSequence: room.turn.rollSequence,
    },
    players: room.players.map((player) => ({
      id: player.id,
      name: player.name,
      connected: player.connected,
      scores: player.scores,
      ...getScoreSummary(player.scores),
    })),
  };
}

function emitRoomUpdate(io, code) {
  const room = rooms.get(code);
  if (!room) {
    return;
  }

  io.to(code).emit("room:update", serializeRoom(room));
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

function registerGameHandlers(io) {
  io.on("connection", (socket) => {
    socket.on("room:create", (payload = {}, ack) => {
      const name = normalizeName(payload.name);
      const incomingId = String(payload.clientId || "").trim();

      if (!name) {
        sendError(socket, ack, "Bitte gib einen Namen ein.");
        return;
      }

      if (!incomingId) {
        sendError(socket, ack, "Ungültige Spieler-ID.");
        return;
      }

      const code = generateRoomCode();
      const player = {
        id: incomingId,
        name,
        socketId: socket.id,
        connected: true,
        scores: createEmptyScores(),
      };

      const room = {
        code,
        status: "lobby",
        hostId: player.id,
        players: [player],
        turnIndex: 0,
        turn: makeTurnState(),
        winnerIds: [],
      };

      rooms.set(code, room);
      socket.join(code);
      socket.data.roomCode = code;
      socket.data.clientId = player.id;

      sendAck(ack, { ok: true, code, playerId: player.id });
      emitRoomUpdate(io, code);
    });

    socket.on("room:join", (payload = {}, ack) => {
      const code = normalizeCode(payload.code);
      const name = normalizeName(payload.name);
      const incomingId = String(payload.clientId || "").trim();
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      if (!name) {
        sendError(socket, ack, "Bitte gib einen Namen ein.");
        return;
      }

      if (!incomingId) {
        sendError(socket, ack, "Ungültige Spieler-ID.");
        return;
      }

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
      } else {
        player = {
          id: incomingId,
          name,
          socketId: socket.id,
          connected: true,
          scores: createEmptyScores(),
        };
        room.players.push(player);
      }

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.clientId = player.id;

      sendAck(ack, { ok: true, code: room.code, playerId: player.id });
      emitRoomUpdate(io, room.code);
    });

    socket.on("room:reconnect", (payload = {}, ack) => {
      const code = normalizeCode(payload.code);
      const incomingId = String(payload.clientId || "").trim();
      const room = getRoom(code);

      if (!room) {
        sendAck(ack, { ok: false, error: "Raum nicht mehr verfügbar." });
        return;
      }

      const player = getPlayerById(room, incomingId);

      if (!player) {
        sendAck(ack, { ok: false, error: "Spieler im Raum nicht gefunden." });
        return;
      }

      if (payload.name) {
        const maybeName = normalizeName(payload.name);
        if (maybeName) {
          player.name = maybeName;
        }
      }

      player.connected = true;
      player.socketId = socket.id;

      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.clientId = player.id;

      sendAck(ack, { ok: true, code: room.code, playerId: player.id });
      emitRoomUpdate(io, room.code);
    });

    socket.on("room:leave", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      const playerId = socket.data.clientId;
      const index = room.players.findIndex((player) => player.id === playerId);

      if (index === -1) {
        sendError(socket, ack, "Spieler wurde im Raum nicht gefunden.");
        return;
      }

      room.players.splice(index, 1);
      socket.leave(room.code);
      socket.data.roomCode = undefined;

      if (room.players.length === 0) {
        rooms.delete(room.code);
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

        if (room.players.length < MIN_PLAYERS || isGameOver(room)) {
          room.status = "finished";
          room.winnerIds = getWinnerIds(room);
        }
      }

      if (room.status === "finished") {
        room.winnerIds = getWinnerIds(room);
      }

      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    socket.on("game:start", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      const player = ensureActor(socket, room, ack);
      if (!player) {
        return;
      }

      if (room.status !== "lobby") {
        sendError(socket, ack, "Das Spiel wurde bereits gestartet.");
        return;
      }

      if (room.hostId !== player.id) {
        sendError(socket, ack, "Nur der Host kann das Spiel starten.");
        return;
      }

      if (room.players.length < MIN_PLAYERS || room.players.length > MAX_PLAYERS) {
        sendError(socket, ack, `Zum Starten werden ${MIN_PLAYERS}-${MAX_PLAYERS} Spieler benötigt.`);
        return;
      }

      for (const entry of room.players) {
        entry.scores = createEmptyScores();
      }

      room.status = "playing";
      room.turnIndex = 0;
      room.turn = makeTurnState();
      room.winnerIds = [];

      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    socket.on("game:roll", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      if (room.status !== "playing") {
        sendError(socket, ack, "Das Spiel ist nicht aktiv.");
        return;
      }

      const player = ensureActor(socket, room, ack);
      if (!player) {
        return;
      }

      const currentPlayer = getCurrentPlayer(room);
      if (!currentPlayer || currentPlayer.id !== player.id) {
        sendError(socket, ack, "Du bist gerade nicht am Zug.");
        return;
      }

      if (room.turn.rollsUsed >= 3) {
        sendError(socket, ack, "Du hast in dieser Runde bereits 3-mal gewürfelt.");
        return;
      }

      room.turn.dice = room.turn.dice.map((die, index) =>
        room.turn.held[index] ? die : randomDieValue()
      );
      room.turn.rollsUsed += 1;
      room.turn.rollSequence += 1;

      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    socket.on("game:toggleHold", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      if (room.status !== "playing") {
        sendError(socket, ack, "Das Spiel ist nicht aktiv.");
        return;
      }

      const player = ensureActor(socket, room, ack);
      if (!player) {
        return;
      }

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

    socket.on("game:score", (payload = {}, ack) => {
      const code = normalizeCode(payload.code || socket.data.roomCode);
      const category = String(payload.category || "");
      const room = getRoom(code);

      if (!room) {
        sendError(socket, ack, "Raum wurde nicht gefunden.");
        return;
      }

      if (room.status !== "playing") {
        sendError(socket, ack, "Das Spiel ist nicht aktiv.");
        return;
      }

      const player = ensureActor(socket, room, ack);
      if (!player) {
        return;
      }

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

      if (isGameOver(room)) {
        room.status = "finished";
        room.winnerIds = getWinnerIds(room);
      } else {
        room.turnIndex = (room.turnIndex + 1) % room.players.length;
        room.turn = makeTurnState();
      }

      sendAck(ack, { ok: true });
      emitRoomUpdate(io, room.code);
    });

    socket.on("disconnect", () => {
      const code = normalizeCode(socket.data.roomCode);
      const room = getRoom(code);

      if (!room) {
        return;
      }

      const player = getPlayerById(room, socket.data.clientId);
      if (!player) {
        return;
      }

      if (player.socketId === socket.id) {
        player.connected = false;
        player.socketId = null;
      }

      emitRoomUpdate(io, room.code);
    });
  });
}

module.exports = {
  registerGameHandlers,
};

const path = require("path");
const fs = require("fs");

let db = null;

function getDb() {
  if (db) return db;

  try {
    const Database = require("better-sqlite3");
    const dbDir = process.env.DATA_DIR || "/data";

    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    const dbPath = path.join(dbDir, "kniffel.db");
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");

    db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        code TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        updated_at INTEGER NOT NULL DEFAULT 0,
        finished_at INTEGER
      )
    `);

    console.log(`> SQLite-Datenbank bereit: ${dbPath}`);
    return db;
  } catch (e) {
    console.warn("> SQLite nicht verfügbar, Räume werden nicht persistiert:", e.message);
    return null;
  }
}

function saveRoom(code, roomState) {
  const d = getDb();
  if (!d) return;

  try {
    const serializable = { ...roomState };
    // Remove non-serializable fields
    delete serializable._turnTimer;
    delete serializable._disconnectTimers;

    d.prepare(
      `INSERT OR REPLACE INTO rooms (code, state, updated_at, finished_at) VALUES (?, ?, ?, ?)`
    ).run(
      code,
      JSON.stringify(serializable),
      Date.now(),
      roomState.status === "finished" ? (roomState.finishedAt || Date.now()) : null
    );
  } catch (e) {
    console.error("Fehler beim Speichern des Raums:", e.message);
  }
}

function loadActiveRooms() {
  const d = getDb();
  if (!d) return new Map();

  try {
    const cutoff = Date.now() - 3600000; // 1 hour ago
    const rows = d.prepare(
      `SELECT code, state FROM rooms WHERE finished_at IS NULL OR finished_at > ?`
    ).all(cutoff);

    const result = new Map();
    for (const row of rows) {
      try {
        const state = JSON.parse(row.state);
        // Mark all players as disconnected on load (they need to reconnect)
        for (const player of state.players || []) {
          player.connected = false;
          player.socketId = null;
        }
        for (const spec of state.spectators || []) {
          spec.socketId = null;
        }
        result.set(row.code, state);
      } catch {
        // Skip corrupt entries
      }
    }

    console.log(`> ${result.size} aktive Räume aus Datenbank geladen`);
    return result;
  } catch (e) {
    console.error("Fehler beim Laden der Räume:", e.message);
    return new Map();
  }
}

function cleanupFinished() {
  const d = getDb();
  if (!d) return;

  try {
    const cutoff = Date.now() - 3600000;
    const result = d.prepare(
      `DELETE FROM rooms WHERE finished_at IS NOT NULL AND finished_at < ?`
    ).run(cutoff);
    if (result.changes > 0) {
      console.log(`> ${result.changes} abgeschlossene Räume aufgeräumt`);
    }
  } catch (e) {
    console.error("Fehler beim Aufräumen:", e.message);
  }
}

function deleteRoom(code) {
  const d = getDb();
  if (!d) return;

  try {
    d.prepare(`DELETE FROM rooms WHERE code = ?`).run(code);
  } catch {
    // ignore
  }
}

module.exports = { saveRoom, loadActiveRooms, cleanupFinished, deleteRoom };

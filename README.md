# Kniffel Multiplayer

Mehrspieler-Kniffel (Yahtzee) mit Next.js 14+ (App Router), TypeScript, Socket.io, Tailwind CSS und Framer Motion.

## Features

- Raum-System mit Code (`2-6` Spieler)
- Echtzeit-Synchronisierung aller Spielereignisse
- Vollstaendige Kniffel-Regeln (13 Kategorien, 3 Wuerfe, Halten/Freigeben)
- Automatische Punkteberechnung inkl. Bonus bei `63+` im oberen Block
- Live-Scoreboard und Anzeige des aktiven Spielers
- Deutsches UI, responsiv, Dark Theme
- Game-over Overlay mit Gewinner

## Lokal starten

```bash
npm install
npm run dev
```

App laeuft auf `http://localhost:3000`.

## Build testen

```bash
npm run build
npm run start
```

## Docker

```bash
docker compose up --build
```

## Dokploy (logge.top)

- Build Type: `Dockerfile`
- Port: `3000`
- Start Command: ist im Dockerfile enthalten (`node server.js`)
- Domain in Dokploy/Cloudflare auf den Service zeigen lassen

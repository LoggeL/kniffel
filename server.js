const http = require("http");
const next = require("next");
const { Server } = require("socket.io");
const { registerGameHandlers } = require("./socket/game-server");

const dev = process.env.NODE_ENV !== "production";
const hostname = process.env.HOST || "0.0.0.0";
const port = Number(process.env.PORT || 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app
  .prepare()
  .then(() => {
    const httpServer = http.createServer((req, res) => handle(req, res));

    const io = new Server(httpServer, {
      cors: {
        origin: "*",
      },
    });

    registerGameHandlers(io);

    httpServer.listen(port, hostname, () => {
      console.log(`> Kniffel Server bereit auf http://${hostname}:${port}`);
    });
  })
  .catch((error) => {
    console.error("Server konnte nicht gestartet werden:", error);
    process.exit(1);
  });

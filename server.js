const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({
  server,
  path: "/shelly"
});

const PORT = process.env.PORT || 10000;

let shelly = null;
let connected = false;
let lastStatus = {};

console.log("================================");
console.log("TERMOSTAT REMOTE - DIAGNOSTIC");
console.log("PORT:", PORT);
console.log("WS PATH: /shelly");
console.log("================================");

wss.on("connection", (ws, req) => {

  console.log("================================");
  console.log("!!! SHELLY A DESCHIS CONEXIUNEA !!!");
  console.log("IP:", req.socket.remoteAddress);
  console.log("HEADERS:", JSON.stringify(req.headers));
  console.log("================================");

  shelly = ws;
  connected = true;

  ws.on("message", data => {
    console.log("SHELLY ->", data.toString());

    try {
      const msg = JSON.parse(data.toString());

      if (msg.method === "NotifyStatus") {
        console.log("NOTIFY STATUS:", JSON.stringify(msg.params));
        lastStatus = {
          ...lastStatus,
          ...(msg.params || {})
        };
      }

      if (msg.result) {
        console.log("RPC RESULT:", JSON.stringify(msg.result));
      }

    } catch (e) {
      console.log("JSON ERROR:", e.message);
    }
  });

  ws.on("close", (code, reason) => {
    console.log("================================");
    console.log("SHELLY DISCONNECTED");
    console.log("CODE:", code);
    console.log("REASON:", reason.toString());
    console.log("================================");

    if (shelly === ws) {
      shelly = null;
      connected = false;
    }
  });

  ws.on("error", err => {
    console.log("!!! SHELLY WS ERROR !!!");
    console.log(err.message);
  });

  console.log("Cerem Shelly.GetStatus...");

  ws.send(JSON.stringify({
    id: 1,
    src: "termostat-remote",
    method: "Shelly.GetStatus"
  }));
});

app.get("/", (req, res) => {
  res.send(`
    <h1>TERMOSTAT</h1>
    <h2>${connected ? "🟢 CONNECTED" : "🔴 DESCONECTAT"}</h2>
    <pre>${JSON.stringify(lastStatus, null, 2)}</pre>
  `);
});

app.get("/api/status", (req, res) => {
  res.json({
    connected,
    status: lastStatus
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER GATA");
});

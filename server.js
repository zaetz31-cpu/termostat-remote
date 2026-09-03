const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 10000;

let shelly = null;

console.log("================================");
console.log("TERMOSTAT REMOTE");
console.log("PORT:", PORT);
console.log("WS: ORICE PATH");
console.log("================================");

wss.on("connection", (ws, req) => {

  console.log("================================");
  console.log("!!! SHELLY CONECTAT !!!");
  console.log("PATH:", req.url);
  console.log("IP:", req.socket.remoteAddress);
  console.log("================================");

  shelly = ws;

  ws.on("message", data => {
    console.log("SHELLY ->", data.toString());
  });

  ws.on("close", (code, reason) => {
    console.log("SHELLY DISCONNECTED:", code, reason.toString());
    if (shelly === ws) shelly = null;
  });

  ws.on("error", err => {
    console.log("WS ERROR:", err.message);
  });

  ws.send(JSON.stringify({
    id: 1,
    src: "termostat-remote",
    method: "Shelly.GetStatus"
  }));
});

app.get("/", (req, res) => {
  res.send("TERMOSTAT REMOTE - OK");
});

app.get("/shelly", (req, res) => {
  res.send("SHELLY WS ENDPOINT OK");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER GATA");
});

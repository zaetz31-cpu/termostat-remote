const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 10000;

server.on("upgrade", (req, socket, head) => {
  console.log(">>> WEBSOCKET UPGRADE:", req.url);

  wss.handleUpgrade(req, socket, head, (ws) => {
    console.log(">>> WEBSOCKET CONECTAT:", req.url);

    wss.emit("connection", ws, req);
  });
});

wss.on("connection", (ws, req) => {
  console.log(">>> SHELLY CONECTAT !!!");
  console.log("PATH:", req.url);

  ws.on("message", data => {
    console.log("SHELLY ->", data.toString());
  });

  ws.on("close", (code, reason) => {
    console.log(">>> SHELLY DISCONNECTED:", code, reason.toString());
  });

  ws.on("error", err => {
    console.log(">>> WS ERROR:", err.message);
  });
});

app.get("/", (req, res) => {
  res.send("TERMOSTAT REMOTE OK");
});

app.get("/shelly", (req, res) => {
  res.send("SHELLY WS ENDPOINT OK");
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("SERVER GATA PE PORT:", PORT);
});

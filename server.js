const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);

const wss = new WebSocket.Server({ noServer: true });

const PORT = process.env.PORT || 10000;

let shelly = null;
let lastMessage = null;
let lastSeen = null;

server.on("upgrade", (req, socket, head) => {
    console.log("WS UPGRADE:", req.url);

    if (req.url !== "/shelly") {
        socket.destroy();
        return;
    }

    wss.handleUpgrade(req, socket, head, ws => {
        console.log("SHELLY CONNECTED");

        shelly = ws;
        lastSeen = new Date().toISOString();

        wss.emit("connection", ws, req);
    });
});

wss.on("connection", ws => {

    ws.on("message", data => {

        lastMessage = data.toString();
        lastSeen = new Date().toISOString();

        console.log("SHELLY ->", lastMessage);
    });

    ws.on("close", () => {

        console.log("SHELLY DISCONNECTED");

        if (shelly === ws) {
            shelly = null;
        }
    });

    ws.on("error", err => {
        console.log("WS ERROR:", err.message);
    });
});

app.get("/", (req, res) => {
    res.json({
        ok: true,
        shelly_connected: shelly !== null,
        last_seen: lastSeen
    });
});

app.get("/shelly", (req, res) => {
    res.send("SHELLY WS ENDPOINT OK");
});

app.get("/status", (req, res) => {
    res.json({
        ok: true,
        shelly_connected: shelly !== null,
        last_seen: lastSeen,
        last_message: lastMessage
    });
});

app.get("/test", (req, res) => {
    res.json({
        server: "OK",
        websocket: "READY",
        shelly_connected: shelly !== null
    });
});

server.listen(PORT, "0.0.0.0", () => {
    console.log("SERVER READY:", PORT);
});

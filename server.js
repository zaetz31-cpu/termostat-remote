const express = require("express");
const WebSocket = require("ws");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const DEVICE_ID = "78ee4cc4db1c";

const SHELLY_HOST = process.env.SHELLY_HOST;
const SHELLY_TOKEN = process.env.SHELLY_TOKEN;

let ws = null;
let connected = false;
let lastStatus = null;

function connect() {
  if (!SHELLY_HOST || !SHELLY_TOKEN) {
    console.log("Lipsesc SHELLY_HOST sau SHELLY_TOKEN");
    return;
  }

  const url =
    `wss://${SHELLY_HOST}:6113/shelly/wss/hk_sock?t=${SHELLY_TOKEN}`;

  console.log("Conectare la Shelly Cloud...");

  ws = new WebSocket(url);

  ws.on("open", () => {
    connected = true;
    console.log("SHELLY CLOUD CONNECTED");

    sendCommand("Shelly.GetStatus", {});
  });

  ws.on("message", data => {
    try {
      const msg = JSON.parse(data.toString());

      console.log("SHELLY:", JSON.stringify(msg));

      if (msg.event === "Shelly:StatusOnChange") {
        if (msg.device?.id === DEVICE_ID) {
          lastStatus = msg.status;
        }
      }
    } catch (e) {
      console.log("Mesaj invalid:", e.message);
    }
  });

  ws.on("close", () => {
    connected = false;
    console.log("SHELLY CLOUD DISCONNECTED");

    setTimeout(connect, 5000);
  });

  ws.on("error", err => {
    console.log("WS ERROR:", err.message);
  });
}

function sendCommand(method, params) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.log("WebSocket nu este conectat");
    return false;
  }

  const message = {
    event: "Shelly:CommandRequest",
    deviceId: DEVICE_ID,
    command: {
      src: "termostat-remote",
      method,
      params
    }
  };

  console.log("TRIMIT:", JSON.stringify(message));

  ws.send(JSON.stringify(message));

  return true;
}

function relay(on) {
  return sendCommand("Switch.Set", {
    id: 0,
    on: !!on
  });
}

app.get("/", (req, res) => {
  res.send("TERMOSTAT REMOTE OK");
});

app.get("/api/status", (req, res) => {
  res.json({
    connected,
    device: DEVICE_ID,
    status: lastStatus
  });
});

app.post("/api/on", (req, res) => {
  const ok = relay(true);

  res.json({
    ok,
    relay: "on"
  });
});

app.post("/api/off", (req, res) => {
  const ok = relay(false);

  res.json({
    ok,
    relay: "off"
  });
});

app.listen(PORT, () => {
  console.log("TERMOSTAT REMOTE PORNIT");
  console.log("PORT:", PORT);

  connect();
});

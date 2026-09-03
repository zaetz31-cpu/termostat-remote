const express = require("express");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DEVICE_MAC = "78EECC4DB1C";

let authCode = process.env.SHELLY_AUTH_CODE || "";
let accessToken = null;
let userApiUrl = null;
let ws = null;
let connected = false;
let cloudDeviceId = "132964885519132";
let lastStatus = null;
let trid = 0;
let reconnectTimer = null;
let connecting = false;

// --------------------------------------------------
// HOME
// --------------------------------------------------

app.get("/", (req, res) => {

  const relay = lastStatus?.["switch:0"]?.output;
  const temp = lastStatus?.["temperature:100"]?.tC;

  res.send(`
    <html>
    <head>
      <meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Termostat Remote</title>
    </head>

    <body style="
      font-family:Arial;
      text-align:center;
      padding:30px;
      background:#111;
      color:white">

      <h1>TERMOSTAT REMOTE</h1>

      <h2>
        Status:
        ${connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}
      </h2>

      <p>Cloud ID: ${cloudDeviceId || "necunoscut"}</p>

      <p>
        Releu:
        <b>${relay === true ? "ON" : relay === false ? "OFF" : "?"}</b>
      </p>

      <p>
        Temperatura:
        <b>${temp ?? "?"} °C</b>
      </p>

      <br>

      <button
        style="font-size:22px;padding:15px 35px"
        onclick="cmd('/api/on')">
        ON
      </button>

      <button
        style="font-size:22px;padding:15px 35px;margin-left:10px"
        onclick="cmd('/api/off')">
        OFF
      </button>

      <br><br>

      <a href="/oauth" style="color:white">
        Conectare Shelly
      </a>

      <script>
        function cmd(url) {
          fetch(url, {method:"POST"})
            .then(r => r.json())
            .then(x => {
              console.log(x);
              location.reload();
            });
        }
      </script>

    </body>
    </html>
  `);
});

// --------------------------------------------------
// OAUTH START
// --------------------------------------------------

app.get("/oauth", (req, res) => {

  const redirect =
    `${req.protocol}://${req.get("host")}/oauth/callback`;

  const url =
    "https://my.shelly.cloud/oauth_login.html" +
    "?client_id=shelly-diy" +
    "&redirect_uri=" +
    encodeURIComponent(redirect);

  res.redirect(url);
});

// --------------------------------------------------
// OAUTH CALLBACK
// --------------------------------------------------

app.get("/oauth/callback", async (req, res) => {

  try {

    const code = req.query.code;

    if (!code) {
      return res.status(400).send("Lipseste codul OAuth.");
    }

    authCode = String(code);

    const decoded = jwt.decode(authCode);

    if (
      !decoded ||
      !decoded.user_api_url ||
      !decoded.sub
    ) {
      return res.status(400).send("Cod OAuth invalid.");
    }

    userApiUrl =
      decoded.user_api_url.replace(/\/$/, "");

    const clientId =
      encodeURIComponent(decoded.sub);

    const url =
      `${userApiUrl}/oauth/auth` +
      `?client_id=${clientId}` +
      `&grant_type=code` +
      `&code=${encodeURIComponent(authCode)}`;

    const response = await fetch(url);

    if (!response.ok) {

      const text = await response.text();

      return res.status(500).send(
        `Shelly OAuth error ${response.status}: ${text}`
      );
    }

    const data = await response.json();

    if (!data.access_token) {
      return res.status(500).send(
        "Shelly nu a returnat access_token."
      );
    }

    accessToken = data.access_token;

    res.send(`
      <h1>OK</h1>
      <p>Shelly Cloud autorizat.</p>
      <p>Conectare termostat...</p>
      <p><a href="/">Înapoi</a></p>
    `);

    connectShelly();

  } catch (err) {

    console.error("OAUTH ERROR:", err);

    res.status(500).send(err.message);
  }
});

// --------------------------------------------------
// CONNECT SHELLY
// --------------------------------------------------

function connectShelly() {

  if (!accessToken || !userApiUrl) {
    console.log("Nu exista autentificare Shelly.");
    return;
  }

  // Nu permitem doua conexiuni simultan
  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    console.log("WebSocket deja conectat/conectare.");
    return;
  }

  if (connecting) {
    return;
  }

  connecting = true;

  const host =
    new URL(userApiUrl).host;

  const url =
    `wss://${host}:6113/shelly/wss/hk_sock?t=${accessToken}`;

  console.log("Conectare Shelly WebSocket...");
  console.log("HOST:", host);

  const socket = new WebSocket(url);

  ws = socket;

  socket.on("open", () => {

    connecting = false;
    connected = true;

    console.log("SHELLY CLOUD -> CONNECTED");
  });

  socket.on("message", data => {

    try {

      const msg =
        JSON.parse(data.toString());

      console.log(
        "SHELLY <-",
        JSON.stringify(msg)
      );

      // STATUS DEVICE
      if (
        msg.event === "Shelly:StatusOnChange"
      ) {

        const mac =
          msg.status?.sys?.mac
            ?.replace(/:/g, "")
            .toUpperCase();

        if (mac === DEVICE_MAC) {

          if (msg.device?.id) {
            cloudDeviceId =
              String(msg.device.id);
          }

          lastStatus =
            msg.status;

          console.log(
            "CLOUD DEVICE ID:",
            cloudDeviceId
          );

          console.log(
            "RELEU:",
            lastStatus?.["switch:0"]?.output
          );

          console.log(
            "TEMPERATURA:",
            lastStatus?.["temperature:100"]?.tC
          );
        }
      }

      // COMMAND RESPONSE
      if (
        msg.event === "Shelly:CommandResponse"
      ) {

        console.log(
          "COMMAND RESPONSE:",
          JSON.stringify(msg)
        );
      }

      if (msg.event === "Error") {

        console.log(
          "SHELLY ERROR:",
          JSON.stringify(msg)
        );
      }

    } catch (err) {

      console.log(
        "Mesaj invalid:",
        err.message
      );
    }
  });

  socket.on("close", () => {

    if (ws === socket) {
      ws = null;
    }

    connecting = false;
    connected = false;

    console.log(
      "SHELLY CLOUD -> DISCONNECTED"
    );

    scheduleReconnect();
  });

  socket.on("error", err => {

    connecting = false;

    console.log(
      "SHELLY WS ERROR:",
      err.message
    );
  });
}

// --------------------------------------------------
// RECONNECT
// --------------------------------------------------

function scheduleReconnect() {

  if (reconnectTimer) {
    return;
  }

  reconnectTimer = setTimeout(() => {

    reconnectTimer = null;

    connectShelly();

  }, 5000);
}

// --------------------------------------------------
// RELAY COMMAND
// --------------------------------------------------

function sendRelay(turn) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {

    console.log(
      "WebSocket nu este conectat."
    );

    return false;
  }

  if (!cloudDeviceId) {

    console.log(
      "Cloud Device ID necunoscut."
    );

    return false;
  }

  const msg = {

    event:
      "Shelly:CommandRequest",

    trid:
      ++trid,

    deviceId:
      cloudDeviceId,

    data: {

      cmd:
        "relay",

      params: {

        id: 0,

        turn
      }
    }
  };

  console.log(
    "SHELLY ->",
    JSON.stringify(msg)
  );

  ws.send(
    JSON.stringify(msg)
  );

  return true;
}

// --------------------------------------------------
// ON
// --------------------------------------------------

app.post("/api/on", (req, res) => {

  const ok =
    sendRelay("on");

  res.json({
    ok,
    command: "on"
  });
});

// --------------------------------------------------
// OFF
// --------------------------------------------------

app.post("/api/off", (req, res) => {

  const ok =
    sendRelay("off");

  res.json({
    ok,
    command: "off"
  });
});

// --------------------------------------------------
// TOGGLE
// --------------------------------------------------

app.post("/api/toggle", (req, res) => {

  const ok =
    sendRelay("toggle");

  res.json({
    ok,
    command: "toggle"
  });
});

// --------------------------------------------------
// STATUS
// --------------------------------------------------

app.get("/api/status", (req, res) => {

  res.json({

    connected,

    deviceMac:
      DEVICE_MAC,

    cloudDeviceId,

    relay:
      lastStatus?.["switch:0"]?.output
        ?? null,

    temperature:
      lastStatus?.["temperature:100"]?.tC
        ?? null
  });
});

// --------------------------------------------------
// START
// --------------------------------------------------

app.listen(PORT, () => {

  console.log(
    "TERMOSTAT REMOTE PORNIT"
  );

  console.log(
    "PORT:",
    PORT
  );

  if (authCode) {
    exchangeExistingCode();
  }
});

// --------------------------------------------------
// EXISTING AUTH CODE
// --------------------------------------------------

async function exchangeExistingCode() {

  try {

    const decoded =
      jwt.decode(authCode);

    if (
      !decoded ||
      !decoded.sub ||
      !decoded.user_api_url
    ) {

      console.log(
        "SHELLY_AUTH_CODE invalid."
      );

      return;
    }

    userApiUrl =
      decoded.user_api_url
        .replace(/\/$/, "");

    const clientId =
      encodeURIComponent(decoded.sub);

    const url =
      `${userApiUrl}/oauth/auth` +
      `?client_id=${clientId}` +
      `&grant_type=code` +
      `&code=${encodeURIComponent(authCode)}`;

    const response =
      await fetch(url);

    if (!response.ok) {

      console.log(
        "OAuth HTTP:",
        response.status
      );

      return;
    }

    const data =
      await response.json();

    accessToken =
      data.access_token;

    if (!accessToken) {

      console.log(
        "Nu am primit access_token."
      );

      return;
    }

    console.log(
      "ACCESS TOKEN OBTINUT"
    );

    connectShelly();

  } catch (err) {

    console.error(
      "AUTH ERROR:",
      err.message
    );
  }
}

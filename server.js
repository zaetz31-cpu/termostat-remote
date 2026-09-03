const express = require("express");
const fetch = require("node-fetch");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DEVICE_ID = "78ee4cc4db1c";

let authCode = process.env.SHELLY_AUTH_CODE || "";
let accessToken = null;
let userApiUrl = null;
let ws = null;
let connected = false;
let lastStatus = null;

// --------------------------------------------------
// HOME
// --------------------------------------------------

app.get("/", (req, res) => {
  res.send(`
    <h1>TERMOSTAT REMOTE</h1>
    <p>Status: ${connected ? "CONNECTED" : "DISCONNECTED"}</p>
    <p>Device: ${DEVICE_ID}</p>
    <p><a href="/oauth">Conectare Shelly</a></p>
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

    if (!decoded || !decoded.user_api_url || !decoded.sub) {
      return res.status(400).send(
        "Cod OAuth invalid sau incompatibil."
      );
    }

    userApiUrl = decoded.user_api_url;

    const clientId = encodeURIComponent(decoded.sub);

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
      <p>Acum conectez termostatul...</p>
    `);

    connectShelly();

  } catch (err) {
    console.error("OAUTH ERROR:", err);
    res.status(500).send(err.message);
  }
});

// --------------------------------------------------
// SHELLY CLOUD WEBSOCKET
// --------------------------------------------------

function connectShelly() {

  if (!accessToken || !userApiUrl) {
    console.log("Nu exista token Shelly.");
    return;
  }

  if (ws) {
    try {
      ws.close();
    } catch (_) {}
  }

  const host = new URL(userApiUrl).host;

  const url =
    `wss://${host}:6113/shelly/wss/hk_sock?t=${accessToken}`;

  console.log("Conectare Shelly WebSocket...");
  console.log("HOST:", host);

  ws = new WebSocket(url);

  ws.on("open", () => {
    connected = true;

    console.log("SHELLY CLOUD -> CONNECTED");

    getStatus();
  });

  ws.on("message", data => {

    try {

      const msg = JSON.parse(data.toString());

      console.log(
        "SHELLY <-",
        JSON.stringify(msg)
      );

      if (msg.event === "Shelly:StatusOnChange") {

        if (msg.device &&
            msg.device.id === DEVICE_ID) {

          lastStatus = msg.status;

        }
      }

    } catch (err) {

      console.log(
        "Mesaj Shelly invalid:",
        err.message
      );

    }

  });

  ws.on("close", () => {

    connected = false;

    console.log(
      "SHELLY CLOUD -> DISCONNECTED"
    );

    setTimeout(connectShelly, 5000);

  });

  ws.on("error", err => {

    connected = false;

    console.log(
      "SHELLY WS ERROR:",
      err.message
    );

  });

}

// --------------------------------------------------
// COMMAND
// --------------------------------------------------

function sendCommand(method, params = {}) {

  if (!ws ||
      ws.readyState !== WebSocket.OPEN) {

    console.log(
      "Shelly WebSocket nu este conectat."
    );

    return false;
  }

  const msg = {

    event: "Shelly:CommandRequest",

    deviceId: DEVICE_ID,

    command: {

      src: "termostat-remote",

      method,

      params

    }

  };

  console.log(
    "SHELLY ->",
    JSON.stringify(msg)
  );

  ws.send(JSON.stringify(msg));

  return true;
}

// --------------------------------------------------
// STATUS
// --------------------------------------------------

function getStatus() {

  sendCommand(
    "Shelly.GetStatus",
    {}
  );

}

// --------------------------------------------------
// RELAY ON
// --------------------------------------------------

app.post("/api/on", (req, res) => {

  const ok = sendCommand(
    "Switch.Set",
    {
      id: 0,
      on: true
    }
  );

  res.json({
    ok,
    relay: true
  });

});

// --------------------------------------------------
// RELAY OFF
// --------------------------------------------------

app.post("/api/off", (req, res) => {

  const ok = sendCommand(
    "Switch.Set",
    {
      id: 0,
      on: false
    }
  );

  res.json({
    ok,
    relay: false
  });

});

// --------------------------------------------------
// STATUS API
// --------------------------------------------------

app.get("/api/status", (req, res) => {

  res.json({

    connected,

    device: DEVICE_ID,

    relay:
      lastStatus &&
      lastStatus.switch &&
      lastStatus.switch[0]
        ? lastStatus.switch[0].output
        : null,

    status: lastStatus

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

    const decoded = jwt.decode(authCode);

    if (decoded && decoded.user_api_url) {

      userApiUrl =
        decoded.user_api_url;

      exchangeExistingCode();

    }

  }

});

// --------------------------------------------------
// EXISTING AUTH CODE
// --------------------------------------------------

async function exchangeExistingCode() {

  try {

    const decoded =
      jwt.decode(authCode);

    if (!decoded || !decoded.sub) {

      console.log(
        "SHELLY_AUTH_CODE invalid."
      );

      return;
    }

    userApiUrl =
      decoded.user_api_url;

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

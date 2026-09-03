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
let cloudDeviceId = null;
let lastStatus = null;
let trid = 0;

// --------------------------------------------------
// HOME
// --------------------------------------------------

app.get("/", (req, res) => {
  res.send(`
    <html>
    <body style="font-family:Arial;text-align:center;padding:30px">
      <h1>TERMOSTAT REMOTE</h1>
      <p>Status: <b>${connected ? "CONNECTED" : "DISCONNECTED"}</b></p>
      <p>Cloud ID: ${cloudDeviceId || "necunoscut"}</p>
      <p>Releu: ${
        lastStatus?.["switch:0"]?.output === true
          ? "ON"
          : lastStatus?.["switch:0"]?.output === false
          ? "OFF"
          : "?"
      }</p>
      <p>Temperatura: ${
        lastStatus?.["temperature:100"]?.tC ?? "?"
      } °C</p>

      <p>
        <a href="/oauth">Conectare Shelly</a>
      </p>

      <p>
        <button onclick="fetch('/api/on',{method:'POST'}).then(r=>r.json()).then(alert)">
          ON
        </button>

        <button onclick="fetch('/api/off',{method:'POST'}).then(r=>r.json()).then(alert)">
          OFF
        </button>
      </p>
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

    if (!decoded || !decoded.user_api_url || !decoded.sub) {
      return res.status(400).send(
        "Cod OAuth invalid."
      );
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
// SHELLY WEBSOCKET
// --------------------------------------------------

function connectShelly() {

  if (!accessToken || !userApiUrl) {

    console.log(
      "Nu exista token Shelly."
    );

    return;
  }

  if (ws) {

    try {
      ws.close();
    } catch (_) {}

  }

  const host =
    new URL(userApiUrl).host;

  const url =
    `wss://${host}:6113/shelly/wss/hk_sock?t=${accessToken}`;

  console.log(
    "Conectare Shelly WebSocket..."
  );

  console.log(
    "HOST:",
    host
  );

  ws = new WebSocket(url);

  ws.on("open", () => {

    connected = true;

    console.log(
      "SHELLY CLOUD -> CONNECTED"
    );

  });

  ws.on("message", data => {

    try {

      const msg =
        JSON.parse(data.toString());

      console.log(
        "SHELLY <-",
        JSON.stringify(msg)
      );

      // ------------------------------
      // STATUS
      // ------------------------------

      if (
        msg.event ===
        "Shelly:StatusOnChange"
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

      // ------------------------------
      // COMMAND RESPONSE
      // ------------------------------

      if (
        msg.event ===
        "Shelly:CommandResponse"
      ) {

        console.log(
          "COMMAND RESPONSE:",
          JSON.stringify(msg)
        );
      }

      if (
        msg.event === "Error"
      ) {

        console.log(
          "SHELLY ERROR:",
          JSON.stringify(msg)
        );
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

    setTimeout(
      connectShelly,
      5000
    );

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
// RELAY COMMAND
// --------------------------------------------------

function sendRelay(turn) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {

    console.log(
      "Shelly WebSocket nu este conectat."
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
        ?? null,

    status:
      lastStatus

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

    const decoded =
      jwt.decode(authCode);

    if (
      decoded &&
      decoded.user_api_url
    ) {

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

    if (
      !decoded ||
      !decoded.sub
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
      encodeURIComponent(
        decoded.sub
      );

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

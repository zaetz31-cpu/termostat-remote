const express = require("express");
const WebSocket = require("ws");
const jwt = require("jsonwebtoken");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const DEVICE_MAC = "78EECC4DB1C";
const CLIENT_ID = "shelly-diy";

let authCode = process.env.SHELLY_AUTH_CODE || "";
let accessToken = "";
let userApiUrl = "";

let ws = null;
let connected = false;
let cloudDeviceId = "132964885519132";
let lastStatus = null;
let trid = 0;
let reconnectTimer = null;
let refreshTimer = null;
let connecting = false;


// =====================================================
// HOME
// =====================================================

app.get("/", (req, res) => {
  const relay = lastStatus?.["switch:0"]?.output;
  const temp = lastStatus?.["temperature:100"]?.tC;

  res.send(`
<!DOCTYPE html>
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

<h2>${connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}</h2>

<p>Cloud ID: <b>${cloudDeviceId}</b></p>

<p>Releu:
<b>${relay === true ? "ON" : relay === false ? "OFF" : "?"}</b>
</p>

<p>Temperatura:
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

<button
style="font-size:18px;padding:10px 25px"
onclick="cmd('/api/toggle')">
TOGGLE
</button>

<br><br>

<a href="/oauth" style="color:white">
Conectare Shelly
</a>

<script>
function cmd(url) {
  fetch(url,{method:"POST"})
  .then(r=>r.json())
  .then(x=>{
    console.log(x);
    setTimeout(()=>location.reload(),700);
  });
}
</script>

</body>
</html>
`);
});


// =====================================================
// OAUTH LOGIN
// =====================================================

app.get("/oauth", (req, res) => {

  const redirect =
    `${req.protocol}://${req.get("host")}/oauth/callback`;

  const state =
    Math.random().toString(36).substring(2) +
    Date.now().toString(36);

  const url =
    "https://my.shelly.cloud/oauth_login.html" +
    "?client_id=" +
    CLIENT_ID +
    "&state=" +
    encodeURIComponent(state) +
    "&redirect_uri=" +
    encodeURIComponent(redirect);

  res.redirect(url);
});


// =====================================================
// OAUTH CALLBACK
// =====================================================

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

      console.log(
        "OAUTH HTTP ERROR:",
        response.status,
        text
      );

      return res
        .status(500)
        .send(
          `Shelly OAuth error ${response.status}`
        );
    }

    const data = await response.json();

    if (!data.access_token) {

      console.log(
        "OAuth response:",
        JSON.stringify(data)
      );

      return res
        .status(500)
        .send("Shelly nu a returnat access_token.");
    }

    accessToken =
      data.access_token;

    console.log(
      "OAUTH -> ACCESS TOKEN OK"
    );

    scheduleTokenRefresh();

    res.send(`
      <h1>OK</h1>
      <p>Shelly Cloud autorizat.</p>
      <p>Conectare termostat...</p>
      <p><a href="/">Inapoi</a></p>
    `);

    connectShelly();

  } catch (err) {

    console.error(
      "OAUTH ERROR:",
      err.message
    );

    res
      .status(500)
      .send(err.message);
  }
});


// =====================================================
// TOKEN EXPIRATION
// =====================================================

function scheduleTokenRefresh() {

  if (!accessToken) return;

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  try {

    const decoded =
      jwt.decode(accessToken);

    if (!decoded?.exp) {
      console.log(
        "TOKEN FARA EXPIRARE DETECTABILA"
      );
      return;
    }

    const now =
      Math.floor(Date.now() / 1000);

    const secondsLeft =
      decoded.exp - now;

    console.log(
      "TOKEN EXPIRA IN:",
      secondsLeft,
      "secunde"
    );

    const refreshAfter =
      Math.max(
        60,
        secondsLeft - 300
      );

    refreshTimer =
      setTimeout(
        refreshAccessToken,
        refreshAfter * 1000
      );

  } catch (err) {

    console.log(
      "TOKEN TIMER ERROR:",
      err.message
    );
  }
}


// =====================================================
// REFRESH TOKEN
// =====================================================

async function refreshAccessToken() {

  if (!accessToken || !userApiUrl) {
    return;
  }

  try {

    const url =
      `${userApiUrl}/oauth/auth` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&grant_type=refresh_token` +
      `&refresh_token=${encodeURIComponent(accessToken)}`;

    console.log(
      "INCERC REINNOIREA TOKENULUI..."
    );

    const response =
      await fetch(url);

    if (!response.ok) {

      console.log(
        "REFRESH HTTP:",
        response.status
      );

      scheduleTokenRefresh();

      return;
    }

    const data =
      await response.json();

    if (!data.access_token) {

      console.log(
        "REFRESH FARA ACCESS TOKEN:",
        JSON.stringify(data)
      );

      scheduleTokenRefresh();

      return;
    }

    accessToken =
      data.access_token;

    console.log(
      "TOKEN REINNOIT OK"
    );

    scheduleTokenRefresh();

    if (
      ws &&
      ws.readyState === WebSocket.OPEN
    ) {
      ws.close();
    }

    connectShelly();

  } catch (err) {

    console.log(
      "REFRESH ERROR:",
      err.message
    );

    scheduleTokenRefresh();
  }
}


// =====================================================
// CONNECT SHELLY
// =====================================================

function connectShelly() {

  if (!accessToken || !userApiUrl) {

    console.log(
      "AUTENTIFICAREA SHELLY LIPSESTE"
    );

    return;
  }

  if (
    ws &&
    (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    )
  ) {
    return;
  }

  if (connecting) return;

  connecting = true;

  const host =
    new URL(userApiUrl).host;

  const url =
    `wss://${host}:6113/shelly/wss/hk_sock?t=${accessToken}`;

  console.log(
    "CONECTARE SHELLY..."
  );

  const socket =
    new WebSocket(url);

  ws = socket;


  socket.on("open", async () => {

    connecting = false;
    connected = true;

    console.log(
      "SHELLY CLOUD -> CONNECTED"
    );

    scheduleTokenRefresh();

    await getInitialStatus();
  });


  socket.on("message", data => {

    try {

      const msg =
        JSON.parse(data.toString());


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
            "RELEU:",
            lastStatus?.["switch:0"]?.output
          );

          console.log(
            "TEMP:",
            lastStatus?.["temperature:100"]?.tC
          );
        }
      }


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
        msg.event ===
        "Error"
      ) {

        console.log(
          "SHELLY ERROR:",
          JSON.stringify(msg)
        );
      }

    } catch (err) {

      console.log(
        "MESSAGE ERROR:",
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
      "WEBSOCKET ERROR:",
      err.message
    );
  });
}


// =====================================================
// INITIAL STATUS
// =====================================================

async function getInitialStatus() {

  try {

    const url =
      `${userApiUrl}/device/all_status?show_info=true&no_shared=true`;

    const response =
      await fetch(url, {
        headers: {
          Authorization:
            `Bearer ${accessToken}`
        }
      });

    if (!response.ok) {

      console.log(
        "STATUS HTTP:",
        response.status
      );

      return;
    }

    const data =
      await response.json();

    const devices =
      data?.data?.devices_status || {};

    for (
      const key of Object.keys(devices)
    ) {

      const dev =
        devices[key];

      const info =
        dev?._dev_info;

      const id =
        String(info?.id || "");

      const mac =
        String(info?.mac || "")
        .replace(/:/g, "")
        .toUpperCase();

      if (
        id === cloudDeviceId ||
        mac === DEVICE_MAC
      ) {

        lastStatus =
          dev;

        if (id) {
          cloudDeviceId = id;
        }

        console.log(
          "STATUS INITIAL OK"
        );

        console.log(
          "RELEU:",
          lastStatus?.["switch:0"]?.output
        );

        console.log(
          "TEMP:",
          lastStatus?.["temperature:100"]?.tC
        );

        return;
      }
    }

    console.log(
      "DISPOZITIVUL NU A FOST GASIT"
    );

  } catch (err) {

    console.log(
      "INITIAL STATUS ERROR:",
      err.message
    );
  }
}


// =====================================================
// RECONNECT
// =====================================================

function scheduleReconnect() {

  if (reconnectTimer) return;

  reconnectTimer =
    setTimeout(() => {

      reconnectTimer = null;

      connectShelly();

    }, 5000);
}


// =====================================================
// RELAY COMMAND
// =====================================================

function sendRelay(turn) {

  if (
    !ws ||
    ws.readyState !== WebSocket.OPEN
  ) {

    console.log(
      "WEBSOCKET NU ESTE CONECTAT"
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

        id:
          0,

        turn:
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


// =====================================================
// API
// =====================================================

app.post("/api/on", (req, res) => {

  res.json({
    ok: sendRelay("on"),
    command: "on"
  });
});


app.post("/api/off", (req, res) => {

  res.json({
    ok: sendRelay("off"),
    command: "off"
  });
});


app.post("/api/toggle", (req, res) => {

  res.json({
    ok: sendRelay("toggle"),
    command: "toggle"
  });
});


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


// =====================================================
// START
// =====================================================

app.listen(PORT, () => {

  console.log(
    "TERMOSTAT REMOTE PORNIT"
  );

  console.log(
    "PORT:",
    PORT
  );

  if (authCode) {

    console.log(
      "SHELLY AUTH CODE GASIT"
    );

    exchangeExistingCode();

  } else {

    console.log(
      "AUTORIZARE NECESARA"
    );
  }
});


// =====================================================
// EXISTING AUTH CODE
// =====================================================

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
        "SHELLY_AUTH_CODE INVALID"
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
        "OAUTH START HTTP:",
        response.status
      );

      return;
    }

    const data =
      await response.json();

    if (!data.access_token) {

      console.log(
        "NU AM PRIMIT ACCESS TOKEN"
      );

      return;
    }

    accessToken =
      data.access_token;

    console.log(
      "ACCESS TOKEN OBTINUT LA PORNIRE"
    );

    scheduleTokenRefresh();

    connectShelly();

  } catch (err) {

    console.log(
      "AUTH ERROR:",
      err.message
    );
  }
}

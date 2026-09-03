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
      color:white
    ">

      <h1>TERMOSTAT REMOTE</h1>

      <h2>
        Status:
        ${connected ? "🟢 CONNECTED" : "🔴 DISCONNECTED"}
      </h2>

      <p>
        Cloud ID:
        <b>${cloudDeviceId || "necunoscut"}</b>
      </p>

      <p>
        Releu:
        <b>
          ${
            relay === true
              ? "ON"
              : relay === false
              ? "OFF"
              : "?"
          }
        </b>
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
        style="
          font-size:22px;
          padding:15px 35px;
          margin-left:10px
        "
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

      <a
        href="/oauth"
        style="color:white">
        Conectare Shelly
      </a>

      <script>
        function cmd(url) {
          fetch(url, {
            method: "POST"
          })
          .then(r => r.json())
          .then(x => {
            console.log(x);
            setTimeout(() => location.reload(), 500);
          });
        }
      </script>

    </body>
    </html>
  `);
});


// =====================================================
// OAUTH START
// =====================================================

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


// =====================================================
// OAUTH CALLBACK
// =====================================================

app.get("/oauth/callback", async (req, res) => {

  try {

    const code = req.query.code;

    if (!code) {
      return res
        .status(400)
        .send("Lipseste codul OAuth.");
    }

    authCode = String(code);

    const decoded = jwt.decode(authCode);

    if (
      !decoded ||
      !decoded.user_api_url ||
      !decoded.sub
    ) {
      return res
        .status(400)
        .send("Cod OAuth invalid.");
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

      return res
        .status(500)
        .send(
          `Shelly OAuth error ${response.status}: ${text}`
        );
    }

    const data = await response.json();

    if (!data.access_token) {

      return res
        .status(500)
        .send(
          "Shelly nu a returnat access_token."
        );
    }

    accessToken = data.access_token;

    console.log("OAUTH -> OK");
    console.log("ACCESS TOKEN OBTINUT");

    res.send(`
      <h1>OK</h1>
      <p>Shelly Cloud autorizat.</p>
      <p>Conectare termostat...</p>
      <p>
        <a href="/">Înapoi</a>
      </p>
    `);

    connectShelly();

  } catch (err) {

    console.error(
      "OAUTH ERROR:",
      err
    );

    res
      .status(500)
      .send(err.message);
  }
});


// =====================================================
// CONNECT SHELLY
// =====================================================

function connectShelly() {

  if (!accessToken || !userApiUrl) {

    console.log(
      "Nu exista autentificare Shelly."
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

    console.log(
      "WebSocket deja conectat/conectare."
    );

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

  console.log(
    "Conectare Shelly WebSocket..."
  );

  console.log(
    "HOST:",
    host
  );

  const socket =
    new WebSocket(url);

  ws = socket;


  // ---------------------------------------------------
  // WEBSOCKET OPEN
  // ---------------------------------------------------

  socket.on("open", async () => {

    connecting = false;
    connected = true;

    console.log(
      "SHELLY CLOUD -> CONNECTED"
    );


    // ================================================
    // CEREM STATUSUL INITIAL DIN CLOUD
    // ================================================

    try {

      const statusUrl =
        `${userApiUrl}/device/all_status?show_info=true&no_shared=true`;

      console.log(
        "CER STATUS INITIAL..."
      );

      const response =
        await fetch(statusUrl, {
          headers: {
            Authorization:
              `Bearer ${accessToken}`
          }
        });

      console.log(
        "STATUS HTTP:",
        response.status
      );

      if (!response.ok) {

        const text =
          await response.text();

        console.log(
          "STATUS ERROR:",
          text
        );

        return;
      }

      const data =
        await response.json();

      const devices =
        data?.data?.devices_status || {};

      let found = null;


      // ==============================================
      // CAUTAM SHELLY DUPA MAC / CLOUD ID
      // ==============================================

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
          id === String(cloudDeviceId) ||
          mac === DEVICE_MAC
        ) {

          found = dev;

          if (id) {
            cloudDeviceId = id;
          }

          break;
        }
      }


      // ==============================================
      // STATUS GASIT
      // ==============================================

      if (found) {

        lastStatus = found;

        console.log(
          "STATUS INITIAL PRIMIT"
        );

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

      } else {

        console.log(
          "DISPOZITIVUL NU A FOST GASIT IN STATUS."
        );
      }

    } catch (err) {

      console.log(
        "STATUS ERROR:",
        err.message
      );
    }

  });


  // ---------------------------------------------------
  // WEBSOCKET MESSAGE
  // ---------------------------------------------------

  socket.on("message", data => {

    try {

      const msg =
        JSON.parse(
          data.toString()
        );

      console.log(
        "SHELLY <-",
        JSON.stringify(msg)
      );


      // ==============================================
      // STATUS ON CHANGE
      // ==============================================

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


      // ==============================================
      // COMMAND RESPONSE
      // ==============================================

      if (
        msg.event ===
        "Shelly:CommandResponse"
      ) {

        console.log(
          "COMMAND RESPONSE:",
          JSON.stringify(msg)
        );
      }


      // ==============================================
      // ERROR
      // ==============================================

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
        "Mesaj invalid:",
        err.message
      );
    }

  });


  // ---------------------------------------------------
  // CLOSE
  // ---------------------------------------------------

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


  // ---------------------------------------------------
  // ERROR
  // ---------------------------------------------------

  socket.on("error", err => {

    connecting = false;

    console.log(
      "SHELLY WS ERROR:",
      err.message
    );
  });

}


// =====================================================
// RECONNECT
// =====================================================

function scheduleReconnect() {

  if (reconnectTimer) {
    return;
  }

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
// ON
// =====================================================

app.post("/api/on", (req, res) => {

  const ok =
    sendRelay("on");

  res.json({
    ok,
    command: "on"
  });
});


// =====================================================
// OFF
// =====================================================

app.post("/api/off", (req, res) => {

  const ok =
    sendRelay("off");

  res.json({
    ok,
    command: "off"
  });
});


// =====================================================
// TOGGLE
// =====================================================

app.post("/api/toggle", (req, res) => {

  const ok =
    sendRelay("toggle");

  res.json({
    ok,
    command: "toggle"
  });
});


// =====================================================
// STATUS
// =====================================================

app.get("/api/status", (req, res) => {

  res.json({

    connected:

      connected,

    deviceMac:

      DEVICE_MAC,

    cloudDeviceId:

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
// START SERVER
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
      "SHELLY_AUTH_CODE GASIT"
    );

    exchangeExistingCode();

  } else {

    console.log(
      "SHELLY_AUTH_CODE NU ESTE SETAT"
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

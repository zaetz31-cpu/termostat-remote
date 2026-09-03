const express = require("express");
const http = require("http");
const WebSocket = require("ws");

const app = express();
app.use(express.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server, path: "/shelly" });

const PORT = process.env.PORT || 10000;

let shelly = null;
let connected = false;
let lastStatus = {};
let requestId = 1;

console.log("TERMOSTAT REMOTE PORNIT");
console.log("PORT:", PORT);

// =========================
// SHELLY OUTBOUND WEBSOCKET
// =========================

wss.on("connection", (ws, req) => {
  console.log("SHELLY CONECTAT:", req.socket.remoteAddress);

  shelly = ws;
  connected = true;

  ws.on("message", (data) => {
    try {
      const msg = JSON.parse(data.toString());

      console.log("SHELLY >", JSON.stringify(msg));

      // Raspuns la Shelly.GetStatus
      if (msg.result) {
        mergeStatus(msg.result);
      }

      // NotifyStatus
      if (msg.method === "NotifyStatus" && msg.params) {
        const component = msg.params.component;

        if (component && typeof component === "object") {
          for (const [key, value] of Object.entries(component)) {
            lastStatus[key] = {
              ...(lastStatus[key] || {}),
              ...value
            };
          }
        }
      }

    } catch (e) {
      console.log("MESAJ INVALID:", e.message);
    }
  });

  ws.on("close", () => {
    console.log("SHELLY DECONectAT");
    if (shelly === ws) {
      shelly = null;
      connected = false;
    }
  });

  ws.on("error", (err) => {
    console.log("WS ERROR:", err.message);
  });

  // Cerem statusul complet
  sendRPC("Shelly.GetStatus", {});
});

function mergeStatus(status) {
  if (!status || typeof status !== "object") return;

  for (const [key, value] of Object.entries(status)) {
    if (value && typeof value === "object") {
      lastStatus[key] = {
        ...(lastStatus[key] || {}),
        ...value
      };
    } else {
      lastStatus[key] = value;
    }
  }
}

function sendRPC(method, params = {}) {
  if (!shelly || shelly.readyState !== WebSocket.OPEN) {
    return false;
  }

  const msg = {
    id: requestId++,
    src: "termostat-remote",
    method,
    params
  };

  console.log("SHELLY <", JSON.stringify(msg));
  shelly.send(JSON.stringify(msg));

  return true;
}

// =========================
// STATUS
// =========================

app.get("/api/status", (req, res) => {
  const sw = lastStatus["switch:0"] || {};
  const sys = lastStatus["sys"] || {};
  const temp = lastStatus["temperature:100"] || {};

  res.json({
    connected,
    relay: sw.output === true,
    temperature:
      typeof temp.tC === "number"
        ? temp.tC
        : typeof sys.temperature?.tC === "number"
          ? sys.temperature.tC
          : null
  });
});

// =========================
// RELAY ON
// =========================

app.post("/api/on", (req, res) => {
  if (!connected) {
    return res.status(503).json({
      ok: false,
      error: "Shelly nu este conectat"
    });
  }

  const ok = sendRPC("Switch.Set", {
    id: 0,
    on: true
  });

  res.json({ ok });
});

// =========================
// RELAY OFF
// =========================

app.post("/api/off", (req, res) => {
  if (!connected) {
    return res.status(503).json({
      ok: false,
      error: "Shelly nu este conectat"
    });
  }

  const ok = sendRPC("Switch.Set", {
    id: 0,
    on: false
  });

  res.json({ ok });
});

// =========================
// ROOT
// =========================

app.get("/", (req, res) => {
  res.send(`
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Termostat</title>

<style>
body{
  margin:0;
  background:#111827;
  color:white;
  font-family:Arial,sans-serif;
  display:flex;
  justify-content:center;
  align-items:center;
  min-height:100vh;
}

.card{
  width:340px;
  background:#1f2937;
  border-radius:24px;
  padding:28px;
  box-sizing:border-box;
  text-align:center;
  box-shadow:0 15px 40px rgba(0,0,0,.4);
}

h1{
  margin-top:0;
}

.temp{
  font-size:58px;
  font-weight:bold;
  margin:25px 0 10px;
}

.status{
  font-size:18px;
  margin-bottom:25px;
}

button{
  width:100%;
  padding:16px;
  margin:7px 0;
  border:0;
  border-radius:14px;
  font-size:18px;
  font-weight:bold;
  cursor:pointer;
}

.on{
  background:#22c55e;
  color:white;
}

.off{
  background:#ef4444;
  color:white;
}

.online{
  color:#22c55e;
}

.offline{
  color:#ef4444;
}
</style>
</head>

<body>

<div class="card">

<h1>TERMOSTAT</h1>

<div id="temp" class="temp">--.-°C</div>

<div id="connection" class="status offline">
DESCONECTAT
</div>

<div id="relay" class="status">
RELEU: --
</div>

<button class="on" onclick="relay('on')">
PORNEȘTE
</button>

<button class="off" onclick="relay('off')">
OPREȘTE
</button>

</div>

<script>

async function update(){

  try{

    const r = await fetch('/api/status');
    const s = await r.json();

    const c = document.getElementById('connection');
    const relay = document.getElementById('relay');
    const temp = document.getElementById('temp');

    if(s.connected){

      c.textContent = 'CONECTAT';
      c.className = 'status online';

    }else{

      c.textContent = 'DESCONECTAT';
      c.className = 'status offline';

    }

    relay.textContent =
      'RELEU: ' + (s.relay ? 'PORNIT' : 'OPRIT');

    if(s.temperature !== null){
      temp.textContent =
        Number(s.temperature).toFixed(1) + '°C';
    }

  }catch(e){

    document.getElementById('connection').textContent =
      'EROARE';

  }

}

async function relay(state){

  await fetch('/api/' + state,{
    method:'POST',
    headers:{
      'Content-Type':'application/json'
    }
  });

  setTimeout(update,300);

}

update();
setInterval(update,2000);

</script>

</body>
</html>
`);
});

// =========================
// KEEPALIVE
// =========================

setInterval(() => {

  if (shelly && shelly.readyState === WebSocket.OPEN) {
    shelly.ping();
  }

}, 30000);

// =========================
// START
// =========================

server.listen(PORT, () => {
  console.log("SERVER GATA");
  console.log("WebSocket Shelly: /shelly");
});

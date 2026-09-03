const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const AUTH_KEY = process.env.SHELLY_CLOUD_KEY;
const DEVICE_ID = "132964885519132";

const SHELLY_HOST = "shelly-23-eu.shelly.cloud";

async function shellyRequest(path, options = {}) {
    const url =
        `https://${SHELLY_HOST}${path}` +
        (path.includes("?") ? "&" : "?") +
        `auth_key=${encodeURIComponent(AUTH_KEY)}`;

    const response = await fetch(url, options);

    const text = await response.text();

    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        data = text;
    }

    return {
        status: response.status,
        data: data
    };
}


// HOME
app.get("/", (req, res) => {
    res.json({
        ok: true,
        server: "TERMOSTAT REMOTE",
        device_id: DEVICE_ID
    });
});


// STATUS
app.get("/api/status", async (req, res) => {

    try {

        const result = await shellyRequest(
            "/v2/devices/api/get",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ids: [DEVICE_ID],
                    select: ["status"]
                })
            }
        );

        res.status(result.status).json(result.data);

    } catch (err) {

        res.status(500).json({
            error: err.message
        });
    }
});


// ON / OFF
app.post("/api/relay", async (req, res) => {

    try {

        const on = req.body.on === true;

        const result = await shellyRequest(
            "/v2/devices/api/set/switch",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    id: DEVICE_ID,
                    channel: 0,
                    on: on
                })
            }
        );

        res.status(result.status).json(result.data);

    } catch (err) {

        res.status(500).json({
            error: err.message
        });
    }
});


app.get("/test", async (req, res) => {

    try {

        const result = await shellyRequest(
            "/v2/devices/api/get",
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ids: [DEVICE_ID],
                    select: ["status"]
                })
            }
        );

        res.status(result.status).json(result.data);

    } catch (err) {

        res.status(500).json({
            error: err.message
        });
    }
});


app.listen(PORT, "0.0.0.0", () => {
    console.log("TERMOSTAT REMOTE READY:", PORT);
});

const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const AUTH_KEY = process.env.SHELLY_CLOUD_KEY;
const DEVICE_ID = "78ee4cc4db1c";

// IMPORTANT: pune aici server address-ul din Shelly Cloud
const HOST = process.env.SHELLY_CLOUD_HOST;

app.get("/", (req, res) => {
    res.json({
        server: "TERMOSTAT REMOTE",
        key_loaded: !!AUTH_KEY,
        host_loaded: !!HOST,
        device_id: DEVICE_ID
    });
});

app.get("/test", async (req, res) => {

    if (!AUTH_KEY) {
        return res.status(500).json({
            error: "SHELLY_CLOUD_KEY lipseste"
        });
    }

    if (!HOST) {
        return res.status(500).json({
            error: "SHELLY_CLOUD_HOST lipseste"
        });
    }

    try {

        const url =
            HOST +
            "/v2/devices/api/get?auth_key=" +
            encodeURIComponent(AUTH_KEY);

        const r = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                ids: [DEVICE_ID],
                select: ["status", "settings"]
            })
        });

        const text = await r.text();

        res.json({
            key_loaded: true,
            host: HOST,
            http: r.status,
            response: text
        });

    } catch (e) {

        res.status(500).json({
            error: e.message
        });
    }
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("TERMOSTAT REMOTE READY:", PORT);
});

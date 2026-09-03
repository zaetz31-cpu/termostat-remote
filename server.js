const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;
const AUTH_KEY = process.env.SHELLY_CLOUD_KEY;
const DEVICE_ID = "78ee4cc4db1c";

app.get("/", (req, res) => {
    res.json({
        server: "TERMOSTAT REMOTE",
        key_loaded: !!AUTH_KEY,
        device_id: DEVICE_ID
    });
});

app.get("/test", async (req, res) => {

    const hosts = [
        "https://shelly-23-eu.shelly.cloud",
        "https://shelly-93-eu.shelly.cloud",
        "https://shelly-50-eu.shelly.cloud"
    ];

    const results = [];

    for (const host of hosts) {
        try {
            const url =
                host +
                "/v2/devices/api/get?auth_key=" +
                encodeURIComponent(AUTH_KEY);

            const r = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    ids: [DEVICE_ID],
                    select: ["status"]
                })
            });

            results.push({
                host,
                http: r.status,
                response: await r.text()
            });

        } catch (e) {
            results.push({
                host,
                error: e.message
            });
        }
    }

    res.json({
        key_loaded: !!AUTH_KEY,
        results
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("TERMOSTAT REMOTE READY:", PORT);
});

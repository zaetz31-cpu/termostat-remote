const { Shelly } = require("@ALLTERCO/ushelly");

const DEVICE_ID = "78ee4cc4db1c";

const authCode = process.env.SHELLY_AUTH_CODE;

if (!authCode) {
  console.error("Lipseste SHELLY_AUTH_CODE");
  process.exit(1);
}

async function main() {
  const shelly = new Shelly({
    authCode
  });

  await shelly.start();

  console.log("SHELLY CLOUD CONNECTAT");

  const devices = await shelly.getDevices();

  console.log("DEVICE-URI:");
  console.log(devices);

  const device = devices.find(d => d.id === DEVICE_ID);

  if (!device) {
    console.log("Nu am gasit dispozitivul:", DEVICE_ID);
    return;
  }

  console.log("TERMOSTAT GASIT:");
  console.log(device);
}

main().catch(err => {
  console.error("EROARE:", err);
});

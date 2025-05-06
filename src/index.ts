import { getPublicIP } from "./network";
import { uploadDemos } from "./upload-demos";
import { setupWebSocket, stopPing } from "./websocket";

const ipInterval = setInterval(async () => {
  await getPublicIP();
}, 5 * 1000);

process.once("SIGUSR2", () => {
  stopPing();
  clearInterval(ipInterval);
});

setupWebSocket();

setInterval(async () => {
  await uploadDemos();
}, 1000 * 60);

uploadDemos();

import http from "http";
import { getPublicIP } from "./network";
import { uploadDemos } from "./upload-demos";
import { setupWebSocket, stopPing } from "./websocket";

const ipInterval = setInterval(async () => {
  await getPublicIP();
}, 5 * 1000);

const port = parseInt(process.env.HEALTH_PORT || "8080");

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url && req.url.startsWith("/healthz")) {
    res.statusCode = 200;
    res.end();
    return;
  }

  res.statusCode = 404;
  res.end();
});

server.listen(port, () => {
  console.log(`http server listening on : ${port}`);
});

process.on(process.env.DEV ? "SIGUSR2" : "SIGTERM", () => {
  stopPing();
  clearInterval(ipInterval);
  process.exit(0);
});

setupWebSocket();

setInterval(async () => {
  await uploadDemos();
}, 1000 * 60);

uploadDemos();

import http from "http";
import { getPublicIP } from "./network";
import { uploadDemos } from "./upload-demos";
import { setupWebSocket, stopPing } from "./websocket";
import path from "path";
import fs from "fs";

const ipInterval = setInterval(async () => {
  await getPublicIP();
}, 5 * 1000);

const port = parseInt(process.env.HEALTH_PORT || "8080");

const BASIC_AUTH_USER = process.env.BASIC_AUTH_USER || "5s";
const BASIC_AUTH_PASS = process.env.NODE_NAME;

function parseAuthHeader(authHeader: string | undefined) {
  if (!authHeader || !authHeader.startsWith("Basic ")) return null;
  const base64 = authHeader.slice(6);
  try {
    const [user, pass] = Buffer.from(base64, "base64").toString().split(":");
    return { user, pass };
  } catch (error) {
    console.error("Error parsing auth header", error);
  }
}

const srcDirectory = process.env.DEV
  ? path.join(__dirname, "./../../src")
  : path.join(__dirname, "..");

const server = http.createServer((req, res) => {
  if (req.url && req.url.startsWith("/assets")) {
    res.statusCode = 200;
    res.end(fs.readFileSync(path.join(srcDirectory, req.url)));
    return;
  }

  if (req.method === "GET" && req.url && req.url.startsWith("/")) {
    const auth = parseAuthHeader(req.headers.authorization);
    if (
      !auth ||
      auth.user !== BASIC_AUTH_USER ||
      auth.pass !== BASIC_AUTH_PASS
    ) {
      res.statusCode = 401;
      res.setHeader(
        "WWW-Authenticate",
        'Basic realm="5Stack Offline Match Config"',
      );
      res.end("Authentication required");
      return;
    }
    res.statusCode = 200;
    res.end(fs.readFileSync(path.join(srcDirectory, "./index.html")));
    return;
  }

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

import fs from "fs";
import WebSocket from "ws";
import vdf from "vdf-parser";
import { execSync } from "child_process";
import {
  getNodeLabels,
  getNodeIP,
  getNodeStats,
  getPodStats,
} from "./kubernetes";
import { getLanIP, getPublicIP, publicIP } from "./network";
import { uploadDemos } from "./upload-demos";

let pingInterval: NodeJS.Timeout | null = null;
let ws: WebSocket | null = null;

function setupWebSocket() {
  const wsUrl = `ws://${process.env.API_SERVICE_HOST}:5586/ws`;

  console.info(`connecting to ${wsUrl}`);

  ws = new WebSocket(wsUrl);

  function reset() {
    if (!ws) {
      return;
    }

    stopPing();

    ws.removeAllListeners();
    if (
      ws.readyState === WebSocket.OPEN ||
      ws.readyState === WebSocket.CONNECTING
    ) {
      ws.close();
    }

    ws = null;

    reconnect();
  }

  ws.on("open", () => {
    console.info("connected to 5stack");
    startPing();
  })
    .on("error", (error: Error) => {
      console.error("websocket error:", error);
      reset();
    })
    .on("close", (code: number, reason: Buffer) => {
      console.warn(
        `websocket connection closed with code ${code}, reason: ${reason.toString()}`,
      );
      reset();
    });
}

function startPing() {
  if (pingInterval) {
    return;
  }

  async function sendNodeStatus() {
    const lanIP = await getLanIP();
    const nodeIP = await getNodeIP();
    const labels = await getNodeLabels();
    const nodeStats = await getNodeStats();
    const podStats = await getPodStats();

    if (!publicIP) {
      await getPublicIP();
    }
    console.log(`NODE IP: ${nodeIP}`);

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          event: "message",
          data: {
            labels,
            lanIP,
            nodeIP,
            publicIP,
            nodeStats,
            podStats,
            csBuild: await getCsVersion(),
            node: process.env.NODE_NAME,
          },
        }),
      );
    }
  }

  sendNodeStatus().catch((error) => {
    console.warn("unable to send node status", error);
  });

  pingInterval = setInterval(sendNodeStatus, 1000 * 60);
}

function stopPing() {
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

function reconnect() {
  setTimeout(() => {
    setupWebSocket();
  }, 5000);
}

const ipInterval = setInterval(async () => {
  await getPublicIP();
}, 60 * 1000);

process.once("SIGUSR2", () => {
  stopPing();
  clearInterval(ipInterval);
});

setupWebSocket();

async function getCsVersion() {
  if (!fs.existsSync("/serverfiles/steamapps/appmanifest_730.acf")) {
    return;
  }

  const version = execSync(
    "cat /serverfiles/steamapps/appmanifest_730.acf",
  ).toString();

  const parsed = vdf.parse(version) as {
    AppState?: {
      buildid?: number;
    };
  };

  return parsed?.AppState?.buildid;
}

setInterval(async () => {
  await uploadDemos();
}, 1000 * 60);

uploadDemos();

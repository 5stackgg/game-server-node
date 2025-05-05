import WebSocket from "ws";
import {
  getNodeIP,
  getNodeLabels,
  getNodeStats,
  getPodStats,
} from "./kubernetes";
import { getLanIP, getPublicIP, publicIP } from "./network";
import { getCsVersion } from "./cs";
import { handleWebRTCMessage } from "./webrtc";

let pingInterval: NodeJS.Timeout | null = null;
let ws: WebSocket | null = null;

let currentLanIP: string;
let currentNodeIP: string;
let currentPublicIP: string;

export function startPing() {
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

    if (nodeIP && currentNodeIP !== nodeIP) {
      currentNodeIP = nodeIP;
      console.log(`NODE IP: ${nodeIP}`);
    }

    if (lanIP && currentLanIP !== lanIP) {
      currentLanIP = lanIP;
      console.log(`LAN IP: ${lanIP}`);
    }

    if (publicIP && currentPublicIP !== publicIP) {
      currentPublicIP = publicIP;
      console.log(`Public IP: ${publicIP}`);
    }

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

export function stopPing() {
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

export async function setupWebSocket() {
  const wsUrl = `ws://${process.env.API_SERVICE_HOST}:5586/ws`;

  ws = new WebSocket(wsUrl, {
    headers: {
      "x-node-ip": await getNodeIP(),
    },
  });

  ws.on("message", (message) => {
    const { event, data } = JSON.parse(message.toString());
    switch (event) {
      case "offer":
      case "answer":
      case "candidate":
        handleWebRTCMessage(event, data, ws);
        break;
      default:
        console.warn("unknown event", event);
    }
  });

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

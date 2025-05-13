import WebSocket from "ws";
import redis from "./redis";
import nodeDataChannel, { LogLevel, PeerConnection } from "node-datachannel";

const pcMap = new Map<string, PeerConnection>();

if (process.env.WEBRTC_LOG_LEVEL) {
  nodeDataChannel.initLogger(process.env.WEBRTC_LOG_LEVEL as LogLevel);
}

function createPeerConnection(
  clientId: string,
  peerId: string,
  sessionId: string,
  region: string,
  ws: WebSocket,
) {
  let peerConnection = new nodeDataChannel.PeerConnection(peerId, {
    iceServers: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302",
    ],
  });

  peerConnection.onLocalDescription((description, type) => {
    ws.send(
      JSON.stringify({
        event: type,
        data: {
          peerId,
          clientId,
          type,
          signal: {
            type,
            sdp: description,
          },
        },
      }),
    );
  });

  peerConnection.onLocalCandidate((candidate, sdpMid) => {
    ws.send(
      JSON.stringify({
        event: "candidate",
        data: {
          peerId,
          clientId,
          type: "candidate",
          signal: {
            type: "candidate",
            candidate: {
              sdpMid: sdpMid,
              candidate: candidate,
            },
          },
        },
      }),
    );
  });

  peerConnection.onDataChannel((datachannel) => {
    let startTime: number;
    let latencyArray: number[];

    datachannel.onMessage((data) => {
      switch (data) {
        case "latency-test":
          latencyArray = [];
          datachannel.sendMessage("");
          startTime = performance.now();
          break;
        default:
          const endTime = performance.now();
          const latency = endTime - startTime;

          latencyArray.push(latency);
          if (latencyArray.length < 4) {
            datachannel.sendMessage("");
            startTime = performance.now();
            return;
          }
          const avgLatency =
            latencyArray.reduce((a, b) => a + b, 0) / latencyArray.length;

          const results = {
            region,
            latency: avgLatency,
            isLan: isSameLAN(peerConnection),
          };

          void redis.hset(
            `latency-test:${sessionId}`,
            region.toLowerCase().replace(" ", "_"),
            JSON.stringify(results),
          );

          datachannel.sendMessage(
            JSON.stringify({
              type: "latency-results",
              data: results,
            }),
          );
          break;
      }
    });
  });

  pcMap.set(peerId, peerConnection);

  return peerConnection;
}

function isSameLAN(peerConnection: PeerConnection) {
  const pair = peerConnection.getSelectedCandidatePair();
  if (!pair) return false;

  const localAddress = pair.local.address;
  const remoteAddress = pair.remote.address;

  // IPv4 subnet check
  if (localAddress.includes(".") && remoteAddress.includes(".")) {
    const octets1 = localAddress.split(".");
    const octets2 = remoteAddress.split(".");
    // Compare first 3 octets (assuming /24 subnet)
    return (
      octets1[0] === octets2[0] &&
      octets1[1] === octets2[1] &&
      octets1[2] === octets2[2]
    );
  }

  // IPv6 subnet check
  if (localAddress.includes(":") && remoteAddress.includes(":")) {
    const segments1 = localAddress.split(":");
    const segments2 = remoteAddress.split(":");

    // Compare first 4 segments (assuming /64 subnet)
    return (
      segments1[0] === segments2[0] &&
      segments1[1] === segments2[1] &&
      segments1[2] === segments2[2] &&
      segments1[3] === segments2[3]
    );
  }

  return false;
}

export function handleWebRTCMessage(event: string, data: any, ws: WebSocket) {
  switch (event) {
    case "offer":
      if (!data.clientId || !data.peerId || !data.sessionId || !data.region) {
        console.error("invalid offer", {
          clientId: data.clientId,
          peerId: data.peerId,
          sessionId: data.sessionId,
          region: data.region,
        });
        return;
      }

      const pc = createPeerConnection(
        data.clientId,
        data.peerId,
        data.sessionId,
        data.region,
        ws,
      );
      pc.setRemoteDescription(data.signal.sdp, data.signal.type);
      break;
    case "answer":
      pcMap.get(data.peerId)?.setRemoteDescription(data.description, data.type);
      break;
    case "candidate":
      pcMap
        .get(data.peerId)
        ?.addRemoteCandidate(
          data.signal.candidate.candidate,
          data.signal.candidate.sdpMid,
        );
      break;
  }
}

import WebSocket from "ws";
import nodeDataChannel, { PeerConnection } from "node-datachannel";

const pcMap = new Map<string, PeerConnection>();

function createPeerConnection(clientId: string, peerId: string, ws: WebSocket) {
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

  peerConnection.onDataChannel((dc) => {
    dc.onMessage(() => {
      dc.sendMessage("");
    });
  });

  return (pcMap[peerId] = peerConnection);
}

export function handleWebRTCMessage(event: string, data: any, ws: WebSocket) {
  switch (event) {
    case "offer":
      const pc = createPeerConnection(data.clientId, data.peerId, ws);
      pc.setRemoteDescription(data.signal.sdp, data.signal.type);
      break;
    case "answer":
      pcMap.get(data.peerId)?.setRemoteDescription(data.description, data.type);
      break;
    case "candidate":
      pcMap.get(data.peerId)?.addRemoteCandidate(data.candidate, data.mid);
      break;
  }
}

import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer; // my PeerJS instance
let connections = {}; // peerId -> DataConnection
let peersList = [];   // connected peer IDs

/**
 * Initialize PeerJS instance
 */
export const initPeer = (onMessage, onPeerListUpdate) => {
  peer = new Peer(nanoid(6)); // short 6-char ID

  peer.on("open", (id) => {
    console.log("My ID:", id);
  });

  peer.on("connection", (conn) => {
    setupConnection(conn, onMessage, onPeerListUpdate);
  });

  return peer;
};

/**
 * Connect to another peer by ID
 */
export const connectToPeer = (peerId, onMessage, onPeerListUpdate) => {
  if (peerId === peer.id) return; // don’t connect to self
  if (connections[peerId]) return; // already connected

  const conn = peer.connect(peerId);
  setupConnection(conn, onMessage, onPeerListUpdate);
};

/**
 * Setup handlers for a new connection
 */
const setupConnection = (conn, onMessage, onPeerListUpdate) => {
  conn.on("open", () => {
    console.log("Connected to", conn.peer);
    connections[conn.peer] = conn;

    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    onPeerListUpdate([...peersList]);

    // Introduce myself & known peers
    sendToConn(conn, { type: "intro", peers: [peer.id, ...peersList] });
  });

  conn.on("data", (raw) => {
    let data = parseMessage(raw);

    if (data.type === "intro") {
      // Auto-connect to new peers
      data.peers.forEach((p) => {
        if (p !== peer.id && !connections[p]) {
          connectToPeer(p, onMessage, onPeerListUpdate);
        }
      });
    } else if (data.type === "chat") {
      onMessage(data.from ?? conn.peer, data.text ?? "");
    } else {
      // Fallback for unknown messages
      onMessage(conn.peer, JSON.stringify(data));
    }
  });

  conn.on("close", () => {
    console.log("Disconnected from", conn.peer);
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
    onPeerListUpdate([...peersList]);
  });
};

/**
 * Broadcast a chat message to all peers
 */
export const broadcastMessage = (from, text) => {
  const payload = { type: "chat", from, text };
  Object.values(connections).forEach((conn) => sendToConn(conn, payload));
};

/**
 * Get list of connected peers
 */
export const getPeers = () => peersList;

/**
 * Helpers
 */
const sendToConn = (conn, payload) => {
  try {
    if (typeof payload === "string") {
      conn.send(payload);
    } else {
      conn.send(JSON.stringify(payload));
    }
  } catch (e) {
    console.warn("Send failed", e);
  }
};

const parseMessage = (raw) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { type: "chat", from: "peer", text: raw };
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }
  return { type: "chat", from: "peer", text: String(raw) };
};

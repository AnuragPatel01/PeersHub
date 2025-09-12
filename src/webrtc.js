import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer; // my PeerJS instance
let connections = {}; // peerId -> DataConnection
let peersList = []; // connected peer IDs
let peerNames = {}; // peerId -> name

/**
 * Initialize PeerJS instance
 * onMessage(fromIdOrName, text)
 * onPeerListUpdate(listOfPeerIds)
 *
 * Pass localName (string) so we can advertise it to others.
 */
export const initPeer = (onMessage, onPeerListUpdate, localName = "Anonymous") => {
  peer = new Peer(nanoid(6));

  peer.on("open", (id) => {
    console.log("My ID:", id);
    // advertise own name locally
    peerNames[id] = localName;
  });

  peer.on("connection", (conn) => {
    setupConnection(conn, onMessage, onPeerListUpdate, localName);
  });

  return peer;
};

/**
 * Connect to another peer by ID
 */
export const connectToPeer = (peerId, onMessage, onPeerListUpdate, localName = "Anonymous") => {
  if (!peer) {
    console.warn("Peer not initialized yet");
    return;
  }
  if (peerId === peer.id) return; // don’t connect to self
  if (connections[peerId]) return; // already connected

  const conn = peer.connect(peerId);
  setupConnection(conn, onMessage, onPeerListUpdate, localName);
};

/**
 * Setup handlers for a new connection
 */
const setupConnection = (conn, onMessage, onPeerListUpdate, localName) => {
  conn.on("open", () => {
    console.log("Connected to", conn.peer);
    connections[conn.peer] = conn;

    // add to peers list and notify UI
    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    onPeerListUpdate && onPeerListUpdate([...peersList]);

    // Immediately introduce ourselves (send our id, name and known peers)
    // Note: peersList might include conn.peer already, that's OK.
    sendToConn(conn, {
      type: "intro",
      id: peer.id,
      name: peerNames[peer.id] || localName,
      peers: [...peersList],
    });
  });

  conn.on("data", (raw) => {
    const data = parseMessage(raw);

    // handle intro separately
    if (data.type === "intro") {
      // store name if provided
      if (data.id && data.name) {
        peerNames[data.id] = data.name;
      }

      // ensure peer id present in list
      if (data.id && !peersList.includes(data.id)) {
        peersList.push(data.id);
      }

      // also merge any peers the introducer knows and auto-connect to them
      (data.peers || []).forEach((p) => {
        if (p !== peer.id && !connections[p]) {
          // auto-connect to discovered peers
          try {
            connectToPeer(p, onMessage, onPeerListUpdate, peerNames[peer.id] || localName);
          } catch (e) {
            // ignore connect errors
          }
        }
      });

      // update UI with possible new peers
      onPeerListUpdate && onPeerListUpdate([...peersList]);
      return;
    }

    // chat message
    if (data.type === "chat") {
      // data.from should be the sender's name if sender included it
      const fromName = data.fromName || peerNames[data.from] || data.from || "peer";
      onMessage && onMessage(fromName, data.text ?? "");
      return;
    }

    // fallback: unknown type -> deliver as string
    onMessage && onMessage(data.fromName ?? data.from ?? conn.peer, data.text ? data.text : JSON.stringify(data));
  });

  conn.on("close", () => {
    console.log("Disconnected from", conn.peer);
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
    delete peerNames[conn.peer];
    onPeerListUpdate && onPeerListUpdate([...peersList]);
  });

  conn.on("error", (err) => {
    console.warn("Connection error with", conn.peer, err);
  });
};

/**
 * Broadcast a chat message to all peers
 * - fromName: your display name (string)
 * - text: message text (string)
 */
export const broadcastMessage = (fromName, text) => {
  const payload = { type: "chat", from: peer?.id, fromName, text };
  Object.values(connections).forEach((conn) => sendToConn(conn, payload));
};

/**
 * Get list of connected peer IDs
 */
export const getPeers = () => peersList;

/**
 * Get mapping of peerId -> peer display name (includes self)
 */
export const getPeerNames = () => ({ ...peerNames });

/** Helpers **/

const sendToConn = (conn, payload) => {
  try {
    if (typeof payload === "string") conn.send(payload);
    else conn.send(JSON.stringify(payload));
  } catch (e) {
    console.warn("Send failed", e);
  }
};

const parseMessage = (raw) => {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch (e) {
      return { type: "chat", text: raw };
    }
  }
  if (typeof raw === "object" && raw !== null) {
    return raw;
  }
  return { type: "chat", text: String(raw) };
};

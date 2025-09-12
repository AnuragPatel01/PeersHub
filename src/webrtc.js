import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer;
let connections = {};
let peersList = [];

export const initPeer = (onMessage, onPeerConnected) => {
  peer = new Peer(nanoid(6));

  peer.on("open", (id) => {
    console.log("My ID:", id);
  });

  peer.on("connection", (conn) => {
    setupConnection(conn, onMessage, onPeerConnected);
  });

  return peer;
};

export const connectToPeer = (peerId, onMessage, onPeerConnected) => {
  if (peerId === peer.id) return; // avoid self
  if (connections[peerId]) return; // already connected

  const conn = peer.connect(peerId);
  setupConnection(conn, onMessage, onPeerConnected);
};

const setupConnection = (conn, onMessage, onPeerConnected) => {
  conn.on("open", () => {
    connections[conn.peer] = conn;
    if (!peersList.includes(conn.peer)) peersList.push(conn.peer);
    onPeerConnected([...peersList]);

    // Announce myself + known peers to the new peer
    conn.send({ type: "intro", peers: [peer.id, ...peersList] });
  });

  conn.on("data", (data) => {
    if (data.type === "intro") {
      // Auto-connect to any peers we don’t yet know
      data.peers.forEach((p) => {
        if (p !== peer.id && !connections[p]) {
          connectToPeer(p, onMessage, onPeerConnected);
        }
      });
    } else {
      // Normal chat message
      onMessage(conn.peer, data);
    }
  });

  conn.on("close", () => {
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
    onPeerConnected([...peersList]);
  });
};

export const broadcastMessage = (msg) => {
  Object.values(connections).forEach((conn) => conn.send(msg));
};

export const getPeers = () => peersList;

import Peer from "peerjs";
import { nanoid } from "nanoid";

let peer;
let connections = {};
let peersList = [];

export const initPeer = (onMessage, onPeerConnected) => {
  peer = new Peer(nanoid(6)); // short 6-digit ID

  peer.on("open", (id) => {
    console.log("My PeerJS ID:", id);
  });

  // Incoming connection
  peer.on("connection", (conn) => {
    setupConnection(conn, onMessage, onPeerConnected);
  });

  return peer;
};

export const connectToPeer = (peerId, onMessage, onPeerConnected) => {
  if (connections[peerId]) return;
  const conn = peer.connect(peerId);
  setupConnection(conn, onMessage, onPeerConnected);
};

const setupConnection = (conn, onMessage, onPeerConnected) => {
  conn.on("open", () => {
    connections[conn.peer] = conn;
    peersList.push(conn.peer);
    onPeerConnected(conn.peer);
  });

  conn.on("data", (data) => {
    onMessage(conn.peer, data);
  });

  conn.on("close", () => {
    delete connections[conn.peer];
    peersList = peersList.filter((p) => p !== conn.peer);
  });
};

export const broadcastMessage = (msg) => {
  Object.values(connections).forEach((conn) => {
    conn.send(msg);
  });
};

export const getPeers = () => peersList;

import './App.css'

import React, { useState, useEffect } from "react";
import { initPeer, connectToPeer, broadcastMessage, getPeers } from "./webrtc";

export default function Chat({ user }) {
  const [peerId, setPeerId] = useState("");
  const [peers, setPeers] = useState([]);
  const [messages, setMessages] = useState([]);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    const p = initPeer(
      (from, text) => setMessages((m) => [...m, { from, text }]),
      (list) => setPeers(list)
    );

    p.on("open", (id) => setPeerId(id));
  }, []);

  const handleManualConnect = () => {
    const otherId = prompt("Enter peer ID to connect:");
    if (otherId) {
      connectToPeer(
        otherId,
        (from, text) => setMessages((m) => [...m, { from, text }]),
        (list) => setPeers(list)
      );
    }
  };

  const sendMessage = () => {
    broadcastMessage({ from: user, text: msg });
    setMessages((m) => [...m, { from: "me", text: msg }]);
    setMsg("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 to-purple-600 text-white p-6">
      <h1 className="text-2xl font-bold mb-4">PeersHub</h1>
      <div>Your ID: <span className="font-mono">{peerId}</span></div>

      <button
        onClick={handleManualConnect}
        className="mt-3 py-2 px-4 bg-green-500 text-green-500 rounded"
      >
        Connect to Peer
      </button>

      <div className="mt-4">
        <h2 className="font-semibold">Connected Peers</h2>
        {peers.length === 0 ? (
          <div className="text-sm text-white/70">No peers yet</div>
        ) : (
          peers.map((p) => <div key={p}>{p}</div>)
        )}
      </div>

      <div className="mt-4">
        <h2 className="font-semibold">Chat</h2>
        <div className="h-48 overflow-y-auto bg-white/10 p-2 rounded mb-2">
          {messages.map((m, i) => (
            <div key={i} className="text-sm">
              <b>{m.from}:</b> {m.text}
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            className="flex-1 p-2 rounded bg-white/20"
            placeholder="Type..."
          />
          <button onClick={sendMessage} className="px-3 py-2 bg-green-500 text-purple-500 rounded">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

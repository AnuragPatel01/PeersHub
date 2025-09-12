import React, { useEffect, useState } from "react";
import { initPeer, connectToPeer, broadcastMessage, getPeers } from "./webrtc";

export default function PeersHub() {
  const [peerId, setPeerId] = useState("");
  const [messages, setMessages] = useState([]);
  const [peers, setPeers] = useState([]);
  const [input, setInput] = useState("");

  useEffect(() => {
    const p = initPeer(
      (from, msg) => {
        setMessages((m) => [...m, { from, text: msg }]);
      },
      (id) => {
        setPeers([...getPeers()]);
      }
    );

    p.on("open", (id) => {
      setPeerId(id);
    });
  }, []);

  const handleConnect = () => {
    const otherId = prompt("Enter peer ID to connect:");
    if (otherId) {
      connectToPeer(
        otherId,
        (from, msg) => setMessages((m) => [...m, { from, text: msg }]),
        (id) => setPeers([...getPeers()])
      );
    }
  };

  const sendMessage = () => {
    broadcastMessage(input);
    setMessages((m) => [...m, { from: "me", text: input }]);
    setInput("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-500 to-purple-600 text-white p-6">
      <h1 className="text-2xl font-bold mb-4">PeersHub</h1>
      <div>Your ID: <span className="font-mono">{peerId}</span></div>

      <button onClick={handleConnect} className="mt-3 py-2 px-4 bg-green-500 text-purple-500 rounded">
        Connect to Peer
      </button>

      <div className="mt-4">
        <h2 className="font-semibold">Peers</h2>
        {peers.map((p) => (
          <div key={p}>{p}</div>
        ))}
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
            className="flex-1 p-2 rounded bg-white/20"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type..."
          />
          <button onClick={sendMessage} className="px-3 py-2 bg-green-500 text-green-500 rounded">
            Send
          </button>
        </div>
      </div>
    </div>
  );
}


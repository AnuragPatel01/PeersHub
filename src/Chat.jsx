import "./App.css";

import React, { useEffect, useState, useRef } from "react";
import { initPeer, connectToPeer, broadcastMessage, getPeers, getPeerNames } from "./webrtc";

/**
 * Chat.jsx
 * - Keeps your styling/colors
 * - Shows names (not IDs) for messages & connected peers
 * - Expects initPeer(handleIncoming, handlePeerListUpdate, username)
 */

export default function Chat() {
  const [myId, setMyId] = useState("");
  const [peers, setPeers] = useState([]); // array of peer ids
  const [peerNamesMap, setPeerNamesMap] = useState({}); // id -> name
  const [messages, setMessages] = useState([]); // {from (name), text, ts}
  const [text, setText] = useState("");
  const [username, setUsername] = useState(() => localStorage.getItem("ph_name") || "");
  const [showNamePrompt, setShowNamePrompt] = useState(() => !localStorage.getItem("ph_name"));
  const peerRef = useRef(null);

  // incoming messages (fromName, text)
  const handleIncoming = (fromName, msgText) => {
    const safeText = typeof msgText === "string" ? msgText : JSON.stringify(msgText);
    const fromDisplay = fromName || "peer";
    setMessages((m) => [{ from: fromDisplay, text: safeText, ts: Date.now() }, ...m]);
  };

  // peer list updated: receives array of peer IDs
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
    // refresh peer names map from webrtc helper (exported)
    try {
      const names = getPeerNames();
      setPeerNamesMap(names || {});
    } catch (e) {
      // ignore if not available
    }
  };

  useEffect(() => {
    if (!username) return; // wait until username set
    const p = initPeer(handleIncoming, handlePeerListUpdate, username);
    peerRef.current = p;

    // PeerJS open event
    p.on && p.on("open", (id) => setMyId(id));

    return () => {
      try {
        p && p.destroy && p.destroy();
      } catch (e) {
        console.warn("peer destroy err", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [username]);

  // manual connect (optional)
  const manualConnect = async () => {
    const id = prompt("Enter peer ID to connect:");
    if (!id) return;
    connectToPeer(id.trim(), handleIncoming, handlePeerListUpdate, username);
  };

  const send = () => {
    if (!text.trim()) return;
    const msgObj = { from: username, text: text.trim(), ts: Date.now() };
    setMessages((m) => [msgObj, ...m]);
    broadcastMessage(username, text.trim());
    setText("");
  };

  // render message (keeps your colors)
  const renderMessage = (m) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString();
    const isMe = from === username;

    return (
      <div
        key={m.ts + from}
        className={`p-2 rounded-lg max-w-[80%] mb-2 ${
          isMe
            ? "ml-auto bg-gradient-to-br from-purple-500 to-purple-700 text-white"
            : "bg-white/20 text-white"
        }`}
      >
        <div className="text-xs font-bold">
          {isMe ? "You" : from} <span className="text-[10px] text-white/70 ml-2">{time}</span>
        </div>
        <div className="break-words">{txt}</div>
      </div>
    );
  };

  // Store username first-time UI
  if (showNamePrompt) {
    return (
      <div className="h-screen flex items-center justify-center bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600">
        <div className="bg-white/20 p-6 rounded-2xl text-center">
          <h2 className="text-xl font-bold mb-4">Welcome to PeersHub</h2>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Enter your name"
            className="w-full p-3 rounded-lg bg-white/10 text-purple-600 mb-4"
          />
          <button
            onClick={() => {
              if (!username.trim()) return;
              localStorage.setItem("ph_name", username.trim());
              setUsername(username.trim());
              setShowNamePrompt(false);
            }}
            className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold w-full"
          >
            Continue 🚀
          </button>
        </div>
      </div>
    );
  }

  // Build friendly names for connected peers
  const connectedNames = peers.length
    ? peers.map((id) => peerNamesMap[id] || id)
    : [];

  return (
    <div className="h-screen md:h-[80vh] bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600 p-6 flex flex-col rounded-4xl">
      <header className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-purple-600">Your ID</div>
          <div className="font-mono">{myId || "..."}</div>
          <div className="text-sm text-purple-600">Name: {username}</div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={manualConnect}
            className="px-3 py-2 bg-gradient-to-br from-green-500 to-green-700 text-white rounded text-sm"
          >
            Connect to Peer
          </button>
        </div>
      </header>

      <div className="w-full text-white h-0.5 bg-white" />
      <br />

      <main className="flex-1 overflow-auto mb-4">
        <div className="flex flex-col-reverse">
          {messages.length === 0 && (
            <div className="text-sm text-white/60">No messages yet</div>
          )}
          {messages.map((m) => renderMessage(m))}
        </div>
      </main>

      <div className="w-full text-white h-0.5 bg-white" />

      <footer className="mt-auto">
        <div className="mb-3 text-sm text-white/80">
          Connected peers:{" "}
          {connectedNames.length === 0 ? (
            <span className="text-white/60">none</span>
          ) : (
            connectedNames.join(", ")
          )}
        </div>

        <div className="flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 p-3  bg-white/10 placeholder-white/60 rounded-2xl"
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
          />
          <button
            onClick={send}
            className="px-4 py-3 rounded-lg bg-gradient-to-br from-purple-500 to-purple-700 text-white font-semibold"
          >
            Send
          </button>
        </div>
      </footer>
    </div>
  );
}

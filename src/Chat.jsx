import "./App.css";
import React, { useEffect, useState, useRef } from "react";
import { initPeer, connectToPeer, broadcastMessage, getPeers } from "./webrtc";

/**
 * Chat.jsx
 * - Integrates with src/webrtc.js (initPeer/connectToPeer/broadcastMessage)
 * - Expects webrtc.initPeer(onMessage, onPeerListUpdate)
 */

export default function Chat({ username }) {
  const [myId, setMyId] = useState("");
  const [peers, setPeers] = useState([]); // array of peer ids
  const [messages, setMessages] = useState([]); // {from, text, ts}
  const [text, setText] = useState("");
  const peerRef = useRef(null);

  // onMessage callback invoked by webrtc when a chat arrives
  const handleIncoming = (from, msgText) => {
    // Defensive: if msgText is object, stringify safely
    const safeText =
      typeof msgText === "string" ? msgText : JSON.stringify(msgText);
    setMessages((m) => [
      { from: from || "unknown", text: safeText, ts: Date.now() },
      ...m,
    ]);
  };

  // onPeerListUpdate callback invoked by webrtc when peers list changes
  const handlePeerListUpdate = (list) => {
    setPeers(list || []);
  };

  useEffect(() => {
    // initialize peerjs and provide callbacks
    const p = initPeer(handleIncoming, handlePeerListUpdate);
    peerRef.current = p;

    // PeerJS provides "open" event on the Peer instance
    p.on && p.on("open", (id) => setMyId(id));

    return () => {
      // cleanup (PeerJS does not always have a destroy method on remote builds,
      // but if present, call it)
      try {
        p && p.destroy && p.destroy();
      } catch (e) {
        console.warn("peer destroy err", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // manual connect UI (optional) - you can remove this if you always auto-connect via hub flow
  const manualConnect = async () => {
    const id = prompt("Enter peer ID to connect:");
    if (!id) return;
    connectToPeer(id.trim(), handleIncoming, handlePeerListUpdate);
  };

  const send = () => {
    if (!text.trim()) return;
    // update UI immediately
    setMessages((m) => [
      { from: username || "me", text: text.trim(), ts: Date.now() },
      ...m,
    ]);
    // broadcast to peers via webrtc helper
    broadcastMessage(username || "me", text.trim());
    setText("");
  };

  // render message safely
  const renderMessage = (m) => {
    const from = m.from ?? "peer";
    const txt = typeof m.text === "string" ? m.text : JSON.stringify(m.text);
    const time = new Date(m.ts).toLocaleTimeString();
    const isMe = from === (username || "me");

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
          {isMe ? "You" : from}{" "}
          <span className="text-[10px] text-white/70 ml-2">{time}</span>
        </div>
        <div className="break-words">{txt}</div>
      </div>
    );
  };

  return (
    <div className="h-screen md:h-[80vh] bg-gradient-to-br from-purple-200 to-purple-400 text-purple-600 p-6 flex flex-col rounded-4xl">
      <header className="flex items-center justify-between mb-4">
        <div>
          <div className="text-sm text-purple-600">Your ID</div>
          <div className="font-mono">{myId || "..."}</div>
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
          {peers.length === 0 ? (
            <span className="text-white/60">none</span>
          ) : (
            peers.join(", ")
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

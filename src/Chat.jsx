import React, { useState } from "react";

export default function Chat({ user, hubId, peers, messages, setMessages, setScreen }) {
  const [msg, setMsg] = useState("");

  const sendMessage = (text) => {
    setMessages((m) => [...m, { from: user, text }]);
    Object.values(peers).forEach(({ dc }) => {
      if (dc?.readyState === "open") dc.send(JSON.stringify({ from: user, text }));
    });
    setMsg("");
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 p-6">
      <div className="max-w-sm w-full bg-white/10 rounded-2xl shadow-2xl px-6 py-8 text-white flex flex-col">
        <header className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold">Hub {hubId}</h2>
          <button onClick={() => setScreen("welcome")} className="text-sm text-white/70">
            Leave
          </button>
        </header>

        <div className="flex-1 overflow-auto space-y-2 mb-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`p-2 rounded-lg max-w-[80%] ${
                m.from === user ? "ml-auto bg-green-500 text-black" : "bg-white/20"
              }`}
            >
              <div className="text-xs font-bold">{m.from}</div>
              <div>{m.text}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            className="flex-1 p-2 rounded bg-white/20"
            placeholder="Type a message..."
          />
          <button
            onClick={() => msg.trim() && sendMessage(msg)}
            className="px-4 py-2 rounded bg-green-500 text-black font-semibold"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}

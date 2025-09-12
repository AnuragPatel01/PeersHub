import React, { useState } from "react";

export default function Welcome({ user, setUser, onNext, onJoin }) {
  const [input, setInput] = useState(user);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 p-6">
      <div className="max-w-sm w-full bg-white/10 rounded-2xl shadow-2xl px-6 py-8 backdrop-blur-sm text-white text-center">
        <h1 className="text-2xl font-bold">Welcome to PeersHub</h1>
        <p className="text-sm text-white/80 mt-2">What should we call you?</p>

        <input
          className="mt-4 w-full rounded-lg bg-white/10 placeholder-white/70 p-3 text-black font-medium"
          placeholder="Enter your name"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button
          onClick={() => {
            if (!input.trim()) return;
            setUser(input.trim());
            onNext();
          }}
          className="mt-4 w-full py-3 rounded-lg bg-gradient-to-r from-purple-400 to-purple-600 text-black font-semibold"
        >
          Get Started 🚀
        </button>

        <button
          onClick={() => {
            if (!input.trim()) return;
            setUser(input.trim());
            onJoin();
          }}
          className="mt-2 w-full py-3 rounded-lg bg-white/20 text-white"
        >
          Join a Hub
        </button>
      </div>
    </div>
  );
}

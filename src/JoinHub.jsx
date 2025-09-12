import React, { useState } from "react";
import { handlePasteOffer, handlePasteAnswer } from "./webrtc";

export default function JoinHub({ user, setHubId, setScreen, peers, setPeers }) {
  const [code, setCode] = useState("");

  const processCode = async () => {
    if (!code.trim()) return;
    if (code.startsWith("ey")) {
      // base64 offer/answer
      const decoded = JSON.parse(atob(code));
      if (decoded.type === "offer") {
        const answer = await handlePasteOffer(decoded, user, setPeers);
        await navigator.clipboard.writeText(answer);
        alert("Answer copied! Send it back to the creator.");
      } else if (decoded.type === "answer") {
        await handlePasteAnswer(decoded, setPeers);
        alert("Answer applied.");
      }
      setHubId(code.slice(0, 6));
      setScreen("chat");
    } else {
      alert("Invalid code.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 p-6">
      <div className="max-w-sm w-full bg-white/10 rounded-2xl shadow-2xl px-6 py-8 text-white">
        <h2 className="text-xl font-bold text-center">Join a Hub</h2>
        <textarea
          placeholder="Paste Offer / Answer Code here..."
          value={code}
          onChange={(e) => setCode(e.target.value)}
          className="mt-4 w-full h-28 p-2 rounded bg-white/20 text-sm font-mono"
        />
        <button
          onClick={processCode}
          className="mt-3 w-full py-2 rounded-lg bg-green-500 text-black font-semibold"
        >
          Process Code
        </button>
        <button
          onClick={() => setScreen("welcome")}
          className="mt-3 w-full py-2 rounded-lg bg-white/20"
        >
          ← Back
        </button>
      </div>
    </div>
  );
}

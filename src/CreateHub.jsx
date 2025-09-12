import React, { useEffect, useState } from "react";
import { createPeerConnection } from "./webrtc";   // ⬅️ only import this

export default function CreateHub({ user, setHubId, setScreen, peers, setPeers }) {
  const [offerCode, setOfferCode] = useState("");

  useEffect(() => {
    (async () => {
      const { pc, code } = await createPeerConnection(user, setPeers);
      setOfferCode(code);
      setHubId(code.slice(0, 6)); // short Hub ID (first 6 chars)
    })();
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-purple-500 to-purple-600 p-6">
      <div className="max-w-sm w-full bg-white/10 rounded-2xl shadow-2xl px-6 py-8 text-white">
        <h2 className="text-xl font-bold text-center">Hub Created 🎉</h2>
        <p className="text-sm text-center text-white/80 mt-2">
          Share this Hub ID with friends to let them join
        </p>

        <div className="mt-4 text-center">
          <div className="text-3xl font-mono">{offerCode.slice(0, 6)}</div>
        </div>

        <textarea
          value={offerCode}
          readOnly
          className="mt-4 w-full h-28 p-2 rounded bg-white/20 text-sm font-mono"
        />
        <button
          onClick={() => navigator.clipboard.writeText(offerCode)}
          className="mt-3 w-full py-2 rounded-lg bg-black/70"
        >
          Copy Offer Code
        </button>

        <button
          onClick={() => setScreen("chat")}
          className="mt-3 w-full py-2 rounded-lg bg-green-500 text-black font-semibold"
        >
          Enter Hub
        </button>
      </div>
    </div>
  );
}

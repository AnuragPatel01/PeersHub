import React, { useEffect, useRef } from "react";

// HubInfo.jsx - Modern glassy modal (Tailwind)
// Props:
// - peers: [{ id, name, isHost }]
// - localId
// - localIsHost
// - onRemove(peerId)
// - onClose()
export default function HubInfo({ peers = [], localId, localIsHost, onRemove, onClose }) {
  const wrapperRef = useRef(null);
  const closeBtnRef = useRef(null);

  // close on ESC and focus the close button on open
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose && onClose();
    };
    window.addEventListener("keydown", onKey);
    // focus close button for a11y
    try {
      closeBtnRef.current && closeBtnRef.current.focus();
    } catch (e) {}
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // click outside to close
  useEffect(() => {
    const onDocClick = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) onClose && onClose();
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [onClose]);

  return (
    <div className="max-w-3xl w-full mx-4">
      <div
        ref={wrapperRef}
        className="relative bg-white/6 backdrop-blur-md border border-white/10 rounded-2xl shadow-2xl p-4 md:p-6 ring-1 ring-white/5 overflow-hidden"
        style={{ boxShadow: "0 10px 30px rgba(8,10,20,0.45)" }}
      >
        {/* Decorative gradient glow */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-8 -right-10 w-48 h-48 rounded-full blur-3xl opacity-30"
          style={{
            background:
              "linear-gradient(135deg, rgba(99,102,241,0.32), rgba(16,185,129,0.18))",
          }}
        />

        <header className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg md:text-xl font-semibold text-white">
              Hub Info
            </h3>
            <p className="text-xs text-white/70 mt-1">
              {peers.length} connected
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              ref={closeBtnRef}
              onClick={onClose}
              aria-label="Close Hub Info"
              className="text-sm px-3 py-1 rounded-lg bg-white/8 hover:bg-white/12 text-red-500 transition"
            >
              Close
            </button>
          </div>
        </header>

        <section className="mt-4">
          <div className="mb-3">
            <input
              type="search"
              placeholder="Search peers..."
              onChange={(e) => {
                // lightweight client-side filter: parent can implement search if needed.
                // this is only visual hint; if you want full search, lift state to parent.
              }}
              className="w-full bg-white/4 placeholder-white/50 text-white text-sm p-2 rounded-lg border border-white/8 focus:outline-none focus:ring-2 focus:ring-white/10"
            />
          </div>

          <ul className="divide-y divide-white/6 rounded-md overflow-auto max-h-[48vh]">
            {peers.map((peer, idx) => (
              <li
                key={`${peer?.id ?? "peer"}-${idx}`}
                className="flex items-center justify-between p-3 hover:bg-white/4 transition"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-9 h-9 rounded-lg flex items-center justify-center text-sm font-semibold"
                    style={{
                      background:
                        "linear-gradient(180deg, rgba(255,255,255,0.03), rgba(255,255,255,0.01))",
                      border: "1px solid rgba(255,255,255,0.04)",
                    }}
                  >
                    {peer?.name ? peer.name[0].toUpperCase() : "?"}
                  </div>

                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-white">
                        {peer?.name || "Anonymous"}
                      </span>

                      {peer?.isHost && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gradient-to-r from-blue-600/20 to-violet-600/15 text-blue-200">
                          ⭐ Host
                        </span>
                      )}

                      {peer?.id === localId && (
                        <span className="ml-1 text-xs text-white/60">(You)</span>
                      )}
                    </div>

                    <div className="text-xs text-white/60 font-mono mt-1 truncate max-w-[24rem]">
                      {peer?.id || "unknown-id"}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {localIsHost && !peer?.isHost ? (
                    <button
                      onClick={() => {
                        const ok = window.confirm(
                          `Remove ${peer?.name || peer?.id} from the hub?`
                        );
                        if (ok && typeof onRemove === "function")
                          onRemove(peer?.id);
                      }}
                      className="text-sm px-3 py-1 rounded-lg bg-gradient-to-r from-red-500 to-rose-500 text-white hover:brightness-95 transition"
                    >
                      Remove
                    </button>
                  ) : (
                    <div className="text-xs text-white/50 px-3 py-1 rounded-lg">
                      {peer?.isHost ? "Host" : "Member"}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="mt-4 flex justify-between items-center">
          

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg bg-white/6 hover:bg-white/8 text-blue-500 transition"
            >
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

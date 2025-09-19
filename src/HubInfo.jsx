import React, { useEffect, useRef } from "react";

// HubInfo.jsx - Modern glassy modal (Tailwind)
// Props:
// - peers: [{ id, name, isHost }]
// - localId
// - localIsHost
// - onRemove(peerId)
// - onClose()
export default function HubInfo({
  peers = [],
  localId,
  localIsHost,
  onRemove,
  onClose,
}) {
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
    <div className="max-w-2xl w-full mx-4">
      <div className="relative backdrop-blur-xl bg-white/70 dark:bg-gray-900/60 rounded-2xl shadow-2xl ring-1 ring-white/20 p-4 md:p-6 border border-white/30">
        {/* Decorative gradient */}
        <div className="absolute inset-0 rounded-2xl overflow-hidden pointer-events-none">
          <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/10 dark:from-gray-700/40 dark:to-gray-900/10" />
        </div>

        <header className="relative flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg md:text-xl font-semibold text-gray-800 dark:text-gray-100">
              Hub Info
            </h3>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">
              {peers.length} connected
            </p>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={onClose}
              aria-label="Close Hub Info"
              className="text-sm px-3 py-1 rounded-lg bg-white/50 hover:bg-white/70 dark:bg-gray-700/50 dark:hover:bg-gray-700/70 shadow-sm"
            >
              ✕
            </button>
          </div>
        </header>

        <section className="relative mt-4 max-h-72 overflow-y-auto scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600">
          <ul className="divide-y divide-gray-200/50 dark:divide-gray-700/50 rounded-md overflow-hidden">
            {peers.map((peer, idx) => (
              <li
                key={`${peer?.id ?? "peer"}-${idx}`}
                className="flex items-center justify-between p-3 hover:bg-white/40 dark:hover:bg-gray-800/40 transition-colors rounded-md"
              >
                <div className="flex items-center gap-3">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-gray-800 dark:text-gray-100">
                        {peer?.name || "Anonymous"}
                      </span>
                      {peer?.isHost && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-blue-500/20 text-blue-600 dark:text-blue-400">
                          ⭐ Host
                        </span>
                      )}
                      {peer?.id === localId && (
                        <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
                          (You)
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 font-mono mt-1">
                      {peer?.id || "unknown-id"}
                    </div>
                  </div>
                </div>

                <div>
                  {localIsHost && !peer?.isHost ? (
                    <button
                      onClick={() => {
                        const ok = window.confirm(
                          `Remove ${peer?.name || peer?.id} from the hub?`
                        );
                        if (ok && typeof onRemove === "function") {
                          onRemove(peer?.id);
                        }
                      }}
                      className="text-red-500 hover:text-red-600 text-sm px-2 py-1 rounded-lg hover:bg-red-100/50 dark:hover:bg-red-500/10 transition"
                    >
                      Remove
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="relative mt-4 flex justify-end">
          {/* <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-blue-500/80 hover:bg-blue-500 text-white text-sm shadow-md transition"
          >
            Done
          </button> */}
        </footer>
      </div>
    </div>
  );
}

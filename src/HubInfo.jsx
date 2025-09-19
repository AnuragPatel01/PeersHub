import React, { useEffect, useRef, useState } from "react";
import {
  XIcon,
  StarIcon,
  TrashIcon,
  UserIcon,
  SearchIcon,
} from "@heroicons/react/solid";

/**
 * HubInfo.jsx - polished glassy modal for peers list
 *
 * Props:
 *  - peers: [{ id, name, isHost }]
 *  - localId
 *  - localIsHost
 *  - onRemove(peerId) -> host-only: called when confirmed
 *  - onClose()
 *
 * Notes:
 *  - Uses Tailwind classes. If you don't have `backdrop-blur` or `backdrop-filter`
 *    enabled in Tailwind, enable them or replace blur classes with solid backgrounds.
 *  - heroicons are referenced from `@heroicons/react/solid` — optional. If you don't
 *    have them, replace imports with simple <svg> or remove icons.
 */

export default function HubInfo({
  peers = [],
  localId,
  localIsHost,
  onRemove,
  onClose,
}) {
  const [query, setQuery] = useState("");
  const [confirmRemoveId, setConfirmRemoveId] = useState(null);
  const [animKey, setAnimKey] = useState(0); // small key to re-trigger list animation if needed
  const wrapperRef = useRef(null);
  const closeBtnRef = useRef(null);
  const searchRef = useRef(null);

  useEffect(() => {
    // focus search when opened for quick keyboard access
    try {
      searchRef.current && searchRef.current.focus();
    } catch (e) {}
    // focus close for a11y fallback
    try {
      closeBtnRef.current && closeBtnRef.current.focus();
    } catch (e) {}
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") {
        if (confirmRemoveId) {
          // cancel confirmation first
          setConfirmRemoveId(null);
        } else {
          onClose && onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmRemoveId, onClose]);

  // click outside to close (non-intrusive)
  useEffect(() => {
    const onDocClick = (e) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target)) {
        if (confirmRemoveId) setConfirmRemoveId(null);
        else onClose && onClose();
      }
    };
    window.addEventListener("mousedown", onDocClick);
    return () => window.removeEventListener("mousedown", onDocClick);
  }, [confirmRemoveId, onClose]);

  const normalizedPeers = (peers || []).map((p) =>
    typeof p === "string" ? { id: p, name: p, isHost: false } : p || {}
  );

  const filtered = normalizedPeers.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const name = (p.name || p.id || "").toLowerCase();
    return name.includes(q) || (p.id || "").toLowerCase().includes(q);
  });

  const handleConfirmRemove = async (peerId) => {
    // close confirm UI
    setConfirmRemoveId(null);
    // call parent handler
    try {
      await (onRemove ? onRemove(peerId) : Promise.resolve());
      // small animation refresh to visually update list
      setAnimKey((k) => k + 1);
    } catch (e) {
      console.warn("onRemove failed:", e);
    }
  };

  return (
    <>
      {/* small inline CSS for entrance + item pop animation (avoids global file edits) */}
      <style>{`
        @keyframes hubScaleIn { from { transform: translateY(8px) scale(.985); opacity: 0 } to { transform: translateY(0) scale(1); opacity: 1 } }
        .hub-anim { animation: hubScaleIn 220ms cubic-bezier(.2,.9,.3,1) both; }
        .peer-item-enter { transform-origin: left top; transition: transform .16s ease, opacity .16s ease; }
        .peer-item-enter:hover { transform: translateY(-4px) scale(1.01); }
      `}</style>

      <div
        ref={wrapperRef}
        className="max-w-md w-full mx-4 hub-anim"
        role="dialog"
        aria-modal="true"
        aria-label="Hub info"
      >
       <div className="relative rounded-2xl bg-white/90 dark:bg-slate-900/70 backdrop-blur-md border border-white/20 shadow-2xl p-4 md:p-6 overflow-hidden">

          {/* decorative soft glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-12 -top-10 w-44 h-44 rounded-full blur-3xl opacity-30"
            style={{
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.35), rgba(16,185,129,0.18))",
            }}
          />

          {/* header */}
          <div className="flex items-start gap-3">
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-slate-800 dark:text-white">
                Hub Info
              </h3>
              <div className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                <span className="font-medium">{normalizedPeers.length}</span>{" "}
                connected
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                ref={closeBtnRef}
                onClick={onClose}
                title="Close"
                className="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/10 hover:bg-white/20 border border-white/6 shadow-sm"
                aria-label="Close hub info"
              >
                <XIcon className="w-5 h-5 text-slate-700 dark:text-white" />
              </button>
            </div>
          </div>

          {/* search */}
          <div className="mt-3">
            <label htmlFor="hub-search" className="sr-only">
              Search peers
            </label>
            <div className="flex items-center gap-2 bg-white/6 rounded-lg border border-white/6 px-3 py-2">
              <SearchIcon className="w-5 h-5 text-slate-600 dark:text-slate-300" />
              <input
                id="hub-search"
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search peers by name or id..."
                className="flex-1 bg-transparent outline-none text-sm text-slate-800 dark:text-white placeholder-slate-500"
              />
              <button
                onClick={() => {
                  setQuery("");
                  try {
                    searchRef.current && searchRef.current.focus();
                  } catch {}
                }}
                className="text-xs text-slate-500 hover:text-slate-700"
                aria-label="Clear search"
              >
                Clear
              </button>
            </div>
          </div>

          {/* peers list */}
          <div className="mt-4 max-h-56 overflow-y-auto">
            {filtered.length === 0 ? (
              <div className="text-sm text-slate-500 dark:text-slate-300 p-3">
                No peers found.
              </div>
            ) : (
              <ul className="space-y-2">
                {filtered.map((p, i) => {
                  const id = p?.id || String(i);
                  const name = p?.name || id;
                  const isLocal = id === localId;
                  const isHost = Boolean(p?.isHost);
                  return (
                    <li
                      key={`${id}-${i}-${animKey}`}
                      className="peer-item-enter rounded-xl p-3 flex items-center justify-between bg-white/6 border border-white/6 hover:bg-white/10 transition"
                      title={id}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-gradient-to-br from-white/10 to-white/5 border border-white/5">
                          {isHost ? (
                            <StarIcon className="w-5 h-5 text-yellow-400" />
                          ) : (
                            <UserIcon className="w-5 h-5 text-slate-500" />
                          )}
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <div className="text-sm font-medium text-slate-800 dark:text-white">
                              {name}
                            </div>

                            {isHost && (
                              <div className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-yellow-50 text-yellow-600 border border-yellow-100">
                                <StarIcon className="w-3 h-3 mr-1" />
                                Host
                              </div>
                            )}

                            {isLocal && (
                              <div className="ml-1 text-xs text-slate-500 dark:text-slate-300">
                                (You)
                              </div>
                            )}
                          </div>

                          <div className="text-xs font-mono text-slate-500 dark:text-slate-300 mt-1 truncate max-w-[220px]">
                            {id}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {/* host cannot remove themselves or other hosts */}
                        {localIsHost && !isHost ? (
                          <button
                            onClick={() => setConfirmRemoveId(id)}
                            className="inline-flex items-center gap-2 px-3 py-1 rounded-lg bg-red-500 text-white text-sm shadow-sm hover:bg-red-600"
                            aria-label={`Remove ${name}`}
                          >
                            <TrashIcon className="w-4 h-4" />
                            Remove
                          </button>
                        ) : (
                          <div className="text-xs text-slate-500 dark:text-slate-300 px-3 py-1 rounded">
                            {isHost ? "Host" : "Member"}
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* footer */}
          <div className="mt-4 flex items-center justify-between">
            

            <div className="flex items-center gap-2">
              {/* <button
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 text-white text-sm hover:brightness-95"
              >
                Close
              </button> */}
            </div>
          </div>
        </div>
      </div>

      {/* Remove confirmation modal (inline layered panel) */}
      {confirmRemoveId && (
        <div className="fixed inset-0 z-60 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/40 backdrop-blur-sm"
            aria-hidden
            onClick={() => setConfirmRemoveId(null)}
          />
          <div className="relative max-w-sm w-full p-4 hub-anim">
            <div className="rounded-xl bg-white/95 dark:bg-slate-900 p-4 shadow-xl border border-white/5">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <h4 className="text-sm font-semibold text-slate-900 dark:text-white">
                    Remove peer?
                  </h4>
                  <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                    Are you sure you want to remove{" "}
                    <span className="font-medium">{confirmRemoveId}</span> from
                    the hub? This will cause them to be disconnected.
                  </p>
                </div>
                <button
                  onClick={() => setConfirmRemoveId(null)}
                  className="text-slate-500 hover:text-slate-700"
                  aria-label="Cancel"
                >
                  ✕
                </button>
              </div>

              <div className="mt-4 flex justify-end gap-2">
                <button
                  onClick={() => setConfirmRemoveId(null)}
                  className="px-3 py-1 rounded-md bg-white/6 text-slate-700"
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleConfirmRemove(confirmRemoveId)}
                  className="px-3 py-1 rounded-md bg-red-500 text-white"
                >
                  Remove
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

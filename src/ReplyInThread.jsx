// src/components/ReplyInThread.jsx
import React, { useEffect, useRef, useState } from "react";
import { nanoid } from "nanoid";

/**
 * ReplyInThread
 *
 * Props:
 * - rootMessage: the message object this thread is rooted at (required)
 * - currentUser: string identifier / display name for the current user (optional)
 * - onSend(replyMsg) : async function called when user sends a reply. Receives a reply object:
 *      {
 *        id, text, from, fromName, ts, threadRootId, replyTo? (optional)
 *      }
 *   The component will optimistically add the reply to local UI; the parent should persist/broadcast.
 * - onCancel(): called when user cancels/close the thread modal
 *
 * Notes:
 * - This component is intentionally lightweight and self-contained so it can be dropped into Chat.jsx.
 * - It keeps an optimistic in-memory list of replies. The parent may choose to store thread replies
 *   in the global message timeline (Chat.jsx wiring already does this).
 */

export default function ReplyInThread({
  rootMessage,
  currentUser = "You",
  onSend,
  onCancel,
}) {
  const [replyText, setReplyText] = useState("");
  const [replies, setReplies] = useState([]); // optimistic local replies for immediate UX
  const [isSending, setIsSending] = useState(false);
  const [replyTo, setReplyTo] = useState(null); // allow replying to a reply inside the thread
  const inputRef = useRef(null);

  useEffect(() => {
    // autofocus input when modal opens
    try {
      inputRef.current && inputRef.current.focus();
    } catch (e) {}
  }, [rootMessage]);

  // When rootMessage changes we reset the local reply composer (but keep local replies)
  useEffect(() => {
    setReplyText("");
    setReplyTo(null);
  }, [rootMessage?.id]);

  const handleSendClick = async () => {
    const text = (replyText || "").trim();
    if (!text) return;
    const id = nanoid();
    const replyObj = {
      id,
      text,
      from: currentUser || (rootMessage?.fromName || rootMessage?.from || "unknown"),
      fromName: currentUser || (rootMessage?.fromName || rootMessage?.from || "unknown"),
      ts: Date.now(),
      threadRootId: rootMessage?.threadRootId || rootMessage?.id,
      replyTo: replyTo
        ? { id: replyTo.id, from: replyTo.from, text: replyTo.text }
        : null,
      type: "thread",
    };

    // optimistic update
    setReplies((r) => [...r, replyObj]);
    setIsSending(true);
    setReplyText("");
    setReplyTo(null);

    try {
      if (typeof onSend === "function") {
        // allow parent to handle broadcasting/persisting; await if returns a promise
        await onSend(replyObj);
      }
    } catch (e) {
      // best-effort: show error locally (we don't block the UI)
      console.warn("ReplyInThread: onSend failed", e);
      // leave the optimistic reply — parent is responsible for reconciling if needed
    } finally {
      setIsSending(false);
      try {
        inputRef.current && inputRef.current.focus();
      } catch (e) {}
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendClick();
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (onCancel) onCancel();
    }
  };

  const handleReplyTo = (r) => {
    setReplyTo(r);
    try {
      inputRef.current && inputRef.current.focus();
    } catch (e) {}
  };

  return (
    <div className="text-sm text-black">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex-shrink-0">
          <div
            className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center"
            aria-hidden="true"
          >
            {rootMessage?.from?.slice?.(0, 1) || "?"}
          </div>
        </div>

        <div className="flex-1">
          <div className="text-xs text-gray-400">Thread starter</div>
          <div className="mt-1 p-3 bg-white/10 rounded-xl">
            <div className="text-xs font-semibold text-blue-500">
              {rootMessage?.fromName || rootMessage?.from || "Unknown"}
            </div>
            <div className="text-sm mt-1 break-words">
              {rootMessage?.text || rootMessage?.fileName || "<media>"}
            </div>
          </div>
        </div>

        <div className="ml-3">
          <button
            onClick={() => {
              if (onCancel) onCancel();
            }}
            aria-label="Close thread"
            className="px-2 py-1 rounded-full bg-white/10 text-xs text-red-500"
          >
            Close
          </button>
        </div>
      </div>

      <div className="mb-3">
        <div className="text-xs text-gray-500 mb-2">Replies</div>

        <div
          className="max-h-48 overflow-auto space-y-2 p-2 rounded-lg bg-black/5"
          aria-live="polite"
        >
          {replies.length === 0 ? (
            <div className="text-xs text-gray-500">No replies yet — be the first.</div>
          ) : (
            replies.map((r) => (
              <div
                key={r.id}
                className="p-2 rounded-lg bg-white/90 text-black"
                role="article"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold">
                    {r.fromName || r.from}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    {new Date(r.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </div>
                </div>
                {r.replyTo && (
                  <div className="mt-1 text-[11px] text-gray-600 p-2 bg-white/20 rounded">
                    <strong className="text-[11px] text-blue-400">Reply to {r.replyTo.from}:</strong>{" "}
                    <span className="break-words">{r.replyTo.text}</span>
                  </div>
                )}
                <div className="mt-2 text-sm break-words">{r.text}</div>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => handleReplyTo(r)}
                    className="text-xs px-2 py-1 rounded bg-white/10"
                  >
                    Reply
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-2">
        {replyTo && (
          <div className="mb-2 p-2 rounded bg-white/10 flex items-center justify-between">
            <div className="text-xs">
              Replying to <strong>{replyTo.from}</strong>:{" "}
              <span className="text-xs text-gray-200">
                {replyTo.text?.slice?.(0, 80)}
                {replyTo.text && replyTo.text.length > 80 ? "…" : ""}
              </span>
            </div>
            <button
              onClick={() => setReplyTo(null)}
              className="text-xs text-red-500 ml-2"
            >
              x
            </button>
          </div>
        )}

        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Write a reply… (Enter to send, Shift+Enter for newline)"
            className="flex-1 p-3 rounded-lg bg-white/100 border border-white/10 focus:outline-none focus:ring-1 focus:ring-blue-400"
            aria-label="Thread reply input"
          />

          <div className="flex flex-col gap-2">
            <button
              onClick={handleSendClick}
              disabled={!replyText.trim() || isSending}
              className="px-3 py-2 rounded bg-gradient-to-br from-green-500 to-green-600 text-white disabled:opacity-60"
            >
              {isSending ? "Sending…" : "Send"}
            </button>
            <button
              onClick={() => {
                setReplyText("");
                setReplyTo(null);
              }}
              className="px-3 py-1 rounded bg-white/10 text-xs"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-2 text-[11px] text-gray-500">
          Tip: long-press a message in the main chat to open thread composer.
        </div>
      </div>
    </div>
  );
}

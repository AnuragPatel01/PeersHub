// src/CircularStream.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * CircularStream — responsive recording UI with enhanced design
 *
 * Props:
 * - onFileRecorded(file: File) => Promise|void   // called when user confirms Send
 * - buttonClassName: string (optional)           // small launcher styling override
 */
export default function CircularStream({
  onFileRecorded,
  buttonClassName = "",
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [facingMode, setFacingMode] = useState("user"); // 'user' | 'environment'
  const [error, setError] = useState(null);

  // recorded preview
  const [recordedBlob, setRecordedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [durationMs, setDurationMs] = useState(0);
  const durationRef = useRef(0);
  const timerTickRef = useRef(null);

  // sending state
  const [sending, setSending] = useState(false);

  // Responsive preview sizing
  const PREVIEW_SIZE = "w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80";
  const PREVIEW_WRAPPER_CLASS = `rounded-full overflow-hidden bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 backdrop-blur-sm border-2 border-white/20 p-2 flex items-center justify-center shadow-2xl`;

  // start camera preview
  const startPreview = async () => {
    setError(null);
    try {
      const constraints = {
        video: {
          facingMode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      };
      const s = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = s;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = s;
        } catch (e) {
          // old browsers fallback
          videoRef.current.src = window.URL.createObjectURL(s);
        }
      }
    } catch (e) {
      console.warn("CircularStream: camera preview failed", e);
      setError(e.message || String(e));
    }
  };

  const stopPreview = () => {
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = null;
          videoRef.current.pause && videoRef.current.pause();
        } catch (e) {}
      }
    } catch (e) {
      console.warn("stopPreview failed", e);
    }
  };

  useEffect(() => {
    if (!open) return;
    // if user already previewed a recorded blob, don't auto-start camera
    if (!recordedBlob) startPreview();
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  const toggleFacing = () =>
    setFacingMode((f) => (f === "user" ? "environment" : "user"));

  const startRecording = () => {
    if (!streamRef.current) {
      setError("Camera not ready");
      return;
    }
    recordedChunksRef.current = [];
    durationRef.current = 0;
    setDurationMs(0);
    try {
      const options = { mimeType: "video/webm;codecs=vp8,opus" };
      const mr = new MediaRecorder(streamRef.current, options);
      recorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0)
          recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        // assemble quickly and present preview immediately (no heavy processing)
        try {
          const blob = new Blob(recordedChunksRef.current, {
            type: "video/webm",
          });

          // Stop preview camera immediately (we don't need it while previewing)
          stopPreview();

          // Clear any previous preview URL
          if (previewUrl) {
            try {
              URL.revokeObjectURL(previewUrl);
            } catch (e) {}
          }

          // set states quickly so preview shows instantly
          setRecordedBlob(blob);
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);

          // recording ended — stop timer & update UI flags
          setRecording(false);
          if (timerTickRef.current) {
            clearInterval(timerTickRef.current);
            timerTickRef.current = null;
          }
          setError(null);
        } catch (e) {
          console.warn("Error while finishing recording", e);
          setError("Failed to finalize recording");
          setRecording(false);
        }
      };

      mr.start(100);
      setRecording(true);

      // start timer tick
      if (timerTickRef.current) clearInterval(timerTickRef.current);
      timerTickRef.current = setInterval(() => {
        durationRef.current += 100;
        setDurationMs(durationRef.current);
      }, 100);
    } catch (e) {
      console.warn("startRecording failed", e);
      setError(e.message || String(e));
    }
  };

  const stopRecording = () => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      } else {
        // Defensive: ensure UI state is consistent
        setRecording(false);
        if (timerTickRef.current) {
          clearInterval(timerTickRef.current);
          timerTickRef.current = null;
        }
      }
    } catch (e) {
      console.warn("stopRecording failed", e);
      setRecording(false);
      if (timerTickRef.current) {
        clearInterval(timerTickRef.current);
        timerTickRef.current = null;
      }
    }
  };

  const handleOpen = () => {
    setRecordedBlob(null);
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (e) {}
      setPreviewUrl(null);
    }
    setError(null);
    setOpen(true);
  };

  const handleClose = () => {
    try {
      if (recording) stopRecording();
    } catch (e) {}
    setOpen(false);
    setRecording(false);
    setRecordedBlob(null);
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (e) {}
      setPreviewUrl(null);
    }
    stopPreview();
    if (timerTickRef.current) clearInterval(timerTickRef.current);
    timerTickRef.current = null;
    setDurationMs(0);
    setSending(false);
    setError(null);
  };

  const formatDuration = (ms) => {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const handleSend = async () => {
    if (!recordedBlob) return;
    setSending(true);
    try {
      // Append a tiny hint so parent can detect front-camera/mirrored if desired.
      // (optional — safe to remove if you don't want name changes.)
      const nameBase = `video-message-${Date.now()}`;
      const name =
        facingMode === "user"
          ? `${nameBase}.mirrored.webm`
          : `${nameBase}.webm`;
      const suffix = facingMode === "user" ? ".mirrored.webm" : ".webm";
      const file = new File(
        [recordedBlob],
        `video-message-${Date.now()}${suffix}`,
        { type: "video/webm" }
      );

      await (onFileRecorded ? onFileRecorded(file) : Promise.resolve());
      handleClose();
    } catch (e) {
      console.warn("handleSend failed", e);
      setError(e.message || String(e));
      setSending(false);
    }
  };

  const handleRetake = () => {
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (e) {}
    }
    setPreviewUrl(null);
    setRecordedBlob(null);
    setDurationMs(0);
    // resume camera preview for retake
    startPreview();
  };

  return (
    <>
      {/* Enhanced Launcher button */}
      <button
        onClick={handleOpen}
        title="Record video message"
        className={`group relative p-3 rounded-full hover:scale-110 active:scale-95 transition-all duration-200 shadow-lg bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white hover:shadow-xl ${buttonClassName}`}
        aria-label="Record video message"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          className="relative z-10"
        >
          <path
            d="M23 7l-7 5V8.5a2.5 2.5 0 00-2.5-2.5h-9A2 2 0 002 8v8a2 2 0 002 2h9A2.5 2.5 0 0017 15.5V12l7 5V7z"
            fill="currentColor"
          />
        </svg>
      </button>

      {/* Enhanced Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Enhanced backdrop with blur */}
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md transition-all duration-300"
            onClick={handleClose}
          />

          <div className="relative z-10 w-full max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gradient-to-br from-white/10 to-white/5 rounded-3xl p-6 shadow-2xl border border-white/10 backdrop-blur-xl">
              {/* Header with improved spacing and typography */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <h3 className="text-lg font-bold text-white">
                      Record Video
                    </h3>
                  </div>
                  <div className="px-3 py-1 rounded-full bg-white/10 text-xs font-medium text-white/80">
                    {facingMode === "user" ? "Front" : "Back"} Camera
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="px-3 py-1 rounded-full bg-gradient-to-r from-indigo-500/20 to-purple-500/20 border border-white/20 text-sm font-mono text-white min-w-[60px] text-center">
                    {formatDuration(durationMs)}
                  </div>
                  <button
                    onClick={handleClose}
                    aria-label="Close"
                    title="Close"
                    className="p-2 rounded-full bg-gradient-to-r from-red-500 to-red-600 hover:bg-white/20 text-white "
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>

              {/* Enhanced circular preview */}
              <div className="flex flex-col items-center gap-6">
                <div
                  className={`${PREVIEW_WRAPPER_CLASS} ${PREVIEW_SIZE} relative`}
                >
                  {!previewUrl ? (
                    <>
                      {/* LIVE CAMERA PREVIEW */}
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`w-full h-full rounded-full object-cover ${
                          facingMode === "user" ? "transform scale-x-[-1]" : ""
                        }`}
                      />
                      {recording && (
                        <div className="absolute inset-0 rounded-full border-4 border-red-500 animate-pulse" />
                      )}
                    </>
                  ) : (
                    <div className="relative w-full h-full rounded-full overflow-hidden">
                      <video
                        src={previewUrl}
                        playsInline
                        autoPlay
                        loop
                        muted
                        className={`w-full h-full rounded-full object-cover ${
                          facingMode === "user" ? "transform scale-x-[-1]" : ""
                        }`}
                      />
                      {/* Overlay play icon */}
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          className="w-12 h-12 text-white/80 drop-shadow-lg"
                          fill="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-green-400/50" />
                    </div>
                  )}
                </div>

                {/* Error display with better styling */}
                {error && (
                  <div className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm max-w-full text-center">
                    {error}
                  </div>
                )}

                {/* Enhanced controls */}
                <div className="flex items-center justify-center gap-4 w-full">
                  {!previewUrl ? (
                    <>
                      {/* Record/Stop button */}
                      <button
                        onClick={() =>
                          recording ? stopRecording() : startRecording()
                        }
                        className={`relative flex items-center gap-3 px-6 py-3 rounded-full text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 ${
                          recording
                            ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
                            : "bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600"
                        }`}
                        aria-pressed={recording}
                      >
                        <span
                          className={`w-3 h-3 rounded-full transition-all duration-200 ${
                            recording ? "bg-white animate-pulse" : "bg-white/80"
                          }`}
                        />
                        <span>
                          {recording ? "Stop Recording" : "Start Recording"}
                        </span>
                      </button>

                      {/* Camera flip button */}
                      <button
                        onClick={toggleFacing}
                        className="p-3 rounded-full bg-gradient-to-r from-green-500 to-green-600 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105"
                        title="Flip camera"
                        aria-label="Flip camera"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          width="20"
                          height="20"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M21 2l-2 2m-7.61 2.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 8l-3-3m-3.5 3.5L19 5" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      {/* Retake button */}
                      <button
                        onClick={handleRetake}
                        className="px-6 py-3 rounded-full bg-gradient-to-r from-blue-500 to-blue-700 hover:bg-white/20 text-white font-medium border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105"
                      >
                        <svg
                          className="w-4 h-4 mr-2 inline"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                          />
                        </svg>
                        Retake
                      </button>

                      {/* Send button */}
                      <button
                        onClick={handleSend}
                        disabled={sending}
                        className="px-6 py-3 rounded-full bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 disabled:from-gray-500 disabled:to-gray-600 text-white font-semibold shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 disabled:scale-100 disabled:cursor-not-allowed"
                      >
                        {sending ? (
                          <div className="flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            Sending...
                          </div>
                        ) : (
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
                              />
                            </svg>
                            Send
                          </div>
                        )}
                      </button>
                    </>
                  )}
                </div>

                {/* Help text */}
                <div className="text-center">
                  <div className="text-xs text-white/60 max-w-xs">
                    {!previewUrl
                      ? recording
                        ? "Recording in progress. Tap 'Stop Recording' when finished."
                        : "Tap 'Start Recording' to begin. Your video will be saved as WebM format."
                      : "Review your recording and tap 'Send' to share, or 'Retake' to record again."}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

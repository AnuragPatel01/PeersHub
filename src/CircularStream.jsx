// src/components/CircularStream.jsx
import React, { useEffect, useRef, useState } from "react";

/**
 * CircularStream — responsive recording UI with canvas capture + seamless flip
 *
 * Props:
 * - onFileRecorded(file: File) => Promise|void   // called when user confirms Send
 * - buttonClassName: string (optional)           // small launcher styling override
 */
export default function CircularStream({
  onFileRecorded,
  buttonClassName = "",
}) {
  // visible preview element
  const videoRef = useRef(null);

  // hidden driver video that draw loop reads from (we replace this on flip)
  const renderVideoRef = useRef(null);

  // camera active MediaStream (tracks come from getUserMedia)
  const streamRef = useRef(null);

  // MediaRecorder for final assembly (records combined canvas+audio)
  const recorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // canvas capture pipeline
  const captureCanvasRef = useRef(null);
  const canvasStreamRef = useRef(null);
  const drawRafRef = useRef(null);

  // last ImageBitmap frame cache
  const lastFrameImageRef = useRef(null);

  // capture mirror flag -> reflects whether the canvas is currently drawing mirrored frames
  const captureMirrorRef = useRef(false);

  // public state
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [facingMode, setFacingMode] = useState("user"); // UI-facing label
  const [error, setError] = useState(null);

  const [recordedBlob, setRecordedBlob] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [durationMs, setDurationMs] = useState(0);
  const durationRef = useRef(0);
  const timerTickRef = useRef(null);
  const [sending, setSending] = useState(false);

  // crossfade state used during flips
  const [isCrossfading, setIsCrossfading] = useState(false);

  // small helper constants for preview sizing / styling
  const PREVIEW_SIZE = "w-64 h-64 sm:w-72 sm:h-72 md:w-80 md:h-80";
  const PREVIEW_WRAPPER_CLASS = `rounded-full overflow-hidden bg-gradient-to-br from-indigo-500/20 via-purple-500/20 to-pink-500/20 backdrop-blur-sm border-2 border-white/20 p-2 flex items-center justify-center shadow-2xl`;

  // ---------------------------
  // Utility: start/stop preview (visible)
  // ---------------------------
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
      // stop previous stream if any (but do not touch recorder if recording is true - we won't call this while recording)
      if (streamRef.current) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
        } catch (e) {}
      }
      streamRef.current = s;
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = s;
        } catch (e) {
          videoRef.current.src = window.URL.createObjectURL(s);
        }
        try {
          await videoRef.current.play().catch(() => {});
        } catch (e) {}
      }
    } catch (e) {
      console.warn("CircularStream: camera preview failed", e);
      setError(e.message || String(e));
    }
  };

  const stopPreview = () => {
    try {
      if (videoRef.current) {
        try {
          videoRef.current.srcObject = null;
          videoRef.current.pause && videoRef.current.pause();
        } catch (e) {}
      }
      // we do NOT stop streamRef here if recording; only stop when closing while not recording or after recording ended.
      if (streamRef.current && !recording) {
        try {
          streamRef.current.getTracks().forEach((t) => t.stop());
          streamRef.current = null;
        } catch (e) {}
      }
    } catch (e) {
      console.warn("stopPreview failed", e);
    }
  };

  useEffect(() => {
    if (!open) return;
    // Start preview when opened (unless there's a recordedBlob/preview already)
    if (!recordedBlob) startPreview();
    return () => {
      // do not automatically stop preview here (closing will handle)
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // ---------------------------
  // Capture pipeline helpers
  // ensure hidden driver video + canvas exist in DOM (off-screen but renderable)
  // ---------------------------
  const ensureCapturePipeline = () => {
    // hidden driver video (we create only when needed)
    if (!renderVideoRef.current) {
      const v = document.createElement("video");
      v.playsInline = true;
      v.muted = true;
      v.autoplay = true;
      // keep it in DOM but offscreen so decoding continues
      v.style.position = "fixed";
      v.style.left = "-9999px";
      v.style.width = "1px";
      v.style.height = "1px";
      v.style.opacity = "0";
      v.style.pointerEvents = "none";
      renderVideoRef.current = v;
      document.body.appendChild(v);
    }

    // canvas used to capture frames (must be in DOM and renderable)
    if (!captureCanvasRef.current) {
      const c = document.createElement("canvas");
      c.style.position = "fixed";
      c.style.left = "-9999px";
      c.style.width = "160px";
      c.style.height = "90px";
      c.style.opacity = "0";
      c.style.pointerEvents = "none";
      captureCanvasRef.current = c;
      document.body.appendChild(c);
    }
  };

  // cleanup pipeline: remove hidden elements and imagebitmaps
  const cleanupCapturePipeline = () => {
    try {
      if (renderVideoRef.current) {
        try {
          renderVideoRef.current.pause();
          renderVideoRef.current.srcObject = null;
          if (renderVideoRef.current.parentNode)
            renderVideoRef.current.parentNode.removeChild(renderVideoRef.current);
        } catch (e) {}
        renderVideoRef.current = null;
      }
    } catch (e) {}

    try {
      if (captureCanvasRef.current) {
        if (captureCanvasRef.current.parentNode)
          captureCanvasRef.current.parentNode.removeChild(captureCanvasRef.current);
        captureCanvasRef.current = null;
      }
    } catch (e) {}

    try {
      if (lastFrameImageRef.current && lastFrameImageRef.current.close)
        lastFrameImageRef.current.close();
    } catch (e) {}
    lastFrameImageRef.current = null;
  };

  // ---------------------------
  // draw loop: copy frames from renderVideoRef.current into canvas
  // never clear canvas if driver not ready -> preserves last frame (prevents black)
  // uses captureMirrorRef to decide mirroring
  // ---------------------------
  const draw = () => {
    try {
      const canvas = captureCanvasRef.current;
      const ctx = canvas && canvas.getContext && canvas.getContext("2d");
      const driver = renderVideoRef.current;
      if (!ctx || !canvas) {
        drawRafRef.current = requestAnimationFrame(draw);
        return;
      }

      const hasDriverFrame =
        driver && driver.videoWidth > 0 && driver.videoHeight > 0 && !driver.paused && !driver.ended;

      if (hasDriverFrame) {
        // ensure canvas pixel size matches driver for best capture results (or you can scale down)
        if (canvas.width !== driver.videoWidth || canvas.height !== driver.videoHeight) {
          // you can reduce these numbers for performance (e.g., 640x360)
          canvas.width = driver.videoWidth;
          canvas.height = driver.videoHeight;
        }
        try {
          ctx.save();
          if (captureMirrorRef.current) {
            ctx.translate(canvas.width, 0);
            ctx.scale(-1, 1);
          }
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(driver, 0, 0, canvas.width, canvas.height);
          ctx.restore();
        } catch (e) {
          // ignore drawing errors
        }

        // try to cache last frame as ImageBitmap for quick re-draw during swaps
        if (typeof createImageBitmap === "function") {
          try {
            createImageBitmap(canvas)
              .then((bmp) => {
                try {
                  const prev = lastFrameImageRef.current;
                  if (prev && prev.close) prev.close();
                } catch (e) {}
                lastFrameImageRef.current = bmp;
              })
              .catch(() => {});
          } catch (e) {
            // ignore
          }
        }
      } else {
        // draw last known frame if available, else do nothing (preserve canvas contents)
        const bmp = lastFrameImageRef.current;
        if (bmp) {
          try {
            if (!canvas.width || !canvas.height) {
              canvas.width = bmp.width || 640;
              canvas.height = bmp.height || 360;
            }
            ctx.save();
            if (captureMirrorRef.current) {
              ctx.translate(canvas.width, 0);
              ctx.scale(-1, 1);
            }
            ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
            ctx.restore();
          } catch (e) {
            // ignore
          }
        } else {
          // no last frame; preserve existing canvas pixels (do nothing)
        }
      }
    } catch (e) {
      // swallow
    }
    drawRafRef.current = requestAnimationFrame(draw);
  };

  // ---------------------------
  // helper to wait for a video element to actually produce a decoded frame
  // ---------------------------
  const waitForVideoFrame = (videoEl, timeout = 2000) =>
    new Promise((resolve) => {
      if (!videoEl) return resolve(false);
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(Boolean(ok));
      };
      const onCanPlay = () => {
        setTimeout(() => {
          if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) done(true);
          else done(false);
        }, 80);
      };
      const onPlaying = () => done(true);
      const onError = () => done(false);
      const cleanup = () => {
        videoEl.removeEventListener("playing", onPlaying);
        videoEl.removeEventListener("canplay", onCanPlay);
        videoEl.removeEventListener("error", onError);
      };
      videoEl.addEventListener("playing", onPlaying);
      videoEl.addEventListener("canplay", onCanPlay);
      videoEl.addEventListener("error", onError);

      if (videoEl.requestVideoFrameCallback) {
        try {
          let called = false;
          const cb = () => {
            if (called) return;
            called = true;
            done(true);
          };
          videoEl.requestVideoFrameCallback(cb);
        } catch (e) {}
      }

      setTimeout(() => {
        if (!settled) {
          cleanup();
          resolve(videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
        }
      }, timeout);
    });

  // ---------------------------
  // start recording (canvas capture + audio tracks)
  // ---------------------------
  const startRecording = () => {
    if (!streamRef.current) {
      setError("Camera not ready");
      return;
    }
    recordedChunksRef.current = [];
    durationRef.current = 0;
    setDurationMs(0);

    try {
      ensureCapturePipeline();

      // attach current camera stream to hidden driver so draw loop can read frames
      // NOTE: we do not replace streamRef.current here, we just set driver.srcObject to current camera stream
      const driver = renderVideoRef.current;
      if (driver) {
        driver.srcObject = streamRef.current;
        driver.play().catch(() => {});
      }

      // set initial capture mirror based on current facingMode (this represents the camera we start from)
      captureMirrorRef.current = facingMode === "user";

      // start draw loop
      if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      drawRafRef.current = requestAnimationFrame(draw);

      // capture stream from canvas
      canvasStreamRef.current = captureCanvasRef.current.captureStream(30) || null; // target 30fps

      // combine canvas video track with audio tracks from camera stream
      const combined = new MediaStream();
      (canvasStreamRef.current?.getVideoTracks() || []).forEach((t) =>
        combined.addTrack(t)
      );
      (streamRef.current.getAudioTracks() || []).forEach((t) =>
        combined.addTrack(t)
      );

      const options = { mimeType: "video/webm;codecs=vp8,opus" };
      const mr = new MediaRecorder(combined, options);
      recorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        try {
          const blob = new Blob(recordedChunksRef.current, {
            type: "video/webm",
          });

          // stop preview camera (UX choice)
          try {
            if (videoRef.current) {
              videoRef.current.srcObject = null;
            }
          } catch (e) {}

          if (previewUrl) {
            try {
              URL.revokeObjectURL(previewUrl);
            } catch (e) {}
          }
          setRecordedBlob(blob);
          const url = URL.createObjectURL(blob);
          setPreviewUrl(url);

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
        } finally {
          // stop canvas stream tracks
          try {
            if (canvasStreamRef.current) {
              canvasStreamRef.current.getTracks().forEach((t) => t.stop());
              canvasStreamRef.current = null;
            }
          } catch (e) {}
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
      console.warn("startRecording (canvas) failed", e);
      setError(e.message || String(e));
    }
  };

  // ---------------------------
  // stop recording
  // ---------------------------
  const stopRecording = () => {
    try {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      } else {
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
    } finally {
      // stop draw loop
      try {
        if (drawRafRef.current) {
          cancelAnimationFrame(drawRafRef.current);
          drawRafRef.current = null;
        }
      } catch (e) {}
      // leave driver and canvas in DOM — we'll cleanup on close/retake
    }
  };

  // ---------------------------
  // Flip camera while recording or previewing
  // - we create a fresh driver <video> attached to a new getUserMedia stream
  // - wait for it to produce frames, only then swap driver used by draw loop
  // - update captureMirrorRef when swap occurs
  // - show a crossfade overlay while waiting
  // ---------------------------
  const handleFlipCamera = async () => {
    const next = facingMode === "user" ? "environment" : "user";
    console.debug("[flip] requested ->", next);

    try {
      // request new camera (video only)
      const constraints = {
        video: { facingMode: next, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      };
      const newCam = await navigator.mediaDevices.getUserMedia(constraints);
      if (!newCam) {
        console.warn("[flip] getUserMedia returned null");
        return;
      }
      console.debug("[flip] got newCam", newCam.getVideoTracks().map((t) => t.label || t.id));

      // create a new fresh hidden driver video element (avoid reusing old driver)
      const newDriver = document.createElement("video");
      newDriver.playsInline = true;
      newDriver.muted = true;
      newDriver.autoplay = true;
      Object.assign(newDriver.style, {
        position: "fixed",
        left: "-9999px",
        width: "1px",
        height: "1px",
        opacity: "0",
        pointerEvents: "none",
      });
      document.body.appendChild(newDriver);

      // attach stream and play
      newDriver.srcObject = newCam;
      try {
        await newDriver.play();
      } catch (e) {
        console.warn("[flip] newDriver.play() rejected", e);
      }

      // show crossfade overlay while waiting for frames
      setIsCrossfading(true);

      // wait for the new driver to produce at least one decoded frame
      const gotFrame = await waitForVideoFrame(newDriver, 2000);
      console.debug("[flip] newDriver gotFrame?", gotFrame, "videoW/H=", newDriver.videoWidth, newDriver.videoHeight);

      if (gotFrame) {
        // keep reference to old driver so we can remove it after swapping
        const oldDriver = renderVideoRef.current;

        // swap pointer used by draw loop
        renderVideoRef.current = newDriver;

        // update visible preview to show new camera (if you want preview to reflect the new cam)
        if (videoRef.current) {
          try {
            videoRef.current.srcObject = newCam;
            videoRef.current.play && videoRef.current.play().catch(() => {});
          } catch (e) {}
        }

        // update capture mirror flag so recorded frames are mirrored only when appropriate
        captureMirrorRef.current = next === "user";

        // update UI-facing facingMode too
        setFacingMode(next);

        // small delay then cleanup old driver and stop its tracks
        setTimeout(() => {
          try {
            if (oldDriver) {
              try {
                oldDriver.pause();
                oldDriver.srcObject = null;
                if (oldDriver.parentNode) oldDriver.parentNode.removeChild(oldDriver);
              } catch (e) {}
            }
            // stop any leftover tracks from previous camera (if they are no longer in streamRef)
            // Note: we don't stop streamRef.current here because it's used for audio and preview.
          } catch (e) {}
        }, 120);
      } else {
        // new driver produced no frames -> abort swap, cleanup new resources
        console.warn("[flip] new camera produced no frames; aborting swap");
        try {
          newCam.getTracks().forEach((t) => t.stop());
        } catch (e) {}
        try {
          if (newDriver.parentNode) newDriver.parentNode.removeChild(newDriver);
        } catch (e) {}
      }
    } catch (err) {
      console.warn("[flip] error", err);
    } finally {
      // hide crossfade after a little fade time
      setTimeout(() => setIsCrossfading(false), 300);
    }
  };

  // ---------------------------
  // Open / Close / Retake handlers
  // ---------------------------
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

  const handleRetake = () => {
    if (previewUrl) {
      try {
        URL.revokeObjectURL(previewUrl);
      } catch (e) {}
    }
    setPreviewUrl(null);
    setRecordedBlob(null);
    setDurationMs(0);

    // cleanup hidden pipeline so we can start fresh
    cleanupCapturePipeline();

    // resume camera preview for retake
    startPreview();
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

    // stop visible preview stream if present
    try {
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    } catch (e) {}

    // stop preview camera stream
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    } catch (e) {}

    if (timerTickRef.current) clearInterval(timerTickRef.current);
    timerTickRef.current = null;
    setDurationMs(0);
    setSending(false);
    setError(null);

    cleanupCapturePipeline();
  };

  // ---------------------------
  // Send recorded file
  // ---------------------------
  const handleSend = async () => {
    if (!recordedBlob) return;
    setSending(true);
    try {
      // Decide mirrored suffix based on the captureMirrorRef at the *start* of recording.
      // If you flipped mid-record, this will reflect the last state; more complex heuristics possible.
      const isMirrored = !!captureMirrorRef.current;
      const suffix = isMirrored ? ".mirrored.webm" : ".webm";
      const file = new File([recordedBlob], `video-message-${Date.now()}${suffix}`, {
        type: "video/webm",
      });

      await (onFileRecorded ? onFileRecorded(file) : Promise.resolve());
      handleClose();
    } catch (e) {
      console.warn("handleSend failed", e);
      setError(e.message || String(e));
      setSending(false);
    }
  };

  // ---------------------------
  // UI helpers
  // ---------------------------
  const formatDuration = (ms) => {
    const s = Math.floor(ms / 1000);
    const mm = String(Math.floor(s / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  };

  // ---------------------------
  // Cleanup on unmount
  // ---------------------------
  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== "inactive") {
          recorderRef.current.stop();
        }
      } catch (e) {}
      try {
        if (drawRafRef.current) cancelAnimationFrame(drawRafRef.current);
      } catch (e) {}
      try {
        if (canvasStreamRef.current) {
          canvasStreamRef.current.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {}
      try {
        if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      cleanupCapturePipeline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------
  // Render
  // ---------------------------
  return (
    <>
      {/* Launcher button */}
      <button
        onClick={handleOpen}
        title="Record video message"
        className={`group relative p-3 rounded-full hover:scale-110 active:scale-95 transition-all duration-200 shadow-lg bg-gradient-to-r from-gray-50 to-gray-50  text-white hover:shadow-xl ${buttonClassName}`}
        aria-label="Record video message"
      >
        <div className="absolute inset-0 rounded-full bg-gradient-to-r from-blue-400 to-blue-400  transition-opacity duration-200" />
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

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/70 backdrop-blur-md transition-all duration-300"
            onClick={handleClose}
          />

          <div className="relative z-10 w-full max-w-lg mx-auto animate-in fade-in slide-in-from-bottom-4 duration-300">
            <div className="bg-gradient-to-br from-white/10 to-white/5 rounded-3xl p-6 shadow-2xl border border-white/10 backdrop-blur-xl">
              {/* Header */}
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                    <h3 className="text-lg font-bold text-white">Record Video</h3>
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

              {/* Preview */}
              <div className="flex flex-col items-center gap-6">
                <div className={`${PREVIEW_WRAPPER_CLASS} ${PREVIEW_SIZE} relative`}>
                  {!previewUrl ? (
                    <>
                      <video
                        ref={videoRef}
                        autoPlay
                        muted
                        playsInline
                        className={`w-full h-full rounded-full object-cover ${captureMirrorRef.current ? "transform scale-x-[-1]" : ""}`}
                      />
                      {recording && <div className="absolute inset-0 rounded-full border-4 border-red-500 animate-pulse" />}
                    </>
                  ) : (
                    <div className="relative w-full h-full rounded-full overflow-hidden">
                      <video
                        src={previewUrl}
                        playsInline
                        autoPlay
                        loop
                        muted
                        className={`w-full h-full rounded-full object-cover ${captureMirrorRef.current ? "transform scale-x-[-1]" : ""}`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <svg xmlns="http://www.w3.org/2000/svg" className="w-12 h-12 text-white/80 drop-shadow-lg" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z" />
                        </svg>
                      </div>
                      <div className="absolute inset-0 rounded-full border-2 border-green-400/50" />
                    </div>
                  )}

                  {/* Crossfade overlay */}
                  <div
                    aria-hidden="true"
                    style={{
                      pointerEvents: "none",
                      position: "absolute",
                      inset: 0,
                      borderRadius: "9999px",
                      background: "linear-gradient(90deg, rgba(255,255,255,0.06), rgba(255,255,255,0.02))",
                      opacity: isCrossfading ? 1 : 0,
                      transition: "opacity 260ms ease",
                      mixBlendMode: "screen",
                    }}
                  />
                </div>

                {/* Error */}
                {error && (
                  <div className="px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/30 text-red-300 text-sm max-w-full text-center">
                    {error}
                  </div>
                )}

                {/* Controls */}
                <div className="flex items-center justify-center gap-4 w-full">
                  {!previewUrl ? (
                    <>
                      <button
                        onClick={() => (recording ? stopRecording() : startRecording())}
                        className={`relative flex items-center gap-3 px-6 py-3 rounded-full text-sm font-semibold text-white shadow-lg transition-all duration-200 hover:scale-105 active:scale-95 ${
                          recording
                            ? "bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700"
                            : "bg-gradient-to-r from-red-500 to-pink-500 hover:from-red-600 hover:to-pink-600"
                        }`}
                        aria-pressed={recording}
                      >
                        <span className={`w-3 h-3 rounded-full transition-all duration-200 ${recording ? "bg-white animate-pulse" : "bg-white/80"}`} />
                        <span>{recording ? "Stop Recording" : "Start Recording"}</span>
                      </button>

                      <button
                        onClick={handleFlipCamera}
                        className="p-3 rounded-full bg-gradient-to-r from-green-500 to-green-600 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105"
                        title="Flip camera"
                        aria-label="Flip camera"
                      >
                        <svg className="w-4 h-4 mr-2 inline" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Flip
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        onClick={handleRetake}
                        className="px-6 py-3 rounded-full bg-gradient-to-r from-blue-500 to-blue-700 hover:bg-white/20 text-white font-medium border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105"
                      >
                        Retake
                      </button>

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
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                            </svg>
                            Send
                          </div>
                        )}
                      </button>
                    </>
                  )}
                </div>

                <div className="text-center">
                  <div className="text-xs text-white/60 max-w-xs">
                    {!previewUrl ? (recording ? "Recording in progress. Tap 'Stop Recording' when finished." : "Tap 'Start Recording' to begin. Your video will be saved as WebM format.") : "Review your recording and tap 'Send' to share, or 'Retake' to record again."}
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

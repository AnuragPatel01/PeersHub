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

  const renderVideoRef = useRef(null); // hidden driver video element (we'll create it)
  const captureCanvasRef = useRef(null);
  const drawRafRef = useRef(null);
  const canvasStreamRef = useRef(null);

  const lastFrameImageRef = useRef(null); // stores ImageBitmap of last good frame
  const waitingForNewCameraRef = useRef(false);

  // --- Add helper to ensure driver video and canvas exist ---

  const ensureCapturePipeline = () => {
    // create driver video that will hold the camera stream (hidden but kept in DOM so decoding happens)
    if (!renderVideoRef.current) {
      const v = document.createElement("video");
      v.playsInline = true;
      v.muted = true;
      v.autoplay = true;
      // keep it in DOM but offscreen + invisible so browsers keep decoding
      v.style.position = "fixed";
      v.style.left = "-9999px";
      v.style.width = "1px";
      v.style.height = "1px";
      v.style.opacity = "0";
      v.style.pointerEvents = "none";
      renderVideoRef.current = v;
      document.body.appendChild(v);
    }

    // create an in-DOM canvas used for capture (must NOT be display:none)
    if (!captureCanvasRef.current) {
      const c = document.createElement("canvas");
      // keep it offscreen but renderable
      c.style.position = "fixed";
      c.style.left = "-9999px";
      c.style.width = "160px"; // CSS size (we use .width/.height for actual pixel size)
      c.style.height = "90px";
      c.style.opacity = "0";
      c.style.pointerEvents = "none";
      captureCanvasRef.current = c;
      document.body.appendChild(c);
    }
  };

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
      // If we already have a previous streamRef (e.g. switching while not recording), stop it cleanly
      if (streamRef.current) {
        try {
          streamRef.current.getVideoTracks().forEach((t) => t.stop());
        } catch (e) {}
      }
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

  // inside CircularStream component, after stopRecording or near handleClose

  const cleanupCapturePipeline = () => {
    try {
      if (renderVideoRef.current) {
        try {
          renderVideoRef.current.pause();
          renderVideoRef.current.srcObject = null;
          if (renderVideoRef.current.parentNode)
            renderVideoRef.current.parentNode.removeChild(
              renderVideoRef.current
            );
        } catch (e) {}
        renderVideoRef.current = null;
      }
    } catch (e) {}

    try {
      if (captureCanvasRef.current) {
        if (captureCanvasRef.current.parentNode)
          captureCanvasRef.current.parentNode.removeChild(
            captureCanvasRef.current
          );
        captureCanvasRef.current = null;
      }
    } catch (e) {}

    try {
      if (lastFrameImageRef.current && lastFrameImageRef.current.close)
        lastFrameImageRef.current.close();
    } catch (e) {}
    lastFrameImageRef.current = null;
  };

  useEffect(() => {
    if (!open) return;
    // if user already previewed a recorded blob, don't auto-start camera
    if (!recordedBlob) startPreview();
    return () => stopPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facingMode]);

  // --- New: replace video track seamlessly while recording ---
  // This attempts to acquire a new video track with the requested facingMode
  // and swap it into the existing MediaStream so MediaRecorder keeps recording.

  const waitForDriverPlaying = (driver, timeout = 1200) =>
    new Promise((resolve) => {
      if (!driver) return resolve(false);
      if (driver.readyState >= 3 && !driver.paused && !driver.ended)
        return resolve(true);

      let settled = false;
      const onPlaying = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(true);
      };
      const onError = () => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(false);
      };
      const cleanup = () => {
        driver.removeEventListener("playing", onPlaying);
        driver.removeEventListener("canplay", onPlaying);
        driver.removeEventListener("error", onError);
      };
      driver.addEventListener("playing", onPlaying);
      driver.addEventListener("canplay", onPlaying);
      driver.addEventListener("error", onError);

      // fallback timeout
      setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        // If readyState is still low we consider it failed
        resolve(driver.readyState >= 2);
      }, timeout);
    });

  const replaceVideoTrack = async (newFacing) => {
    try {
      if (!streamRef.current) {
        setFacingMode(newFacing);
        await startPreview();
        return;
      }

      // Start waiting mode so draw loop will use last frame
      waitingForNewCameraRef.current = true;

      // Acquire new video-only stream
      const constraints = {
        video: {
          facingMode: newFacing,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };
      const tmpStream = await navigator.mediaDevices.getUserMedia(constraints);
      const newVideoTrack = tmpStream.getVideoTracks()[0];
      if (!newVideoTrack) {
        tmpStream.getTracks().forEach((t) => t.stop());
        waitingForNewCameraRef.current = false;
        return;
      }

      // Keep reference to old video tracks
      const oldVideoTracks = streamRef.current.getVideoTracks();

      // Add newVideoTrack to existing streamRef (so MediaRecorder unaffected)
      try {
        streamRef.current.addTrack(newVideoTrack);
      } catch (e) {
        console.warn("addTrack threw", e);
      }

      // Attach the updated stream to hidden driver and visible preview
      if (renderVideoRef.current) {
        renderVideoRef.current.srcObject = streamRef.current;
        // attempt to play (some browsers require user gesture; ignore errors)
        renderVideoRef.current.play().catch(() => {});
      }
      if (videoRef.current) {
        videoRef.current.srcObject = streamRef.current;
        videoRef.current.play().catch(() => {});
      }

      // Wait for the driver to produce frames
      const ok = await waitForDriverPlaying(renderVideoRef.current, 1500);

      if (!ok) {
        // if driver couldn't start quickly, fall back to short delay, but still proceed
        await new Promise((r) => setTimeout(r, 200));
      }

      // Now it's safe to remove old video tracks from the stream (and stop them)
      for (const t of oldVideoTracks) {
        try {
          streamRef.current.removeTrack(t);
        } catch (e) {}
      }
      // stop old tracks after very small delay to be extra-safe
      setTimeout(() => {
        try {
          for (const t of oldVideoTracks) {
            try {
              t.stop();
            } catch (e) {}
          }
        } catch (e) {}
      }, 80);

      // cleanup temporary getUserMedia audio tracks (if present on tmpStream)
      try {
        tmpStream.getAudioTracks().forEach((t) => t.stop());
      } catch (e) {}

      // done waiting — resume drawing from driver frames
      waitingForNewCameraRef.current = false;
      setFacingMode(newFacing);
    } catch (e) {
      console.warn("replaceVideoTrack failed", e);
      waitingForNewCameraRef.current = false;
      setError(e.message || String(e));
    }
  };
  // wait up to timeout ms for the <video> to have at least one decoded frame
  const waitForVideoFrame = (videoEl, timeout = 2000) =>
    new Promise((resolve) => {
      if (!videoEl) return resolve(false);
      // If browser exposes getVideoPlaybackQuality / requestVideoFrameCallback we can detect frames
      let settled = false;
      const done = (ok) => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(Boolean(ok));
      };
      const onCanPlay = () => {
        // some browsers show canplay before decoded frame; give a short tick
        setTimeout(() => {
          // if we have width/height, likely a decoded frame is available
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

      // If requestVideoFrameCallback available, that's best
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

      // fallback timeout
      setTimeout(() => {
        if (!settled) {
          cleanup();
          // consider it failed if no dimensions
          resolve(videoEl.videoWidth > 0 && videoEl.videoHeight > 0);
        }
      }, timeout);
    });

  const handleFlipCamera = async () => {
    const next = facingMode === "user" ? "environment" : "user";
    console.debug("[flip] requested ->", next);

    try {
      // get a fresh camera stream for the new facing mode (video only)
      const constraints = {
        video: {
          facingMode: next,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      const newCam = await navigator.mediaDevices.getUserMedia(constraints);
      if (!newCam) {
        console.warn("[flip] getUserMedia returned null");
        return;
      }
      console.debug(
        "[flip] got newCam",
        newCam.getVideoTracks().map((t) => t.label || t.id)
      );

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

      // point the driver at the newly acquired camera stream
      newDriver.srcObject = newCam;
      try {
        await newDriver.play();
      } catch (e) {
        // play() might be rejected due to autoplay policies, but since it's muted it usually works
        console.warn("[flip] newDriver.play() rejected", e);
      }

      // Wait until we actually have a decoded frame (or timeout)
      const gotFrame = await waitForVideoFrame(newDriver, 1800);
      console.debug(
        "[flip] newDriver gotFrame?",
        gotFrame,
        "videoW/H=",
        newDriver.videoWidth,
        newDriver.videoHeight
      );

      // If driver produced frames, swap it in for the canvas draw source
      if (gotFrame) {
        // keep reference to old driver so we can remove it after swapping
        const oldDriver = renderVideoRef.current;

        // swap pointers (the draw loop reads renderVideoRef.current)
        renderVideoRef.current = newDriver;

        // update visible preview if you also use videoRef for visible preview
        if (videoRef.current) {
          // we *do not* change streamRef.current here (recorder stream) - just change visible preview
          videoRef.current.srcObject = newCam;
          try {
            videoRef.current.play().catch(() => {});
          } catch (e) {}
        }

        // update facingMode for UI
        setFacingMode(next);

        // stop and remove old driver after a small delay to be safe
        setTimeout(() => {
          try {
            if (oldDriver) {
              oldDriver.pause();
              oldDriver.srcObject = null;
              if (oldDriver.parentNode)
                oldDriver.parentNode.removeChild(oldDriver);
            }
          } catch (e) {}
        }, 120);
      } else {
        // no frames -> newCam couldn't decode/produce frames for some reason
        // fallback: keep using previous driver (do not swap), and stop newCam to avoid leaks
        console.warn("[flip] new camera produced no frames; aborting swap");
        try {
          newCam.getTracks().forEach((t) => t.stop());
        } catch (e) {}
        // remove the newDriver element
        try {
          if (newDriver.parentNode) newDriver.parentNode.removeChild(newDriver);
        } catch (e) {}
        return;
      }

      // IMPORTANT: We stopped using newCam as the camera for recorder's audio/video.
      // If you want audio from the flipped camera included you should swap audio tracks
      // into the recorder's combined stream — do that carefully (may need small delay).
      // For now we focused on getting video frames into the canvas.
    } catch (err) {
      console.warn("[flip] error", err);
    }
  };

  // --- Replace startRecording with this (records canvas + audio) ---
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

      // set driver video srcObject to the current camera stream (so it decodes frames)
      const driver = renderVideoRef.current;
      driver.srcObject = streamRef.current;
      driver.play().catch(() => {});

      // set canvas size to match incoming video (use small wait for metadata)
      const setupCanvas = () => {
        try {
          const w = driver.videoWidth || 1280;
          const h = driver.videoHeight || 720;
          const canvas = captureCanvasRef.current;
          canvas.width = w;
          canvas.height = h;
        } catch (e) {}
      };

      if (driver.readyState >= 1) {
        setupCanvas();
      } else {
        driver.onloadedmetadata = () => {
          setupCanvas();
        };
      }

      // draw loop: copy frames from driver video into canvas (mirror if front camera)

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
            driver &&
            driver.videoWidth > 0 &&
            driver.videoHeight > 0 &&
            !driver.paused &&
            !driver.ended;

          if (hasDriverFrame && !waitingForNewCameraRef.current) {
            // When the driver is ready and we're not waiting for a new camera, draw normally.
            try {
              // If canvas pixel size doesn't match driver, resize it (keeps captureStream stable)
              if (
                canvas.width !== driver.videoWidth ||
                canvas.height !== driver.videoHeight
              ) {
                // pick a capture resolution you want — match driver for best quality
                canvas.width = driver.videoWidth;
                canvas.height = driver.videoHeight;
              }

              ctx.save();
              if (facingMode === "user") {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
              }
              ctx.drawImage(driver, 0, 0, canvas.width, canvas.height);
              ctx.restore();

              // store last frame as ImageBitmap for quick redraw if new camera not ready
              if (typeof createImageBitmap === "function") {
                // do not await here to avoid blocking; promise will set bitmap when ready
                createImageBitmap(canvas)
                  .then((bmp) => {
                    try {
                      const prev = lastFrameImageRef.current;
                      if (prev && prev.close) prev.close();
                    } catch (e) {}
                    lastFrameImageRef.current = bmp;
                  })
                  .catch(() => {});
              }
            } catch (e) {
              // ignore transient draw errors
            }
          } else {
            // driver not ready: draw last frame (ImageBitmap) if available; else don't clear canvas
            const bmp = lastFrameImageRef.current;
            if (bmp) {
              try {
                // ensure canvas has some pixel size (fallback to small size)
                if (!canvas.width || !canvas.height) {
                  canvas.width = bmp.width || 640;
                  canvas.height = bmp.height || 360;
                }
                ctx.save();
                if (facingMode === "user") {
                  ctx.translate(canvas.width, 0);
                  ctx.scale(-1, 1);
                }
                // drawImage of ImageBitmap preserves previous pixels quickly
                ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
                ctx.restore();
              } catch (e) {
                // fallback: do nothing (preserve existing canvas pixels)
              }
            } else {
              // no last frame — do nothing to avoid clearing the canvas (prevents black)
            }
          }
        } catch (e) {
          // swallow draw errors
        }
        drawRafRef.current = requestAnimationFrame(draw);
      };

      // start drawing immediately (it will no-op until metadata)
      drawRafRef.current = requestAnimationFrame(draw);

      // get a video stream from canvas
      canvasStreamRef.current =
        captureCanvasRef.current.captureStream(30) || null; // 30 fps target

      // combine canvas video track with audio tracks from camera stream
      const audioTracks = streamRef.current.getAudioTracks() || [];
      const combined = new MediaStream();
      // add canvas video tracks
      (canvasStreamRef.current?.getVideoTracks() || []).forEach((t) =>
        combined.addTrack(t)
      );
      // add audio tracks (from original camera)
      audioTracks.forEach((t) => combined.addTrack(t));

      // now create MediaRecorder on combined stream
      const options = { mimeType: "video/webm;codecs=vp8,opus" };
      const mr = new MediaRecorder(combined, options);
      recorderRef.current = mr;
      mr.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0)
          recordedChunksRef.current.push(ev.data);
      };
      mr.onstop = () => {
        // assemble blob and present preview (same as before)
        try {
          const blob = new Blob(recordedChunksRef.current, {
            type: "video/webm",
          });

          // NOTE: we DON'T call stopPreview here because we want to keep audio/video elements consistent.
          // However original code calls stopPreview() — keep same UX: stop camera preview
          stopPreview();

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

  // --- Replace stopRecording with this cleanup ---
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
      // stop the canvas draw loop
      try {
        if (drawRafRef.current) {
          cancelAnimationFrame(drawRafRef.current);
          drawRafRef.current = null;
        }
      } catch (e) {}
      // stop canvas stream tracks (if any)
      try {
        if (canvasStreamRef.current) {
          canvasStreamRef.current.getTracks().forEach((t) => t.stop());
          canvasStreamRef.current = null;
        }
      } catch (e) {}
      // leave driver video attached to streamRef (do not destroy the camera stream)
      // but we can remove the hidden elements if we want on final close
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

    // 🔑 clean up hidden driver video + canvas
    cleanupCapturePipeline();
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

    cleanupCapturePipeline(); // 🔑 here

    // resume camera preview for retake
    startPreview();
  };

  return (
    <>
      {/* Enhanced Launcher button */}
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

                      {/* Camera flip button (UPDATED) */}
                      <button
                        onClick={handleFlipCamera}
                        className="p-3 rounded-full bg-gradient-to-r from-green-500 to-green-600 hover:bg-white/20 text-white border border-white/20 hover:border-white/30 transition-all duration-200 hover:scale-105"
                        title="Flip camera"
                        aria-label="Flip camera"
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
                        Flip
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

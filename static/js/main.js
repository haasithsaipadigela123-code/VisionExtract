/* =========================================================================
   Vision Extract — Swiss Architectural Broadside Logic
   - In-browser Tesseract.js WASM OCR
   - Airgapped local runtime
   - Sampling Interval selection directly below upload bar
   - Live frame reel buffer filmstrip
   - Telemetry sync with Masthead
   - Animated counter matrix grid
   - Razor table with confidence visualizers and 1-click clipboard
   - Web Audio chime + Toast alerts + Full keyboard shortcuts
   ========================================================================= */

(function () {
  "use strict";

  var IMAGE_RE = /\.(png|jpe?g|bmp|webp|tiff?)$/i;
  var VIDEO_RE = /\.(mp4|mov|avi|mkv|webm|mpeg|m4v|ogg)$/i;
  var MAX_FRAMES = 60;
  var TESS_POOL = 2;
  var CANCELLED = "__cancelled__";

  var el = function (id) { return document.getElementById(id); };


  /* ================= UPGRADE 1: TOAST NOTIFICATIONS ================= */
  function showToast(text, tag) {
    var box = el("toastBox");
    if (!box) return;
    var t = document.createElement("div");
    t.className = "toast-msg";
    t.innerHTML = '<span class="toast-tag">' + escapeHtml(tag || "SYSTEM") + "</span><span>" + escapeHtml(text) + "</span>";
    box.appendChild(t);
    setTimeout(function () {
      t.classList.add("out");
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 320);
    }, 2400);
  }

  /* ================= UPGRADE 9: MELODIC AUDIO CHIME & MUTE TOGGLE ================= */
  var soundEnabled = true;
  try {
    var sPref = localStorage.getItem("vde-sound");
    if (sPref !== null) soundEnabled = sPref === "true";
  } catch (e) {}

  var soundToggle = el("soundToggle");
  function updateSoundUI() {
    if (!soundToggle) return;
    soundToggle.textContent = soundEnabled ? "Sound: ON" : "Sound: MUTED";
    soundToggle.classList.toggle("active", soundEnabled);
    soundToggle.title = soundEnabled ? "Audio chime active (click to mute)" : "Audio chime muted (click to unmute)";
  }
  updateSoundUI();
  if (soundToggle) {
    soundToggle.addEventListener("click", function () {
      soundEnabled = !soundEnabled;
      try { localStorage.setItem("vde-sound", soundEnabled ? "true" : "false"); } catch (e) {}
      updateSoundUI();
      showToast(soundEnabled ? "Audio chime active" : "Audio chime muted", "SOUND");
      if (soundEnabled) playSuccessChime();
    });
  }

  function playSuccessChime() {
    if (!soundEnabled) return;
    try {
      var AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      var ctx = new AudioCtx();
      var notes = [587.33, 880, 1174.66]; // D5, A5, D6
      var now = ctx.currentTime;
      notes.forEach(function (freq, idx) {
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(freq, now + idx * 0.09);
        gain.gain.setValueAtTime(0, now + idx * 0.09);
        gain.gain.linearRampToValueAtTime(0.12, now + idx * 0.09 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.09 + 0.32);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now + idx * 0.09);
        osc.stop(now + idx * 0.09 + 0.35);
      });
    } catch (e) {}
  }

  /* ================= UPGRADE 2: ANIMATED NUMBER COUNTERS ================= */
  function animateNumber(element, target, duration) {
    var start = 0;
    var startTime = performance.now();
    duration = duration || 500;
    function step(currentTime) {
      var elapsed = currentTime - startTime;
      var progress = Math.min(elapsed / duration, 1);
      var ease = 1 - Math.pow(1 - progress, 3);
      var val = Math.round(start + (target - start) * ease);
      element.textContent = val < 10 ? "0" + val : "" + val;
      if (progress < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  /* ================= DOM ELEMENTS ================= */
  var dropzone = el("dropzone"), fileInput = el("fileInput");
  var dzTitle = el("dzTitle"), dzSub = el("dzSub");
  var fileMountedBadge = el("fileMountedBadge"), fileName = el("fileName"), fileSize = el("fileSize"), removeFile = el("removeFile");
  var fpsGrid = el("fpsGrid"), fpsDisplay = el("fpsDisplay"), startBtn = el("startBtn"), startBtnText = el("startBtnText");
  var progTrack = el("progTrack"), progBar = el("progBar"), progStatus = el("progStatus"), progLabel = el("progLabel"), progPct = el("progPct");
  var procStats = el("procStats"), statFrame = el("statFrame"), statProgress = el("statProgress"), statElapsed = el("statElapsed"), statEta = el("statEta"), cancelBtn = el("cancelBtn");
  var errorLine = el("errorLine"), errorBox = el("errorBox"), errorText = el("errorText"), tryAgainBtn = el("tryAgainBtn");

  var mastheadFrames = el("mastheadFrames"), mastheadEntities = el("mastheadEntities");
  var infoStrip = el("infoStrip"), isName = el("isName"), isSize = el("isSize"), isFps = el("isFps"), isFpsSep = el("isFpsSep"), newBtn = el("newBtn");

  var filmstripBox = el("filmstripBox"), filmstripTrack = el("filmstripTrack"), filmstripCount = el("filmstripCount");
  var dragOverlay = el("dragOverlay");
  var sessionBanner = el("sessionBanner");

  var ledgerSkeleton = el("ledgerSkeleton");
  var summaryCards = el("summaryCards");
  var searchEl = el("search"), minConfEl = el("minConf");
  var tableBody = el("tableBody"), emptyRow = el("emptyRow"), emptyLine = el("emptyLine");
  var tableCopyAll = el("tableCopyAll"), exportCsvBtn = el("exportCsvBtn"), exportJsonBtn = el("exportJsonBtn");
  var exportView = el("exportView");

  var selectedFile = null, selectedFPS = 2, aborted = false, startTime = 0;
  var workers = [];
  var state = { data: null, tab: "all", removed: {}, search: "", minConf: 0, sortField: "frame", sortDir: "asc" };

  var fpsLabels = {
    1: "1 FPS (Low Density)",
    2: "2 FPS (Nominal)",
    3: "3 FPS (High Density)",
    5: "5 FPS (Fast Motion)"
  };

  /* ================= FILE SELECTION ================= */
  function isSupported(n) { return IMAGE_RE.test(n) || VIDEO_RE.test(n); }
  function formatBytes(b) {
    if (!b) return "0 B";
    var k = 1024, u = ["B", "KB", "MB", "GB"], i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + " " + u[i];
  }

  function pickFile(file) {
    hideError();
    if (!file) return;
    if (!isSupported(file.name)) {
      showUploadError("Unsupported format. Drop an MP4/WebM/MOV video or JPG/PNG image.");
      return;
    }
    selectedFile = file;
    dzTitle.textContent = "Target: " + file.name;
    dzSub.innerHTML = formatBytes(file.size) + " · " + selectedFPS + " FPS sampled · Ready for extraction";
    fileMountedBadge.hidden = false;
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    if (sessionBanner) sessionBanner.hidden = true;
    if (startBtnText) startBtnText.textContent = "Execute Extraction (" + formatBytes(file.size) + ")";
    showToast("Mounted " + file.name, "MOUNTED");
  }

  function toIdle() {
    selectedFile = null;
    aborted = false;
    state = { data: null, tab: "all", removed: {}, search: "", minConf: 0, sortField: "frame", sortDir: "asc" };
    if (fileInput) fileInput.value = "";
    dzTitle.textContent = "Mount Target Media";
    dzSub.innerHTML = "Drop MP4, WebM, MOV or Image here<br/>Max payload limit: 500 MB";
    fileMountedBadge.hidden = true;
    if (startBtnText) startBtnText.textContent = "Execute Extraction";
    if (progTrack) progTrack.hidden = true;
    if (progStatus) progStatus.hidden = true;
    if (procStats) procStats.hidden = true;
    if (infoStrip) infoStrip.hidden = true;
    if (errorBox) errorBox.hidden = true;
    if (ledgerSkeleton) ledgerSkeleton.hidden = true;
    if (filmstripBox) { filmstripBox.hidden = true; filmstripTrack.innerHTML = ""; }
    if (mastheadFrames) mastheadFrames.textContent = "—";
    if (mastheadEntities) mastheadEntities.textContent = "—";
    hideError();
    releaseEngine().catch(function () {});
    renderDefaultCards();
    renderDefaultTable();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  dropzone.addEventListener("click", function (e) {
    if (e.target.closest("#removeFile")) return;
    fileInput.click();
  });
  dropzone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
  });
  fileInput.addEventListener("change", function (e) {
    if (e.target.files && e.target.files[0]) pickFile(e.target.files[0]);
  });
  removeFile.addEventListener("click", function (e) {
    e.stopPropagation();
    toIdle();
  });
  if (newBtn) newBtn.addEventListener("click", toIdle);
  if (tryAgainBtn) tryAgainBtn.addEventListener("click", toIdle);

  /* FPS rate selection */
  Array.prototype.forEach.call(fpsGrid.querySelectorAll(".rate-btn"), function (btn) {
    btn.addEventListener("click", function () {
      selectedFPS = parseInt(btn.getAttribute("data-fps"), 10) || 2;
      Array.prototype.forEach.call(fpsGrid.querySelectorAll(".rate-btn"), function (b) { b.classList.remove("active"); });
      btn.classList.add("active");
      if (fpsDisplay) fpsDisplay.textContent = fpsLabels[selectedFPS] || (selectedFPS + " FPS");
      if (selectedFile) dzSub.innerHTML = formatBytes(selectedFile.size) + " · " + selectedFPS + " FPS sampled · Ready for extraction";
      showToast("Sampling interval: " + selectedFPS + " FPS", "CONFIG");
    });
  });

  /* Execute button */
  startBtn.addEventListener("click", function () {
    if (!selectedFile) {
      fileInput.click();
      showToast("Select target media to execute extraction", "MOUNT");
      return;
    }
    runExtraction();
  });

  cancelBtn.addEventListener("click", function () {
    if (window.confirm("Stop forensic OCR extraction?")) {
      aborted = true;
      showToast("Extraction cancelled", "CANCEL");
    }
  });

  /* ================= FULL-SCREEN DRAG OVERLAY ================= */
  var dragCounter = 0;
  window.addEventListener("dragenter", function (e) {
    e.preventDefault();
    dragCounter++;
    if (dragOverlay && dragCounter === 1) dragOverlay.hidden = false;
  });
  window.addEventListener("dragleave", function (e) {
    e.preventDefault();
    dragCounter--;
    if (dragOverlay && dragCounter <= 0) {
      dragCounter = 0;
      dragOverlay.hidden = true;
    }
  });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) {
    e.preventDefault();
    dragCounter = 0;
    if (dragOverlay) dragOverlay.hidden = true;
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      pickFile(e.dataTransfer.files[0]);
    }
  });

  /* ================= KEYBOARD SHORTCUTS ================= */
  window.addEventListener("keydown", function (e) {
    var tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {
      if (e.key === "Escape") e.target.blur();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
      e.preventDefault();
      fileInput.click();
    } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
      if (selectedFile && progTrack.hidden) {
        e.preventDefault();
        runExtraction();
      }
    } else if (e.key === "Escape") {
      if (!progTrack.hidden) {
        e.preventDefault();
        if (window.confirm("Stop forensic OCR extraction?")) aborted = true;
      } else if (selectedFile) {
        toIdle();
      }
    }
  });

  /* ================= TABLE TOOLBAR ACTIONS ================= */
  if (tableCopyAll) {
    tableCopyAll.addEventListener("click", function () {
      var rows = tableItems();
      if (!rows.length) { showToast("No records to copy", "EMPTY"); return; }
      var text = rows.map(function (it) { return it.normalized; }).join("\n");
      copyText(text);
      showToast(rows.length + " values copied to clipboard", "COPIED");
    });
  }
  if (exportCsvBtn) {
    exportCsvBtn.addEventListener("click", function () {
      var items = tableItems();
      if (!items.length) { showToast("No records to export", "EMPTY"); return; }
      downloadCSV(items, "vision-extract.csv");
      showToast("Exported " + items.length + " items (CSV)", "CSV");
    });
  }
  if (exportJsonBtn) {
    exportJsonBtn.addEventListener("click", function () {
      var items = tableItems();
      if (!items.length) { showToast("No records to export", "EMPTY"); return; }
      exportJSON(items);
      showToast("Exported " + items.length + " items (JSON)", "JSON");
    });
  }

  searchEl.addEventListener("input", function () {
    state.search = searchEl.value;
    renderTable();
  });
  minConfEl.addEventListener("change", function () {
    state.minConf = Number(minConfEl.value) || 0;
    renderTable();
  });

  /* ================= TELEMETRY FORMATTERS ================= */
  function fmtElapsed(ms) {
    if (ms < 1000) return Math.round(ms) + "ms";
    if (ms < 60000) return (ms / 1000).toFixed(1) + "s";
    var m = Math.floor(ms / 60000), s = Math.floor((ms % 60000) / 1000);
    return m + "m " + s + "s";
  }

  function setPhase(title) {
    progLabel.textContent = title;
    progTrack.hidden = false;
    progStatus.hidden = false;
    procStats.hidden = false;
  }

  function updateProc(frameNo, done, total) {
    var pct = total ? Math.round((done / total) * 100) : 0;
    progBar.style.width = pct + "%";
    progPct.textContent = pct + "%";
    statFrame.textContent = "#" + frameNo;
    statProgress.textContent = done + " / " + total;
    if (mastheadFrames) mastheadFrames.textContent = "" + done;
    var elapsed = Date.now() - startTime;
    statElapsed.textContent = fmtElapsed(elapsed);
    statEta.textContent = (done > 0 && done < total) ? fmtElapsed((elapsed / done) * (total - done)) : "—";
  }

  function setComplete() {
    progBar.style.width = "100%";
    progPct.textContent = "100%";
    progLabel.textContent = "Extraction complete";
    setTimeout(function () {
      progTrack.hidden = true;
      progStatus.hidden = true;
      procStats.hidden = true;
    }, 1200);
    playSuccessChime();
  }

  /* ================= TESSERACT.JS OCR WORKERS ================= */
  async function ensureEngine() {
    if (workers.length) return;
    if (typeof Tesseract === "undefined") throw new Error("Tesseract.js OCR engine could not be loaded.");
    for (var i = 0; i < TESS_POOL; i++) {
      var w = await Tesseract.createWorker("eng");
      await w.setParameters({
        tessedit_char_whitelist: "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz@.:/-+_,#₹$()%|\\ "
      });
      workers.push(w);
    }
  }

  async function releaseEngine() {
    if (!workers.length) return;
    var list = workers; workers = [];
    for (var i = 0; i < list.length; i++) {
      try { await list[i].terminate(); } catch (e) {}
    }
  }

  /* ================= FRAME EXTRACTION ================= */
  function extractFrames(file, fps) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var video = document.createElement("video");
      video.muted = true; video.playsInline = true; video.preload = "auto"; video.src = url;

      var frames = [];
      var canvas = document.createElement("canvas");
      var ctx = canvas.getContext("2d", { willReadFrequently: true });
      var step = 1 / fps;
      var currentTime = 0;
      var frameCount = 0;

      if (filmstripBox) { filmstripBox.hidden = false; filmstripTrack.innerHTML = ""; }

      video.addEventListener("loadedmetadata", function () {
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        var duration = video.duration || 10;
        var totalExpected = Math.min(MAX_FRAMES, Math.max(1, Math.floor(duration * fps)));

        function captureNext() {
          if (aborted) { clean(); reject(new Error(CANCELLED)); return; }
          if (currentTime >= duration || frameCount >= MAX_FRAMES) {
            clean(); resolve(frames); return;
          }
          video.currentTime = currentTime;
        }

        video.addEventListener("seeked", function onSeeked() {
          if (aborted) { clean(); reject(new Error(CANCELLED)); return; }
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          var frameCanvas = document.createElement("canvas");
          frameCanvas.width = canvas.width; frameCanvas.height = canvas.height;
          frameCanvas.getContext("2d").drawImage(canvas, 0, 0);

          frameCount++;
          var snapData = { frameNumber: frameCount, timestamp: currentTime, canvas: frameCanvas };
          frames.push(snapData);

          // Add to filmstrip preview track
          if (filmstripTrack) {
            var thumb = document.createElement("div");
            thumb.className = "fs-frame";
            thumb.id = "fs-frame-" + frameCount;
            var thumbImg = document.createElement("img");
            thumbImg.src = frameCanvas.toDataURL("image/jpeg", 0.65);
            thumb.appendChild(thumbImg);
            var tag = document.createElement("span");
            tag.className = "fs-frame-tag";
            tag.textContent = "#" + frameCount;
            thumb.appendChild(tag);
            filmstripTrack.appendChild(thumb);
            filmstripCount.textContent = frameCount + " FRAMES";
          }

          currentTime += step;
          captureNext();
        });

        captureNext();
      });

      video.addEventListener("error", function () { clean(); reject(new Error("Unable to decode video format.")); });
      function clean() { URL.revokeObjectURL(url); video.remove(); }
    });
  }

  async function ocrFrames(frames) {
    var out = new Array(frames.length);
    var done = 0;
    var cursor = 0;

    async function runner(w) {
      while (cursor < frames.length) {
        if (aborted) break;
        var i = cursor++;
        var f = frames[i];
        try {
          var r = await w.recognize(f.canvas);
          var text = (r.data && r.data.text) || "";
          var conf = (r.data && r.data.confidence) || 0;
          out[i] = { frame: f.frameNumber, timestamp: f.timestamp, text: text, confidence: conf };

          if (text.trim().length > 3 && f.frameNumber) {
            var fEl = el("fs-frame-" + f.frameNumber);
            if (fEl && !fEl.classList.contains("has-hit")) {
              fEl.classList.add("has-hit");
              var hitTag = document.createElement("span");
              hitTag.className = "fs-hit-tag";
              hitTag.textContent = "HIT";
              fEl.appendChild(hitTag);
            }
          }
        } catch (e) {
          out[i] = { frame: f.frameNumber, timestamp: f.timestamp, text: "", confidence: 0 };
        }
        f.canvas.width = 0; f.canvas.height = 0;
        done++;
        updateProc(f.frameNumber, done, frames.length);
      }
    }

    await Promise.all(workers.map(runner));
    if (aborted) throw new Error(CANCELLED);
    return out.filter(Boolean);
  }

  async function ocrImage(file) {
    updateProc(1, 0, 1);
    var r = await workers[0].recognize(file);
    updateProc(1, 1, 1);
    return [{ frame: 1, timestamp: 0, text: (r.data && r.data.text) || "", confidence: (r.data && r.data.confidence) || 0 }];
  }

  /* ================= RUN EXTRACTION EXECUTION ================= */
  async function runExtraction() {
    if (!selectedFile) return;
    hideError();
    if (errorBox) errorBox.hidden = true;
    if (ledgerSkeleton) ledgerSkeleton.hidden = false;

    aborted = false;
    startTime = Date.now();
    progBar.style.width = "0%"; progPct.textContent = "0%";
    statFrame.textContent = "#0"; statProgress.textContent = "0 / 0"; statElapsed.textContent = "—"; statEta.textContent = "—";
    var isVideo = VIDEO_RE.test(selectedFile.name);

    try {
      setPhase("Loading WASM OCR engine…");
      await ensureEngine();
      if (aborted) throw new Error(CANCELLED);

      var frames;
      if (isVideo) {
        setPhase("Extracting frames at " + selectedFPS + " FPS…");
        var extracted = await extractFrames(selectedFile, selectedFPS);
        if (aborted) throw new Error(CANCELLED);
        if (!extracted.length) throw new Error("No readable frames could be decoded from this video.");
        setPhase("Scanning frames with Tesseract.js…");
        frames = await ocrFrames(extracted);
      } else {
        setPhase("Executing OCR on target image…");
        frames = await ocrImage(selectedFile);
      }
      if (aborted) throw new Error(CANCELLED);
      await releaseEngine();

      setPhase("Structuring data into forensic ledger…");
      var res = await fetch("/extract", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          frames: frames.map(function (f) { return { frame: f.frame, timestamp: f.timestamp, text: f.text, confidence: f.confidence }; }),
          kind: isVideo ? "video" : "image", filename: selectedFile.name
        })
      });
      var body = await res.json();
      if (!res.ok || body.error) throw new Error(body.error || "Forensic extraction parsing failed.");

      setComplete();
      state.data = body;
      state.tab = "all";
      state.removed = {};
      state.search = "";
      state.minConf = 0;
      state.sortField = "frame";
      state.sortDir = "asc";

      if (ledgerSkeleton) ledgerSkeleton.hidden = true;
      if (mastheadEntities) mastheadEntities.textContent = "" + body.items.length;

      renderResults();
      persistSession(selectedFile, body, selectedFPS);
      showToast("Ledger updated: " + body.items.length + " entities identified", "SUCCESS");
    } catch (err) {
      await releaseEngine().catch(function () {});
      if (ledgerSkeleton) ledgerSkeleton.hidden = true;
      progTrack.hidden = true;
      progStatus.hidden = true;
      procStats.hidden = true;
      if (err && err.message === CANCELLED) { toIdle(); return; }
      if (errorBox) {
        errorText.textContent = err && err.message ? err.message : "Processing failed.";
        errorBox.hidden = false;
      }
      showToast("Extraction error: " + (err && err.message ? err.message : "Error"), "ERROR");
    }
  }

  /* ================= DATA HELPERS & RENDERING ================= */
  function labelOf(cat) { return (state.data && state.data.labels && state.data.labels[cat]) || cat.toUpperCase(); }

  function isSimilarEmailJS(e1, e2) {
    if (e1 === e2) return true;
    var p1 = e1.split("@"), p2 = e2.split("@");
    if (p1.length !== 2 || p2.length !== 2) return false;
    if (p1[1] !== p2[1]) return false;
    var u1 = p1[0], u2 = p2[0];
    if (Math.abs(u1.length - u2.length) > 5) return false;
    var matches = 0, minL = Math.min(u1.length, u2.length), maxL = Math.max(u1.length, u2.length);
    for (var i = 0; i < minL; i++) {
      if (u1[i] === u2[i]) matches++;
    }
    if (matches / maxL >= 0.75) return true;
    var longer = u1.length > u2.length ? u1 : u2, shorter = u1.length > u2.length ? u2 : u1;
    if (longer.indexOf(shorter) !== -1) return true;
    return false;
  }

  function liveItems() {
    if (!state.data || !state.data.items) return [];
    var raw = state.data.items.filter(function (it) { return !state.removed[it.id]; });
    var deduped = [];
    raw.forEach(function (it) {
      if (it.category === "email") {
        var existing = null;
        for (var i = 0; i < deduped.length; i++) {
          if (deduped[i].category === "email" && isSimilarEmailJS(deduped[i].normalized.toLowerCase(), (it.normalized || "").toLowerCase())) {
            existing = deduped[i];
            break;
          }
        }
        if (existing) {
          if (it.confidence > existing.confidence) existing.confidence = it.confidence;
          return;
        }
      }
      var exact = null;
      for (var j = 0; j < deduped.length; j++) {
        if (deduped[j].category === it.category && deduped[j].normalized.toLowerCase() === (it.normalized || "").toLowerCase()) {
          exact = deduped[j];
          break;
        }
      }
      if (!exact) {
        deduped.push(Object.assign({}, it));
      }
    });
    return deduped;
  }

  function countsOf(items) {
    var c = {};
    items.forEach(function (it) { c[it.category] = (c[it.category] || 0) + 1; });
    return c;
  }

  function renderResults() {
    var items = liveItems(), counts = countsOf(items);
    renderCards(counts, items.length, true);
    renderTable();
  }

  /* ================= MATRIX GRID CARDS (Matching Concept 2 Broadside) ================= */
  var DEFAULT_CATEGORIES = [
    { key: "email", label: "EMAILS" },
    { key: "phone", label: "TELEPHONE" },
    { key: "upi", label: "UPI ID" },
    { key: "gst", label: "GSTIN" },
    { key: "pan", label: "PAN" }
  ];

  function renderDefaultCards() {
    summaryCards.innerHTML = "";

    // ALL FIELDS card (solid blue #0038FF when active)
    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "matrix-item" + (state.tab === "all" ? " active" : "");
    allBtn.innerHTML = '<span class="m-label">ALL FIELDS</span><div class="m-count">00</div>';
    allBtn.addEventListener("click", function () { setTab("all"); });
    summaryCards.appendChild(allBtn);

    DEFAULT_CATEGORIES.forEach(function (cat) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "matrix-item" + (state.tab === cat.key ? " active" : "");
      btn.innerHTML = '<span class="m-label">' + escapeHtml(cat.label) + '</span><div class="m-count">00</div>';
      btn.addEventListener("click", function () { setTab(cat.key); });
      summaryCards.appendChild(btn);
    });
  }

  function renderCards(counts, totalItems, animate) {
    summaryCards.innerHTML = "";

    // Card 1: ALL FIELDS (active = solid International Klein Blue #0038FF with white text)
    var allBtn = document.createElement("button");
    allBtn.type = "button";
    allBtn.className = "matrix-item" + (state.tab === "all" ? " active" : "");
    var formattedTotal = totalItems < 10 ? "0" + totalItems : "" + totalItems;
    allBtn.innerHTML = '<span class="m-label">ALL FIELDS</span><div class="m-count">' + formattedTotal + '</div>';
    allBtn.addEventListener("click", function () { setTab("all"); });
    summaryCards.appendChild(allBtn);
    var allCount = allBtn.querySelector(".m-count");
    if (animate && allCount) animateNumber(allCount, totalItems, 500);

    // Remaining category cards
    var cats = state.data && state.data.order ? state.data.order.filter(function (k) { return counts[k]; }) : Object.keys(counts);
    if (!cats.length) {
      DEFAULT_CATEGORIES.forEach(function (d) {
        var b = document.createElement("button");
        b.type = "button";
        b.className = "matrix-item" + (state.tab === d.key ? " active" : "");
        b.innerHTML = '<span class="m-label">' + escapeHtml(d.label) + '</span><div class="m-count">00</div>';
        b.addEventListener("click", function () { setTab(d.key); });
        summaryCards.appendChild(b);
      });
      return;
    }

    cats.forEach(function (cat) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "matrix-item cat-" + cat + (state.tab === cat ? " active" : "");
      var cnt = counts[cat] || 0;
      var formatted = cnt < 10 ? "0" + cnt : "" + cnt;
      b.innerHTML = '<span class="m-label">' + escapeHtml(labelOf(cat)) + '</span><div class="m-count">' + formatted + '</div>';
      b.addEventListener("click", function () { setTab(cat); });
      summaryCards.appendChild(b);
      var cntEl = b.querySelector(".m-count");
      if (animate && cntEl) {
        animateNumber(cntEl, cnt, 500);
      }
    });
  }

  function setTab(key) {
    state.tab = key;
    var items = liveItems(), counts = countsOf(items);
    renderCards(counts, items.length, false);
    renderTable();
  }

  function tableItems() {
    var items = liveItems();
    if (state.tab !== "all") items = items.filter(function (it) { return it.category === state.tab; });
    if (state.minConf > 0) items = items.filter(function (it) { return it.confidence >= state.minConf; });
    var q = state.search.trim().toLowerCase();
    if (q) items = items.filter(function (it) {
      return it.normalized.toLowerCase().indexOf(q) !== -1 || labelOf(it.category).toLowerCase().indexOf(q) !== -1;
    });
    var f = state.sortField, dir = state.sortDir === "asc" ? 1 : -1;
    return items.slice().sort(function (a, b) {
      var x, y;
      if (f === "value") { x = a.normalized.toLowerCase(); y = b.normalized.toLowerCase(); }
      else if (f === "category") { x = a.category; y = b.category; }
      else { x = a[f]; y = b[f]; }
      return (x < y ? -1 : x > y ? 1 : 0) * dir;
    });
  }

  /* ================= LEDGER TABLE (Concept 2 Broadside Match) ================= */
  function renderDefaultTable() {
    tableBody.innerHTML =
      '<tr id="emptyRow">' +
        '<td colspan="6" style="text-align: center; padding: 48px 16px; color: var(--ink-muted); font-family: var(--font-mono); font-size: 12px;">' +
          'No media analyzed yet. Drop a video or image on the left and click Execute Extraction.' +
        '</td>' +
      '</tr>';
    emptyLine.hidden = true;
  }

  function renderTable() {
    var rows = tableItems();
    tableBody.innerHTML = "";
    emptyLine.hidden = rows.length !== 0;
    updateSortArrows();

    if (!rows.length && (!state.data || !state.data.items.length)) {
      renderDefaultTable();
      return;
    }

    rows.forEach(function (it) {
      var tr = document.createElement("tr");
      tr.setAttribute("data-type", it.category);
      var valueHtml = it.category === "website"
        ? '<a href="' + escapeAttr(it.normalized) + '" target="_blank" rel="noopener noreferrer" style="color:var(--accent); text-decoration:none;">' + escapeHtml(it.normalized) + "</a>"
        : escapeHtml(it.normalized);

      var confVal = Math.round(it.confidence * 10) / 10;
      var confLvl = it.confidence >= 90 ? "high" : it.confidence >= 75 ? "mid" : "low";
      var frameFormatted = "#" + (it.frame < 10 ? "0" + it.frame : it.frame);
      var timeFormatted = fmtTime(it.timestamp) + "s";

      tr.innerHTML =
        '<td><span class="badge-pill pill-' + it.category + '">' + escapeHtml(labelOf(it.category)) + '</span></td>' +
        '<td class="mono-cell">' + valueHtml + '</td>' +
        '<td class="mono-cell">' + timeFormatted + '</td>' +
        '<td class="mono-cell">' + frameFormatted + '</td>' +
        '<td>' +
          '<div class="conf-cell">' +
            '<div class="conf-bar"><div class="conf-bar-fill ' + confLvl + '" style="width:' + Math.min(100, Math.max(8, confVal)) + '%;"></div></div>' +
            '<span class="conf-val">' + confVal + '%</span>' +
          '</div>' +
        '</td>' +
        '<td style="text-align: right;">' +
          '<button class="btn-copy-minimal" type="button">Copy</button>' +
        '</td>';

      var copyBtn = tr.querySelector(".btn-copy-minimal");
      copyBtn.addEventListener("click", function () {
        copyText(it.normalized);
        copyBtn.textContent = "COPIED";
        setTimeout(function () { copyBtn.textContent = "Copy"; }, 1400);
        showToast("Copied " + it.normalized, "CLIPBOARD");
      });

      tableBody.appendChild(tr);
    });
  }

  function updateSortArrows() {
    Array.prototype.forEach.call(document.querySelectorAll("#dataTable thead th[data-sort]"), function (th) {
      var a = th.querySelector(".arrow"); if (!a) return;
      a.textContent = th.getAttribute("data-sort") === state.sortField ? (state.sortDir === "asc" ? " ▲" : " ▼") : "";
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#dataTable thead th[data-sort]"), function (th) {
    th.addEventListener("click", function () {
      var f = th.getAttribute("data-sort");
      if (state.sortField === f) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortField = f; state.sortDir = "asc"; }
      renderTable();
    });
  });

  /* ================= EXPORT & PERSISTENCE ================= */
  function csvSafe(v) {
    v = String(v == null ? "" : v);
    if (/^[=+\-@]/.test(v)) v = "'" + v;
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function downloadCSV(items, filename) {
    if (!items.length) return;
    var lines = ["TYPE,IDENTIFIER VALUE,TIMESTAMP,FRAME,CONFIDENCE"];
    items.forEach(function (it) {
      lines.push([csvSafe(labelOf(it.category)), csvSafe(it.normalized), csvSafe(fmtTime(it.timestamp) + "s"), csvSafe("#" + it.frame), Math.round(it.confidence) + "%"].join(","));
    });
    download(filename, "﻿" + lines.join("\r\n"), "text/csv;charset=utf-8;");
  }
  function exportJSON(items) {
    if (!items.length) return;
    var payload = {
      exportedAt: new Date().toISOString(),
      source: selectedFile ? selectedFile.name : "",
      total: items.length,
      records: items.map(function (it) {
        return { type: labelOf(it.category), value: it.normalized, timestamp: fmtTime(it.timestamp) + "s", frame: it.frame, confidence: Math.round(it.confidence) };
      })
    };
    download("vision-extract.json", JSON.stringify(payload, null, 2), "application/json;charset=utf-8;");
  }
  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime }), url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  }
  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text);
    } else {
      var ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); } catch (e) {} document.body.removeChild(ta);
    }
  }

  function persistSession(file, data, fps) {
    try {
      var payload = { filename: file.name, size: file.size, fps: fps, data: data, timestamp: Date.now() };
      localStorage.setItem("vde-persisted-session", JSON.stringify(payload));
    } catch (e) {}
  }
  function checkPersistedSession() {
    try {
      var raw = localStorage.getItem("vde-persisted-session");
      if (!raw) return;
      var session = JSON.parse(raw);
      if (!session || !session.data || !session.data.items) return;
      var banner = el("sessionBanner");
      var summary = el("sessionSummary");
      if (banner && summary) {
        summary.textContent = session.filename + " · " + session.data.items.length + " records (" + formatBytes(session.size) + ")";
        banner.hidden = false;
        el("restoreSessionBtn").onclick = function () {
          restoreSession(session);
          banner.hidden = true;
        };
        el("dismissSessionBtn").onclick = function () {
          banner.hidden = true;
          try { localStorage.removeItem("vde-persisted-session"); } catch (e) {}
        };
      }
    } catch (e) {}
  }
  function restoreSession(session) {
    selectedFile = { name: session.filename, size: session.size };
    selectedFPS = session.fps || 2;
    dzTitle.textContent = "Target: " + session.filename;
    dzSub.innerHTML = formatBytes(session.size) + " · Restored session";
    fileMountedBadge.hidden = false;
    fileName.textContent = session.filename;
    fileSize.textContent = formatBytes(session.size);

    state.data = session.data;
    state.tab = "all"; state.removed = {}; state.search = ""; state.minConf = 0; state.sortField = "frame"; state.sortDir = "asc";
    if (mastheadEntities) mastheadEntities.textContent = "" + session.data.items.length;
    renderResults();
    showToast("Restored " + session.data.items.length + " records from previous session", "RESTORED");
  }

  /* ================= UTILITIES ================= */
  function fmtTime(sec) {
    var m = Math.floor(sec / 60), s = (sec % 60).toFixed(2);
    if (s < 10) s = "0" + s;
    return (m < 10 ? "0" + m : m) + ":" + s;
  }
  function showUploadError(m) { errorLine.textContent = m; errorLine.hidden = false; }
  function hideError() { errorLine.hidden = true; errorLine.textContent = ""; }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function escapeAttr(s) { return escapeHtml(s).replace(/`/g, "%60"); }

  /* Initialize default state */
  renderDefaultCards();
  renderDefaultTable();
  checkPersistedSession();

})();

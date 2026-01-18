// ==========================
// FoV Mapping Webapp (v1)
// Static GitHub Pages ready
// ==========================

const $ = (id) => document.getElementById(id);

const ui = {
  azMin: $("azMin"), azMax: $("azMax"),
  elMin: $("elMin"), elMax: $("elMax"),
  stepDeg: $("stepDeg"), dwellMs: $("dwellMs"),

  btnStart: $("btnStart"), btnPause: $("btnPause"), btnStop: $("btnStop"),
  btnOk: $("btnOk"), btnNotOk: $("btnNotOk"),
  btnPrev: $("btnPrev"), btnNext: $("btnNext"),
  goAz: $("goAz"), goEl: $("goEl"), btnGoto: $("btnGoto"),

  btnExportJson: $("btnExportJson"),
  btnExportCsv: $("btnExportCsv"),
  btnClear: $("btnClear"),

  deviceMode: $("deviceMode"),
  espBaseUrl: $("espBaseUrl"),
  sbUrl: $("sbUrl"),
  sbKey: $("sbKey"),
  sbCmdTarget: $("sbCmdTarget"),
  sbDeviceId: $("sbDeviceId"),

  stState: $("stState"),
  stAz: $("stAz"),
  stEl: $("stEl"),
  stIndex: $("stIndex"),
  stOk: $("stOk"),
  stBad: $("stBad"),
  progressBar: $("progressBar"),
  progressText: $("progressText"),

  polarCanvas: $("polarCanvas"),

  log: $("log"),
  rows: $("rows"),
};

// ---- State ----
const state = {
  runState: "idle", // idle | running | paused | stopped
  points: [],       // generated scan points
  idx: 0,           // current point index
  dwellMs: 250,
  captured: [],     // {az, el, status, t}
};

function nowISO() {
  return new Date().toISOString();
}

function log(msg) {
  const line = document.createElement("div");
  line.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
  ui.log.prepend(line);
}

function clampInt(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function buildPoints({ azMin, azMax, elMin, elMax, step }) {
  // Your desired scan order:
  // For each azimuth: sweep elevation fully
  // azimuth steps first, then elevation angles, then next azimuth
  const pts = [];
  for (let az = azMin; az <= azMax + 1e-9; az += step) {
    for (let el = elMin; el <= elMax + 1e-9; el += step) {
      pts.push({ az: round1(az), el: round1(el) });
    }
  }
  return pts;
}

function round1(x) { return Math.round(x * 10) / 10; }

function setRunState(s) {
  state.runState = s;
  ui.stState.textContent = s.toUpperCase();
}

function updateStatus() {
  const total = state.points.length || 0;
  const idx = Math.min(state.idx, Math.max(total - 1, 0));
  const p = total ? state.points[idx] : { az: 0, el: 0 };

  ui.stAz.textContent = `${p.az}°`;
  ui.stEl.textContent = `${p.el}°`;
  ui.stIndex.textContent = `${Math.min(state.idx + 1, total)} / ${total}`;

  const okCount = state.captured.filter(x => x.status === "OK").length;
  const badCount = state.captured.filter(x => x.status === "NOT_OK").length;
  ui.stOk.textContent = String(okCount);
  ui.stBad.textContent = String(badCount);

  const progress = total ? Math.round(((state.idx) / total) * 100) : 0;
  ui.progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
  ui.progressText.textContent = `${Math.min(100, Math.max(0, progress))}%`;

  renderTable();
  drawPolar();
}

function renderTable() {
  ui.rows.innerHTML = "";
  const frag = document.createDocumentFragment();

  state.captured.slice().reverse().forEach((r, i) => {
    const tr = document.createElement("tr");
    const badge = badgeHTML(r.status);
    tr.innerHTML = `
      <td>${state.captured.length - i}</td>
      <td>${r.az}</td>
      <td>${r.el}</td>
      <td>${badge}</td>
      <td>${new Date(r.t).toLocaleString()}</td>
    `;
    frag.appendChild(tr);
  });

  ui.rows.appendChild(frag);
}

function badgeHTML(status) {
  if (status === "OK") return `<span class="badge ok">OK</span>`;
  if (status === "NOT_OK") return `<span class="badge no">NOT OK</span>`;
  return `<span class="badge na">—</span>`;
}

// =======================
// Device command sending
// =======================

async function sendMoveCommand(az, el) {
  const mode = ui.deviceMode.value;

  if (mode === "none") return;

  if (mode === "http") {
    // Expect your ESP32 to expose something like:
    // POST /move { az: <deg>, el: <deg> }
    // or GET /move?az=..&el=..
    const base = ui.espBaseUrl.value.trim();
    if (!base) {
      log("HTTP mode selected, but ESP32 Base URL is empty.");
      return;
    }

    const url = `${base.replace(/\/+$/,"")}/move`;
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ az, el }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      log(`Sent ESP32 move: az=${az}, el=${el}`);
    } catch (e) {
      log(`ESP32 send failed: ${e.message}`);
    }
    return;
  }

  if (mode === "supabase") {
    // Minimal REST insert into a "commands" table
    // You can adapt columns to match your existing schema.
    const sbUrl = ui.sbUrl.value.trim();
    const sbKey = ui.sbKey.value.trim();
    const target = ui.sbCmdTarget.value.trim() || "commands";
    const deviceId = ui.sbDeviceId.value.trim() || "fov_rig_1";

    if (!sbUrl || !sbKey) {
      log("Supabase mode selected, but URL/Key missing.");
      return;
    }

    const endpoint = `${sbUrl.replace(/\/+$/,"")}/rest/v1/${encodeURIComponent(target)}`;

    // Suggested row format (customize to your schema):
    // { device_id, cmd, az_deg, el_deg, created_at }
    const payload = [{
      device_id: deviceId,
      cmd: "MOVE",
      az_deg: az,
      el_deg: el,
      created_at: new Date().toISOString()
    }];

    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": sbKey,
          "Authorization": `Bearer ${sbKey}`,
          "Prefer": "return=minimal"
        },
        body: JSON.stringify(payload),
      });
      if (!r.ok) {
        const txt = await r.text().catch(() => "");
        throw new Error(`HTTP ${r.status} ${txt}`);
      }
      log(`Inserted Supabase cmd MOVE az=${az}, el=${el}`);
    } catch (e) {
      log(`Supabase cmd insert failed: ${e.message}`);
    }
  }
}

// =======================
// Scan engine
// =======================

function currentPoint() {
  if (!state.points.length) return { az: 0, el: 0 };
  return state.points[Math.min(state.idx, state.points.length - 1)];
}

async function stepToIndex(newIdx, reason = "") {
  const total = state.points.length;
  if (!total) return;

  state.idx = Math.min(Math.max(newIdx, 0), total - 1);
  const p = currentPoint();

  await sendMoveCommand(p.az, p.el);
  if (reason) log(`${reason}: moved to az=${p.az}, el=${p.el}`);
  updateStatus();
}

async function runLoop() {
  setRunState("running");
  log("Scan started.");

  while (state.runState === "running") {
    const total = state.points.length;
    if (!total) {
      log("No points. Check ranges.");
      setRunState("idle");
      break;
    }
    if (state.idx >= total) {
      log("Scan completed.");
      setRunState("idle");
      break;
    }

    const p = currentPoint();
    await sendMoveCommand(p.az, p.el);
    log(`At point az=${p.az}, el=${p.el} (waiting user OK/Not OK...)`);

    // Wait for user capture OR timeout dwell? (You said user presses)
    // We will not auto-advance on timer.
    // User must press OK/Not OK or Next.
    setRunState("paused");
    updateStatus();
    break;
  }
}

function capture(status) {
  const p = currentPoint();

  // update existing capture if already captured this point
  const key = `${p.az}|${p.el}`;
  const existing = state.captured.findIndex(x => `${x.az}|${x.el}` === key);
  const row = { az: p.az, el: p.el, status, t: Date.now() };

  if (existing >= 0) state.captured[existing] = row;
  else state.captured.push(row);

  log(`Captured ${status} at az=${p.az}, el=${p.el}`);

  // auto-advance after capture
  if (state.idx < state.points.length - 1) {
    state.idx += 1;
    setRunState("running");
    // small dwell before moving
    const dwell = clampInt(ui.dwellMs.value, 250);
    state.dwellMs = dwell;
    setTimeout(async () => {
      await stepToIndex(state.idx, "Auto-next");
      setRunState("paused");
      updateStatus();
    }, dwell);
  } else {
    log("Last point captured. Scan completed.");
    setRunState("idle");
  }

  updateStatus();
}

// =======================
// Export
// =======================

function download(filename, text, mime = "text/plain") {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON() {
  const payload = {
    meta: {
      created_at: nowISO(),
      ranges: getRanges(),
      total_points: state.points.length,
      captured_points: state.captured.length
    },
    points: state.points,
    captured: state.captured
  };
  download(`fov_map_${Date.now()}.json`, JSON.stringify(payload, null, 2), "application/json");
}

function exportCSV() {
  const lines = ["index,az_deg,el_deg,status,timestamp_iso"];
  const map = new Map(state.captured.map(r => [`${r.az}|${r.el}`, r]));

  state.points.forEach((p, i) => {
    const r = map.get(`${p.az}|${p.el}`);
    const status = r ? r.status : "";
    const tiso = r ? new Date(r.t).toISOString() : "";
    lines.push(`${i + 1},${p.az},${p.el},${status},${tiso}`);
  });

  download(`fov_map_${Date.now()}.csv`, lines.join("\n"), "text/csv");
}

// =======================
// Helpers
// =======================

function resizeCanvasToDisplaySize(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    return true;
  }
  return false;
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

function elevationToRadius(elevation, maxRadiusPx, maxRadiusDeg) {
  const rDeg = 90 - elevation;
  return (rDeg / maxRadiusDeg) * maxRadiusPx;
}

function drawPolar() {
  const canvas = ui.polarCanvas;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const dpr = window.devicePixelRatio || 1;
  resizeCanvasToDisplaySize(canvas);

  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const cx = w / 2;
  const cy = h / 2;
  const pad = 14 * dpr;
  const maxRadiusPx = Math.max(1, Math.min(w, h) / 2 - pad);

  const ranges = getRanges();
  const elMin = Math.min(ranges.elMin, ranges.elMax);
  const maxRadiusDeg = elMin < 0 ? 90 - elMin : 90;

  // Rings
  const ringEls = [90, 60, 30, 0];
  if (elMin < 0) ringEls.push(elMin);

  ctx.strokeStyle = "rgba(255,255,255,.10)";
  ctx.lineWidth = 1 * dpr;
  ringEls.forEach((el) => {
    const r = elevationToRadius(el, maxRadiusPx, maxRadiusDeg);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });

  // Radial lines
  const azLines = [-90, -45, 0, 45, 90];
  ctx.strokeStyle = "rgba(255,255,255,.10)";
  azLines.forEach((az) => {
    const t = deg2rad(az);
    const x = cx + maxRadiusPx * Math.cos(t);
    const y = cy - maxRadiusPx * Math.sin(t);
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(x, y);
    ctx.stroke();
  });

  // Points
  const dotR = 4 * dpr;
  const outline = "rgba(0,0,0,.6)";
  state.captured.forEach((p) => {
    const t = deg2rad(p.az);
    const r = elevationToRadius(p.el, maxRadiusPx, maxRadiusDeg);
    const x = cx + r * Math.cos(t);
    const y = cy - r * Math.sin(t);
    ctx.beginPath();
    ctx.fillStyle = p.status === "OK" ? "#22c55e" : "#ef4444";
    ctx.arc(x, y, dotR, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = outline;
    ctx.lineWidth = 1 * dpr;
    ctx.stroke();
  });
}

function getRanges() {
  const azMin = clampInt(ui.azMin.value, -90);
  const azMax = clampInt(ui.azMax.value, 90);
  const elMin = clampInt(ui.elMin.value, -15);
  const elMax = clampInt(ui.elMax.value, 90);
  const step = Math.max(1, clampInt(ui.stepDeg.value, 5));
  const dwellMs = Math.max(0, clampInt(ui.dwellMs.value, 250));
  return { azMin, azMax, elMin, elMax, step, dwellMs };
}

function rebuildPoints() {
  const r = getRanges();

  // normalize
  const azMin = Math.min(r.azMin, r.azMax);
  const azMax = Math.max(r.azMin, r.azMax);
  const elMin = Math.min(r.elMin, r.elMax);
  const elMax = Math.max(r.elMin, r.elMax);

  state.points = buildPoints({ azMin, azMax, elMin, elMax, step: r.step });
  state.idx = 0;

  log(`Points generated: ${state.points.length} (az ${azMin}..${azMax}, el ${elMin}..${elMax}, step ${r.step})`);
  updateStatus();
}

// =======================
// UI bindings
// =======================

ui.btnStart.addEventListener("click", async () => {
  rebuildPoints();
  await stepToIndex(0, "Start");
  await runLoop();
});

ui.btnPause.addEventListener("click", () => {
  if (state.runState === "running") setRunState("paused");
  else if (state.runState === "paused") setRunState("running");
  updateStatus();
});

ui.btnStop.addEventListener("click", () => {
  setRunState("stopped");
  log("Stopped.");
  updateStatus();
});

ui.btnOk.addEventListener("click", () => {
  if (!state.points.length) rebuildPoints();
  capture("OK");
});

ui.btnNotOk.addEventListener("click", () => {
  if (!state.points.length) rebuildPoints();
  capture("NOT_OK");
});

window.addEventListener("resize", () => {
  drawPolar();
});

ui.btnNext.addEventListener("click", async () => {
  if (!state.points.length) rebuildPoints();
  await stepToIndex(state.idx + 1, "Next");
  setRunState("paused");
  updateStatus();
});

ui.btnPrev.addEventListener("click", async () => {
  if (!state.points.length) rebuildPoints();
  await stepToIndex(state.idx - 1, "Previous");
  setRunState("paused");
  updateStatus();
});

ui.btnGoto.addEventListener("click", async () => {
  if (!state.points.length) rebuildPoints();
  const az = clampInt(ui.goAz.value, 0);
  const el = clampInt(ui.goEl.value, 0);

  // Find nearest point in grid
  let best = 0;
  let bestD = Infinity;
  state.points.forEach((p, i) => {
    const d = Math.abs(p.az - az) + Math.abs(p.el - el);
    if (d < bestD) { bestD = d; best = i; }
  });

  await stepToIndex(best, "Goto");
  setRunState("paused");
  updateStatus();
});

ui.btnExportJson.addEventListener("click", exportJSON);
ui.btnExportCsv.addEventListener("click", exportCSV);

ui.btnClear.addEventListener("click", () => {
  state.captured = [];
  state.idx = 0;
  setRunState("idle");
  log("Cleared captured data.");
  updateStatus();
});

// Initial
rebuildPoints();
setRunState("idle");
log("Ready. Configure ranges and press Start.");
updateStatus();

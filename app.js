const SETTINGS_KEY = "sonicapp.aiSettings.v1";
const HOTSPOT_KEY = "sonicapp.hotspot.v1";
const DB_NAME = "sonicapp-recordings";
const DB_VERSION = 1;
const DEVICE_BASE_URL = "http://192.168.1.1";
const DEVICE_WS_URL = "ws://192.168.1.1:27689";
const APP_CACHE_NAME = "sonicapp-pwa-v3";
const RECORDER_BLE_SERVICE = "0000ae20-0000-1000-8000-00805f9b34fb";
const RECORDER_BLE_CHARACTERISTICS = [
  "0000ae21-0000-1000-8000-00805f9b34fb",
  "0000ae22-0000-1000-8000-00805f9b34fb",
  "0000ae23-0000-1000-8000-00805f9b34fb",
  "0000ae24-0000-1000-8000-00805f9b34fb"
];
const AUDIO_EXTENSIONS = [".wav", ".mp3", ".m4a", ".aac", ".ogg", ".flac", ".webm"];
const RECORDING_ENDPOINTS = [
  "/api/recordings",
  "/api/files",
  "/api/audio",
  "/recordings",
  "/files",
  "/list",
  "/"
];
const RECORDING_WS_COMMANDS = [
  { cmd: "4" },
  { cmd: "3" },
  { cmd: "2" },
  { cmd: "1" },
  { cmd: "getRecordFileList" }
];
const BLE_TEXT_DECODER = new TextDecoder();
const BLE_TEXT_ENCODER = new TextEncoder();
const BLE_WIFI_PROBE_COMMANDS = [
  { cmd: "connectDeviceWiFi" },
  { cmd: "getDeviceWiFiState" },
  { cmd: "getWiFiHotspotState" },
  { cmd: "12" },
  { cmd: "11" },
  { cmd: "10" },
  "connectDeviceWiFi",
  "getDeviceWiFiState",
  "getWiFiHotspotState"
];

const SUMMARY_SYSTEM_PROMPT = `## System Role & Objective
You are an expert executive assistant and business analyst. Your task is to analyze the provided meeting transcription between "Person 1" and "Person 2", mapping their true identities using the provided Contact List where possible, and extract a comprehensive, structured business summary.

## Contextual Data

### 1. Business Contact List (Reference)
The following people are common business contacts. Use this list to infer or explicitly map who "Person 1" and "Person 2" actually are based on context clues, names mentioned, or conversational topics:
{{CONTACT_LIST}}

### 2. Meeting Transcription to Analyze
"""
{{TRANSCRIPTION_TEXT}}
"""

---

## Output Requirements
Please process the transcription and generate a highly organized, professional summary using the following structure:

### 1. Participant Identification
*   Identify who **Person 1** and **Person 2** most likely are by cross-referencing the conversation with the Contact List. State the confidence level or specific clues used for the mapping.

### 2. Executive Business Summary
*   A concise, 3-4 sentence high-level overview of the entire conversation, its main purpose, and the overall outcome or sentiment.

### 3. Key Discussion Points & Decisions Made
*   A bulleted list of the core topics discussed.
*   Explicitly highlight any firm decisions, agreements, or policy changes made during the meeting.

### 4. What Has Been Done Already (Historical/Completed Tasks)
*   Extract items or tasks explicitly mentioned during the call as *already completed*, shipped, fixed, or resolved prior to or during the meeting.

### 5. Actionable Requests & Next Steps (The Task Matrix)
Provide a clear breakdown of future work. For every actionable item, extract:
*   **Task:** Clear, descriptive action required.
*   **Owner:** Who is responsible (Map to real names or Person 1/2 if unclear).
*   **Deadline/Urgency:** Specific dates mentioned, or relative urgency (e.g., ASAP, next week).

### 6. Risks, Blockers, & Open Questions
*   Any dependencies, technological blockers, or potential risks mentioned that could delay next steps.
*   List any unresolved questions that require a follow-up meeting or external clarification.`;

const elements = {
  settingsButton: document.querySelector("#settingsButton"),
  installButton: document.querySelector("#installButton"),
  offlineBadge: document.querySelector("#offlineBadge"),
  settingsDialog: document.querySelector("#settingsDialog"),
  settingsForm: document.querySelector("#settingsForm"),
  hotspotDialog: document.querySelector("#hotspotDialog"),
  hotspotDialogSsid: document.querySelector("#hotspotDialogSsid"),
  hotspotDialogPassword: document.querySelector("#hotspotDialogPassword"),
  hotspotPasswordRow: document.querySelector("#hotspotPasswordRow"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  transcribeModelInput: document.querySelector("#transcribeModelInput"),
  summaryModelInput: document.querySelector("#summaryModelInput"),
  contactsInput: document.querySelector("#contactsInput"),
  settingsState: document.querySelector("#settingsState"),
  settingsDot: document.querySelector("#settingsDot"),
  wifiState: document.querySelector("#wifiState"),
  wifiDot: document.querySelector("#wifiDot"),
  deviceState: document.querySelector("#deviceState"),
  deviceDot: document.querySelector("#deviceDot"),
  pwaState: document.querySelector("#pwaState"),
  pwaDot: document.querySelector("#pwaDot"),
  hotspotName: document.querySelector("#hotspotName"),
  hotspotHint: document.querySelector("#hotspotHint"),
  bleButton: document.querySelector("#bleButton"),
  confirmWifiButton: document.querySelector("#confirmWifiButton"),
  downloadButton: document.querySelector("#downloadButton"),
  manualImportInput: document.querySelector("#manualImportInput"),
  clearButton: document.querySelector("#clearButton"),
  transcribeAllButton: document.querySelector("#transcribeAllButton"),
  summarizeAllButton: document.querySelector("#summarizeAllButton"),
  logOutput: document.querySelector("#logOutput"),
  recordingsList: document.querySelector("#recordingsList"),
  recordingTemplate: document.querySelector("#recordingTemplate"),
  recordingCount: document.querySelector("#recordingCount"),
  transcribedCount: document.querySelector("#transcribedCount"),
  summarizedCount: document.querySelector("#summarizedCount")
};

let dbPromise;
let recordings = [];
let objectUrls = new Map();
let deferredInstallPrompt = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("recordings")) {
        db.createObjectStore("recordings", { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function dbAction(mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", mode);
    const store = tx.objectStore("recordings");
    const result = callback(store);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  });
}

async function getAllRecordings() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readonly");
    const request = tx.objectStore("recordings").getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error);
  });
}

function saveSettings(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || null;
  } catch {
    return null;
  }
}

function loadHotspot() {
  try {
    return JSON.parse(localStorage.getItem(HOTSPOT_KEY)) || null;
  } catch {
    return null;
  }
}

function saveHotspot(hotspot) {
  localStorage.setItem(HOTSPOT_KEY, JSON.stringify(hotspot));
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.trim().replace(/\/$/, "");
}

function joinUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}${path.startsWith("/") ? path : `/${path}`}`;
}

function log(message) {
  const time = new Date().toLocaleTimeString();
  elements.logOutput.textContent = `[${time}] ${message}\n${elements.logOutput.textContent}`.slice(0, 9000);
}

function setStatus(kind, state, variant = "muted") {
  const stateNode = elements[`${kind}State`];
  const dotNode = elements[`${kind}Dot`];
  stateNode.textContent = state;
  dotNode.className = `status-dot ${variant}`;
}

function setOfflineReady(ready, message = "") {
  setStatus("pwa", ready ? "Ready" : "Preparing", ready ? "ok" : "muted");
  elements.offlineBadge.textContent = message || (ready ? "Offline ready" : "Preparing offline");
  elements.offlineBadge.classList.toggle("ready", ready);
}

function renderSettingsState() {
  const settings = loadSettings();
  const ready = Boolean(settings?.baseUrl && settings?.apiKey && settings?.transcribeModel && settings?.summaryModel);
  setStatus("settings", ready ? "Ready" : "Needed", ready ? "ok" : "");
  return ready;
}

function renderHotspotState() {
  const hotspot = loadHotspot();
  if (hotspot?.ssid) {
    elements.hotspotName.textContent = hotspot.ssid;
    elements.hotspotHint.textContent = hotspot.password
      ? `Password discovered: ${hotspot.password}. Connect manually in your system WiFi settings.`
      : "Connect manually in your system WiFi settings.";
  }
}

function showHotspotDialog(hotspot) {
  elements.hotspotDialogSsid.textContent = hotspot.ssid;
  elements.hotspotDialogPassword.textContent = hotspot.password || "";
  elements.hotspotPasswordRow.hidden = !hotspot.password;
  if (!elements.hotspotDialog.open) elements.hotspotDialog.showModal();
}

function fillSettingsForm() {
  const settings = loadSettings() || {};
  elements.baseUrlInput.value = settings.baseUrl || "https://api.openai.com/v1";
  elements.apiKeyInput.value = settings.apiKey || "";
  elements.transcribeModelInput.value = settings.transcribeModel || "gpt-4o-transcribe-diarize";
  elements.summaryModelInput.value = settings.summaryModel || "gpt-4.1";
  elements.contactsInput.value = settings.contacts || [
    "*   [Contact Name 1] - [Title/Role, e.g., Software Engineer]",
    "*   [Contact Name 2] - [Title/Role, e.g., Project Manager]",
    "*   [Contact Name 3] - [Title/Role, e.g., Mentor / Collaborator]",
    "*   [Contact Name 4] - [Title/Role, e.g., Client / Stakeholder]",
    "*   *(Add/Modify this list as needed)*"
  ].join("\n");
}

function openSettings() {
  fillSettingsForm();
  elements.settingsDialog.showModal();
}

async function refreshRecordings() {
  recordings = await getAllRecordings();
  renderRecordings();
}

function revokeObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = new Map();
}

function renderRecordings() {
  revokeObjectUrls();
  elements.recordingCount.textContent = recordings.length;
  elements.transcribedCount.textContent = recordings.filter((item) => item.transcribedAt).length;
  elements.summarizedCount.textContent = recordings.filter((item) => item.summarizedAt).length;
  elements.recordingsList.innerHTML = "";

  if (!recordings.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No recordings downloaded yet.";
    elements.recordingsList.append(empty);
    return;
  }

  recordings.forEach((recording) => {
    const node = elements.recordingTemplate.content.cloneNode(true);
    const card = node.querySelector(".recording-card");
    const title = node.querySelector("h3");
    const meta = node.querySelector(".meta");
    const audio = node.querySelector("audio");
    const transcriptBlock = node.querySelector(".transcript-block");
    const summaryBlock = node.querySelector(".summary-block");
    const transcriptPre = transcriptBlock.querySelector("pre");
    const summaryPre = summaryBlock.querySelector("pre");
    const transcribeButton = node.querySelector(".transcribe-button");
    const summarizeButton = node.querySelector(".summarize-button");
    const downloadFileButton = node.querySelector(".download-file-button");

    const url = URL.createObjectURL(recording.blob);
    objectUrls.set(recording.id, url);
    title.textContent = recording.name;
    meta.textContent = [
      recording.date ? `Recorded ${new Date(recording.date).toLocaleString()}` : null,
      `${formatBytes(recording.blob.size)}`,
      recording.transcribedAt ? "Transcribed" : "Not transcribed",
      recording.summarizedAt ? "Summarized" : "Not summarized"
    ].filter(Boolean).join(" · ");
    audio.src = url;

    transcriptPre.textContent = recording.transcript || "No transcript yet.";
    summaryPre.textContent = recording.summary || "No summary yet.";
    transcriptBlock.open = Boolean(recording.transcript);
    summaryBlock.open = Boolean(recording.summary);
    summarizeButton.disabled = !recording.transcript;

    transcribeButton.addEventListener("click", () => transcribeRecording(recording.id));
    summarizeButton.addEventListener("click", () => summarizeRecording(recording.id));
    downloadFileButton.addEventListener("click", () => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = recording.name;
      anchor.click();
    });

    card.dataset.id = recording.id;
    elements.recordingsList.append(node);
  });
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const sizeIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** sizeIndex).toFixed(sizeIndex ? 1 : 0)} ${units[sizeIndex]}`;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferNameFromUrl(url, fallbackIndex) {
  try {
    const pathname = new URL(url, DEVICE_BASE_URL).pathname;
    const name = pathname.split("/").filter(Boolean).pop();
    return decodeURIComponent(name || `recording-${fallbackIndex + 1}.wav`);
  } catch {
    return `recording-${fallbackIndex + 1}.wav`;
  }
}

function isAudioUrl(url) {
  const lower = url.toLowerCase().split("?")[0];
  return AUDIO_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

function makeRecordingId(sourceUrl, blob) {
  return `${sourceUrl}|${blob.size}`;
}

async function requestJsonOrText(path) {
  const response = await fetch(joinUrl(DEVICE_BASE_URL, path), { cache: "no-store" });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  const text = await response.text();
  try {
    return { path, type: "json", body: JSON.parse(text) };
  } catch {
    return { path, type: "text", body: text };
  }
}

function extractRecordingCandidates(payload) {
  if (payload.type === "json") {
    const items = Array.isArray(payload.body)
      ? payload.body
      : payload.body.recordings || payload.body.files || payload.body.items || [];
    return items.map((item, index) => {
      if (typeof item === "string") {
        return { url: item, name: inferNameFromUrl(item, index), metadata: { source: payload.path } };
      }
      const url = item.url || item.href || item.path || item.name || item.file || item.filename;
      return {
        url,
        name: item.name || item.filename || inferNameFromUrl(url || "", index),
        date: parseDate(item.date || item.createdAt || item.created || item.modified || item.timestamp),
        metadata: { ...item, source: payload.path }
      };
    }).filter((item) => item.url && isAudioUrl(item.url));
  }

  const doc = new DOMParser().parseFromString(payload.body, "text/html");
  return [...doc.querySelectorAll("a[href]")]
    .map((anchor, index) => {
      const href = anchor.getAttribute("href");
      return {
        url: href,
        name: anchor.textContent.trim() || inferNameFromUrl(href, index),
        metadata: { source: payload.path }
      };
    })
    .filter((item) => item.url && isAudioUrl(item.url));
}

async function discoverAllMethods() {
  const allCandidates = [];
  const seen = new Set();

  const addUnique = (candidates) => {
    for (const c of candidates) {
      const key = c.wsPath || c.url;
      if (key && !seen.has(key)) {
        seen.add(key);
        allCandidates.push(c);
      }
    }
  };

  // WebSocket discovery
  log(`--- WebSocket (${DEVICE_WS_URL}) ---`);
  if (!canUseInsecureDeviceSocket()) {
    log(`SKIP: HTTPS pages cannot open insecure ws:// sockets. Serve over HTTP or localhost to use the WebSocket path.`);
  } else {
    const wsCandidates = await discoverRecordingCandidatesOverWebSocket();
    if (wsCandidates.length) {
      log(`WebSocket: SUCCESS — ${wsCandidates.length} file(s) found.`);
      addUnique(wsCandidates);
    } else {
      log(`WebSocket: no files found (device did not respond or list was empty).`);
    }
  }

  // HTTP endpoint discovery
  log(`--- HTTP endpoints (${DEVICE_BASE_URL}) ---`);
  for (const endpoint of RECORDING_ENDPOINTS) {
    try {
      const payload = await requestJsonOrText(endpoint);
      const candidates = extractRecordingCandidates(payload);
      if (candidates.length) {
        log(`HTTP ${endpoint}: SUCCESS — ${candidates.length} file(s) found.`);
        addUnique(candidates);
      } else {
        log(`HTTP ${endpoint}: responded (${payload.type}) — no audio files in response.`);
      }
    } catch (error) {
      log(`HTTP ${endpoint}: FAILED — ${error.message}`);
    }
  }

  log(`--- Discovery complete: ${allCandidates.length} unique file(s) across all methods ---`);
  return allCandidates;
}

function canUseInsecureDeviceSocket() {
  return location.protocol !== "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
}

function extractCandidatesFromAnyPayload(payload) {
  const found = [];
  const visit = (value) => {
    if (!value) return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;

    const path = value.path || value.file || value.url || value.href || value.filename || value.name;
    const name = value.name || value.recordName || value.filename || (path ? inferNameFromUrl(path, found.length) : "");
    const looksLikeAudio = path && (isAudioUrl(path) || /\.pcm$/i.test(path) || /\.opus$/i.test(path));
    if (looksLikeAudio) {
      found.push({
        url: path,
        wsPath: path,
        name,
        date: parseDate(value.date || value.time || value.createdAt || value.created),
        metadata: { ...value, source: DEVICE_WS_URL }
      });
    }

    Object.values(value).forEach(visit);
  };
  visit(payload);
  return found;
}

async function discoverRecordingCandidatesOverWebSocket() {
  if (!canUseInsecureDeviceSocket()) {
    log(`Skipping ${DEVICE_WS_URL}; HTTPS pages cannot usually open insecure ws:// device sockets.`);
    return [];
  }

  return new Promise((resolve) => {
    let socket;
    let settled = false;
    const candidates = [];
    const settle = () => {
      if (settled) return;
      settled = true;
      try {
        socket?.close();
      } catch {
        // No-op.
      }
      resolve(dedupeCandidates(candidates));
    };
    const timeout = setTimeout(settle, 5000);

    try {
      log(`Checking recorder WebSocket ${DEVICE_WS_URL}`);
      socket = new WebSocket(DEVICE_WS_URL);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        log(`WebSocket connected. Sending ${RECORDING_WS_COMMANDS.length} file-list command(s):`);
        RECORDING_WS_COMMANDS.forEach((command) => {
          const payload = JSON.stringify(command);
          log(`  Send: ${payload}`);
          socket.send(payload);
        });
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data !== "string") {
          log(`WebSocket received ${event.data.byteLength || 0} binary bytes during discovery (not a file list).`);
          return;
        }
        log(`WebSocket recv: ${event.data.slice(0, 300)}`);
        try {
          candidates.push(...extractCandidatesFromAnyPayload(JSON.parse(event.data)));
        } catch {
          // Some device frames may be plain status text.
        }
        if (candidates.length) {
          clearTimeout(timeout);
          setTimeout(settle, 500);
        }
      });
      socket.addEventListener("error", () => {
        log("Recorder WebSocket did not respond.");
      });
      socket.addEventListener("close", () => {
        clearTimeout(timeout);
        settle();
      });
    } catch (error) {
      clearTimeout(timeout);
      log(`Recorder WebSocket failed: ${error.message}`);
      settle();
    }
  });
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  return candidates.filter((candidate) => {
    const key = candidate.wsPath || candidate.url;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function downloadRecordings() {
  setStatus("device", "Scanning", "");
  elements.downloadButton.disabled = true;
  try {
    const candidates = await discoverAllMethods();
    if (!candidates.length) {
      throw new Error("No recordings found via any method. Check the log above for details.");
    }

    log(`--- Downloading ${candidates.length} file(s) ---`);
    let saved = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      log(`Downloading [${index + 1}/${candidates.length}] ${candidate.name}...`);
      try {
        const blob = await downloadCandidateDiagnostic(candidate);
        const url = new URL(candidate.url, DEVICE_BASE_URL).href;
        const id = makeRecordingId(url, blob);
        await dbAction("readwrite", (store) => store.put({
          id,
          name: candidate.name || inferNameFromUrl(url, index),
          sourceUrl: url,
          date: candidate.date || null,
          metadata: candidate.metadata || {},
          blob,
          downloadedAt: new Date().toISOString(),
          createdAt: Date.now() - index,
          transcript: "",
          transcribedAt: "",
          summary: "",
          summarizedAt: ""
        }));
        saved += 1;
      } catch {
        log(`  Skipping ${candidate.name}: all transfer methods failed.`);
      }
    }

    setStatus("device", saved ? "Downloaded" : "Failed", saved ? "ok" : "error");
    log(`--- Saved ${saved} of ${candidates.length} recording(s) ---`);
    await refreshRecordings();
  } catch (error) {
    setStatus("device", "Failed", "error");
    log(`Download error: ${error.message}`);
  } finally {
    elements.downloadButton.disabled = false;
  }
}

async function downloadRecordingOverHttp(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.blob();
}

async function downloadRecordingOverWebSocket(candidate) {
  if (!canUseInsecureDeviceSocket()) {
    throw new Error("This HTTPS page cannot open the recorder's insecure ws:// file socket.");
  }

  return new Promise((resolve, reject) => {
    let socket;
    let done = false;
    let idleTimer;
    const chunks = [];
    const transferCommands = [
      { cmd: "5", path: candidate.wsPath },
      { cmd: "5", data: { path: candidate.wsPath } },
      { cmd: "download", path: candidate.wsPath }
    ];

    const finish = () => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      try {
        socket?.close();
      } catch {
        // No-op.
      }
      if (!chunks.length) {
        reject(new Error(`Recorder did not send binary audio for ${candidate.name}.`));
        return;
      }
      const type = candidate.name.toLowerCase().endsWith(".wav") ? "audio/wav" : "application/octet-stream";
      resolve(new Blob(chunks, { type }));
    };

    const fail = (message) => {
      if (done) return;
      done = true;
      clearTimeout(idleTimer);
      try {
        socket?.close();
      } catch {
        // No-op.
      }
      reject(new Error(message));
    };

    try {
      socket = new WebSocket(DEVICE_WS_URL);
      socket.binaryType = "arraybuffer";
      socket.addEventListener("open", () => {
        log(`Requesting ${candidate.name} over recorder WebSocket.`);
        transferCommands.forEach((command) => socket.send(JSON.stringify(command)));
        idleTimer = setTimeout(finish, 6000);
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          log(`Recorder transfer: ${event.data.slice(0, 220)}`);
          try {
            const payload = JSON.parse(event.data);
            const progress = Number(payload?.data?.progress ?? payload?.progress);
            if (progress >= 100 && chunks.length) setTimeout(finish, 300);
          } catch {
            // Some status frames are not JSON.
          }
          return;
        }
        chunks.push(event.data);
        clearTimeout(idleTimer);
        idleTimer = setTimeout(finish, 1200);
      });
      socket.addEventListener("error", () => fail("Recorder WebSocket transfer failed."));
      socket.addEventListener("close", () => {
        if (!done && chunks.length) finish();
      });
    } catch (error) {
      fail(error.message);
    }
  });
}

async function downloadCandidateDiagnostic(candidate) {
  const wsPath = candidate.wsPath || candidate.url;
  const httpUrl = new URL(candidate.url, DEVICE_BASE_URL).href;

  // Try WebSocket transfer (cmd: "5") — always attempt, even for HTTP-discovered files
  if (!canUseInsecureDeviceSocket()) {
    log(`  WebSocket transfer SKIP: HTTPS page cannot open ws:// socket.`);
  } else {
    try {
      const blob = await downloadRecordingOverWebSocket({ ...candidate, wsPath });
      log(`  WebSocket transfer SUCCESS: ${formatBytes(blob.size)}.`);
      return blob;
    } catch (error) {
      log(`  WebSocket transfer FAILED: ${error.message}.`);
    }
  }

  // Try HTTP transfer
  try {
    const blob = await downloadRecordingOverHttp(httpUrl);
    log(`  HTTP transfer SUCCESS: ${formatBytes(blob.size)}.`);
    return blob;
  } catch (error) {
    log(`  HTTP transfer FAILED: ${error.message}.`);
    throw error;
  }
}

async function importManualFiles(fileList) {
  const files = [...fileList].filter((file) => file.type.startsWith("audio/") || isAudioUrl(file.name));
  if (!files.length) return;

  let saved = 0;
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    const recording = {
      id: makeRecordingId(`manual:${file.name}:${file.lastModified}`, file),
      name: file.name,
      sourceUrl: "manual-import",
      date: file.lastModified ? new Date(file.lastModified).toISOString() : null,
      metadata: { source: "manual-import", type: file.type },
      blob: file,
      downloadedAt: new Date().toISOString(),
      createdAt: Date.now() - index,
      transcript: "",
      transcribedAt: "",
      summary: "",
      summarizedAt: ""
    };
    await dbAction("readwrite", (store) => store.put(recording));
    saved += 1;
  }
  elements.manualImportInput.value = "";
  await refreshRecordings();
  log(`Imported ${saved} local audio file(s).`);
}

async function tryBleDiscovery() {
  if (!navigator.bluetooth) {
    log("Web Bluetooth is not available. Use Chrome or Edge over HTTPS.");
    return;
  }

  try {
    log("Opening Bluetooth picker — looking for devices named CB08...");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "CB08" }],
      optionalServices: [RECORDER_BLE_SERVICE, "battery_service", "device_information"]
    });

    log(`Selected: "${device.name}". Connecting to GATT server...`);
    setStatus("wifi", "BLE connecting", "");
    const server = await device.gatt.connect();
    setStatus("wifi", "BLE connected", "");

    log("GATT connected. Enumerating services...");
    const services = await server.getPrimaryServices();
    log(`Found ${services.length} GATT service(s).`);
    const discovered = [device.name || ""];
    const writableCharacteristics = [];

    for (const service of services) {
      log(`Service: ${service.uuid}`);
      const characteristics = await service.getCharacteristics();
      for (const characteristic of characteristics) {
        const uuid = characteristic.uuid.toLowerCase();
        const props = Object.entries(characteristic.properties)
          .filter(([, v]) => v).map(([k]) => k).join(", ");
        const isKnown = RECORDER_BLE_CHARACTERISTICS.includes(uuid);
        log(`  Char ${uuid.slice(4, 8).toUpperCase()} [${props}]${isKnown ? " ← known recorder char" : ""}`);

        if (characteristic.properties.notify || characteristic.properties.indicate) {
          try {
            await characteristic.startNotifications();
            characteristic.addEventListener("characteristicvaluechanged", (event) => {
              const text = decodeBleValue(event.target.value);
              if (text) {
                log(`  BLE notify ${uuid.slice(4, 8).toUpperCase()}: ${text.slice(0, 220)}`);
                discovered.push(text);
                handleDiscoveredHotspot(discovered);
              }
            });
          } catch (error) {
            log(`  Notify subscribe failed: ${error.message}`);
          }
        }

        if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
          writableCharacteristics.push(characteristic);
        }

        if (characteristic.properties.read) {
          try {
            const text = decodeBleValue(await characteristic.readValue());
            if (text) {
              log(`  BLE read ${uuid.slice(4, 8).toUpperCase()}: ${text.slice(0, 220)}`);
              discovered.push(text);
              handleDiscoveredHotspot(discovered);
            }
          } catch (error) {
            log(`  Read failed: ${error.message}`);
          }
        }
      }
    }

    log(`Found ${writableCharacteristics.length} writable characteristic(s). Requesting WiFi hotspot credentials...`);
    await probeBleForWifiName(writableCharacteristics, discovered);

    if (handleDiscoveredHotspot(discovered)) {
      setStatus("wifi", "Hotspot found", "ok");
    } else {
      setStatus("wifi", "Manual connect", "");
      log("No hotspot credentials found in BLE responses. Connect to the recorder WiFi manually, then click I am connected.");
    }
  } catch (error) {
    setStatus("wifi", "BLE failed", "error");
    log(`BLE discovery failed: ${error.message}`);
  }
}

function handleDiscoveredHotspot(discovered) {
  const hotspot = extractHotspotDetails(discovered);
  if (!hotspot.ssid && !hotspot.password) return false;

  const savedHotspot = {
    ssid: hotspot.ssid || "SonicApp recorder hotspot",
    password: hotspot.password || "",
    discoveredAt: new Date().toISOString()
  };
  saveHotspot(savedHotspot);
  renderHotspotState();
  showHotspotDialog(savedHotspot);
  setStatus("wifi", "Hotspot found", "ok");
  log(`BLE discovery found hotspot details: ${savedHotspot.ssid}. Connect to it in system WiFi settings.`);
  return true;
}

function decodeBleValue(value) {
  const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  const text = BLE_TEXT_DECODER.decode(bytes).replace(/\0/g, "").trim();
  if (text) return text;
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
}

async function probeBleForWifiName(characteristics, discovered) {
  if (!characteristics.length) {
    log("No writable characteristics found. Cannot send WiFi hotspot probe commands.");
    return;
  }

  for (const characteristic of characteristics) {
    const uuid = characteristic.uuid.slice(4, 8).toUpperCase();
    for (const command of BLE_WIFI_PROBE_COMMANDS) {
      const payload = typeof command === "string" ? command : JSON.stringify(command);
      try {
        const bytes = BLE_TEXT_ENCODER.encode(payload);
        if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
          await characteristic.writeValueWithoutResponse(bytes);
        } else {
          await characteristic.writeValue(bytes);
        }
        log(`  BLE write → ${uuid}: ${payload}`);
        await new Promise((resolve) => setTimeout(resolve, 300));
      } catch (error) {
        log(`  BLE write → ${uuid} rejected (${payload.slice(0, 40)}): ${error.message}`);
      }
    }
  }

  log("Waiting 2s for device response...");
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const hotspot = extractHotspotDetails(discovered);
  if (!hotspot.ssid) {
    log("No WiFi credentials found in BLE responses. All raw BLE data received:");
    discovered.filter(Boolean).forEach((item, i) => log(`  [${i}] ${item.slice(0, 120)}`));
  }
}

function extractHotspotDetails(chunks) {
  const combined = chunks.filter(Boolean).join("\n");
  const parsed = parseJsonHotspotDetails(chunks) || {};
  return {
    ssid: parsed.ssid || findValue(combined, /"wifiName"\s*:\s*"([^"]+)"/i, 1) || findValue(combined, /(ssid|hotspot|wifi(?:name)?)[\s:=]+([^\n\r,;{}"]+)/i, 2),
    password: parsed.password || findValue(combined, /(pass|password|pwd)[\s:=]+([^\n\r,;{}"]+)/i, 2)
  };
}

function parseJsonHotspotDetails(chunks) {
  for (const chunk of chunks) {
    try {
      const payload = JSON.parse(chunk);
      const data = payload.data || payload;
      const ssid = data.wifiName || data.ssid || data.hotspot || data.wifi;
      const password = data.password || data.pass || data.pwd || data.wifiPassword;
      if (ssid || password) return { ssid, password };
    } catch {
      // Not JSON.
    }
  }
  return null;
}

function findValue(text, regex, group = 2) {
  const match = text.match(regex);
  return match?.[group]?.trim() || "";
}

async function pingDevice() {
  setStatus("wifi", "Checking", "");
  try {
    await fetch(DEVICE_BASE_URL, { cache: "no-store", mode: "no-cors" });
    setStatus("wifi", "Connected", "ok");
    log(`Reached ${DEVICE_BASE_URL}. Starting file discovery across all methods...`);
    downloadRecordings();
  } catch (error) {
    setStatus("wifi", "Unreachable", "error");
    log(`Could not reach ${DEVICE_BASE_URL}: ${error.message}`);
  }
}

async function getRecording(id) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("recordings", "readonly");
    const request = tx.objectStore("recordings").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function updateRecording(recording) {
  await dbAction("readwrite", (store) => store.put(recording));
  await refreshRecordings();
}

function requireSettings() {
  const settings = loadSettings();
  if (!settings?.baseUrl || !settings?.apiKey || !settings?.transcribeModel || !settings?.summaryModel) {
    openSettings();
    throw new Error("AI settings are required first.");
  }
  return settings;
}

async function transcribeRecording(id) {
  const settings = requireSettings();
  const recording = await getRecording(id);
  if (!recording) return;

  setStatus("device", "Transcribing", "");
  log(`Transcribing ${recording.name} with ${settings.transcribeModel}.`);
  try {
    const formData = new FormData();
    formData.append("model", settings.transcribeModel);
    formData.append("file", recording.blob, recording.name);
    formData.append("response_format", "json");

    const response = await fetch(joinUrl(settings.baseUrl, "/audio/transcriptions"), {
      method: "POST",
      headers: { Authorization: `Bearer ${settings.apiKey}` },
      body: formData
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    recording.transcript = extractTranscriptText(result);
    recording.transcriptionRaw = result;
    recording.transcribedAt = new Date().toISOString();
    await updateRecording(recording);
    setStatus("device", "Transcribed", "ok");
    log(`Transcribed ${recording.name}.`);
  } catch (error) {
    setStatus("device", "Transcribe failed", "error");
    log(`Transcription failed: ${error.message}`);
  }
}

function extractTranscriptText(result) {
  if (typeof result === "string") return result;
  if (result.text) return result.text;
  if (Array.isArray(result.segments)) {
    return result.segments.map((segment) => {
      const speaker = segment.speaker || segment.label || segment.role || "Speaker";
      return `${speaker}: ${segment.text || ""}`.trim();
    }).join("\n");
  }
  return JSON.stringify(result, null, 2);
}

async function summarizeRecording(id) {
  const settings = requireSettings();
  const recording = await getRecording(id);
  if (!recording?.transcript) return;

  setStatus("device", "Summarizing", "");
  log(`Summarizing ${recording.name} with ${settings.summaryModel}.`);
  try {
    const contactList = settings.contacts?.trim() || "*   No contact list provided.";
    const prompt = SUMMARY_SYSTEM_PROMPT
      .replace("{{CONTACT_LIST}}", contactList)
      .replace("{{TRANSCRIPTION_TEXT}}", recording.transcript);
    const response = await fetch(joinUrl(settings.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: settings.summaryModel,
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: "Generate the structured business summary from the transcription in the system prompt." }
        ],
        temperature: 0.2
      })
    });
    if (!response.ok) throw new Error(await response.text());
    const result = await response.json();
    recording.summary = result.choices?.[0]?.message?.content || JSON.stringify(result, null, 2);
    recording.summaryRaw = result;
    recording.summarizedAt = new Date().toISOString();
    await updateRecording(recording);
    setStatus("device", "Summarized", "ok");
    log(`Summarized ${recording.name}.`);
  } catch (error) {
    setStatus("device", "Summary failed", "error");
    log(`Summary failed: ${error.message}`);
  }
}

async function transcribeAll() {
  for (const recording of recordings) {
    if (!recording.transcribedAt) await transcribeRecording(recording.id);
  }
}

async function summarizeAll() {
  for (const recording of recordings) {
    if (recording.transcript && !recording.summarizedAt) await summarizeRecording(recording.id);
  }
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setStatus("pwa", "Unavailable", "error");
    elements.offlineBadge.textContent = "Offline unavailable";
    log("Service workers are not supported in this browser.");
    return;
  }

  try {
    const registration = await navigator.serviceWorker.register("service-worker.js");
    await navigator.serviceWorker.ready;
    const cache = await caches.open(APP_CACHE_NAME);
    const cachedKeys = await cache.keys();
    setOfflineReady(cachedKeys.length > 0);
    log("Offline app shell is cached. You can switch to the recorder hotspot and keep using this page.");

    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
  } catch (error) {
    setStatus("pwa", "Failed", "error");
    elements.offlineBadge.textContent = "Offline cache failed";
    log(`Offline setup failed: ${error.message}`);
  }
}

function bindPwaEvents() {
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    elements.installButton.hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
    log("SonicApp Recorder Sync was installed.");
  });

  window.addEventListener("online", () => {
    if (elements.offlineBadge.classList.contains("ready")) {
      elements.offlineBadge.textContent = "Offline ready";
    }
  });

  window.addEventListener("offline", () => {
    elements.offlineBadge.textContent = "Using offline app";
  });
}

async function clearRecordings() {
  if (!confirm("Clear all locally saved recordings, transcripts, and summaries?")) return;
  await dbAction("readwrite", (store) => store.clear());
  await refreshRecordings();
  log("Cleared local recordings.");
}

function bindEvents() {
  elements.settingsButton.addEventListener("click", openSettings);
  elements.installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    elements.installButton.hidden = true;
  });
  elements.bleButton.addEventListener("click", tryBleDiscovery);
  elements.confirmWifiButton.addEventListener("click", pingDevice);
  elements.downloadButton.addEventListener("click", downloadRecordings);
  elements.manualImportInput.addEventListener("change", (event) => importManualFiles(event.target.files));
  elements.clearButton.addEventListener("click", clearRecordings);
  elements.transcribeAllButton.addEventListener("click", transcribeAll);
  elements.summarizeAllButton.addEventListener("click", summarizeAll);
  elements.settingsForm.addEventListener("submit", (event) => {
    if (event.submitter?.value === "cancel") return;
    event.preventDefault();
    saveSettings({
      baseUrl: normalizeBaseUrl(elements.baseUrlInput.value),
      apiKey: elements.apiKeyInput.value.trim(),
      transcribeModel: elements.transcribeModelInput.value.trim(),
      summaryModel: elements.summaryModelInput.value.trim(),
      contacts: elements.contactsInput.value.trim()
    });
    elements.settingsDialog.close();
    renderSettingsState();
    log("Saved AI settings to localStorage.");
  });
}

async function init() {
  bindEvents();
  bindPwaEvents();
  renderSettingsState();
  renderHotspotState();
  await refreshRecordings();
  await registerServiceWorker();
  log("Ready. Start by confirming AI settings, then connect to the recorder hotspot.");
  if (!renderSettingsState()) openSettings();
}

window.addEventListener("beforeunload", revokeObjectUrls);
init();

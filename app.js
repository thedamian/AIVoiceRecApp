const SETTINGS_KEY = "sonicapp.aiSettings.v1";
const HOTSPOT_KEY = "sonicapp.hotspot.v1";
const DB_NAME = "sonicapp-recordings";
const DB_VERSION = 1;
const DEVICE_BASE_URL = "http://192.168.1.1";
const APP_CACHE_NAME = "sonicapp-pwa-v1";
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

async function discoverRecordingCandidates() {
  for (const endpoint of RECORDING_ENDPOINTS) {
    try {
      log(`Checking ${DEVICE_BASE_URL}${endpoint}`);
      const payload = await requestJsonOrText(endpoint);
      const candidates = extractRecordingCandidates(payload);
      if (candidates.length) {
        log(`Found ${candidates.length} recording link(s) at ${endpoint}.`);
        return candidates;
      }
    } catch (error) {
      log(`No usable list at ${endpoint}: ${error.message}`);
    }
  }
  return [];
}

async function downloadRecordings() {
  setStatus("device", "Scanning", "");
  elements.downloadButton.disabled = true;
  try {
    const candidates = await discoverRecordingCandidates();
    if (!candidates.length) {
      throw new Error("No recordings were found. The recorder may use a different listing endpoint.");
    }

    let saved = 0;
    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      const url = new URL(candidate.url, DEVICE_BASE_URL).href;
      log(`Downloading ${url}`);
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`${url} returned ${response.status}`);
      const blob = await response.blob();
      const id = makeRecordingId(url, blob);
      const recording = {
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
      };
      await dbAction("readwrite", (store) => store.put(recording));
      saved += 1;
    }
    setStatus("device", "Downloaded", "ok");
    log(`Saved ${saved} recording(s).`);
    await refreshRecordings();
  } catch (error) {
    setStatus("device", "Failed", "error");
    log(`Download failed: ${error.message}`);
  } finally {
    elements.downloadButton.disabled = false;
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
    log("Web Bluetooth is not available in this browser. Use Chrome or Edge on HTTPS.");
    return;
  }

  try {
    log("Opening Bluetooth chooser for devices named CB08...");
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ namePrefix: "CB08" }],
      optionalServices: ["battery_service", "device_information"]
    });
    setStatus("wifi", "BLE connected", "");
    log(`Selected ${device.name || "CB08"}. Connecting to GATT...`);
    const server = await device.gatt.connect();
    const services = await server.getPrimaryServices();
    const discovered = [];

    for (const service of services) {
      const characteristics = await service.getCharacteristics();
      for (const characteristic of characteristics) {
        if (!characteristic.properties.read) continue;
        try {
          const value = await characteristic.readValue();
          const text = new TextDecoder().decode(value.buffer).replace(/\0/g, "").trim();
          if (text) discovered.push(text);
        } catch {
          // Some readable characteristics still reject reads depending on pairing state.
        }
      }
    }

    const combined = discovered.join("\n");
    const ssid = findValue(combined, /(ssid|hotspot|wifi)[\s:=]+([^\n\r,;]+)/i);
    const password = findValue(combined, /(pass|password|pwd)[\s:=]+([^\n\r,;]+)/i);
    if (ssid || password) {
      const hotspot = { ssid: ssid || "SonicApp recorder hotspot", password: password || "", discoveredAt: new Date().toISOString() };
      saveHotspot(hotspot);
      renderHotspotState();
      setStatus("wifi", "Hotspot found", "ok");
      log(`BLE discovery found hotspot details: ${ssid || "SSID unknown"}. Connect to it in system WiFi settings.`);
    } else {
      setStatus("wifi", "Manual connect", "");
      log("BLE connected, but no readable hotspot details were exposed. Connect to the recorder hotspot manually, then click I am connected.");
    }
  } catch (error) {
    setStatus("wifi", "BLE failed", "error");
    log(`BLE discovery failed: ${error.message}`);
  }
}

function findValue(text, regex) {
  const match = text.match(regex);
  return match?.[2]?.trim() || "";
}

async function pingDevice() {
  setStatus("wifi", "Checking", "");
  try {
    await fetch(DEVICE_BASE_URL, { cache: "no-store", mode: "no-cors" });
    setStatus("wifi", "Connected", "ok");
    log(`Browser reached ${DEVICE_BASE_URL}. You can download recordings now.`);
  } catch (error) {
    setStatus("wifi", "Unconfirmed", "error");
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

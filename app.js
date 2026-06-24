const SETTINGS_KEY = "sonicloud.settings.v2";
const HOTSPOT_KEY = "sonicloud.hotspot.v1";
const DB_NAME = "sonicloud-web";
const DB_VERSION = 1;
const RECORDING_STORE = "recordings";
const OPENAI_AUDIO_LIMIT = 25 * 1024 * 1024;

const BLE_SERVICE = "0000ae20-0000-1000-8000-00805f9b34fb";
const BLE_CHARACTERISTICS = [
  "0000ae21-0000-1000-8000-00805f9b34fb",
  "0000ae22-0000-1000-8000-00805f9b34fb",
  "0000ae23-0000-1000-8000-00805f9b34fb",
  "0000ae24-0000-1000-8000-00805f9b34fb"
];

const DEFAULT_SETTINGS = {
  baseUrl: "https://api.openai.com/v1",
  apiKey: "",
  transcriptionModel: "gpt-4o-transcribe-diarize",
  summaryModel: "gpt-5.5",
  contactList: [
    "* [Contact Name 1] - [Title/Role, e.g., Software Engineer]",
    "* [Contact Name 2] - [Title/Role, e.g., Project Manager]",
    "* [Contact Name 3] - [Title/Role, e.g., Mentor / Collaborator]",
    "* [Contact Name 4] - [Title/Role, e.g., Client / Stakeholder]"
  ].join("\n")
};

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const state = {
  db: null,
  settings: { ...DEFAULT_SETTINGS },
  recordings: [],
  selectedId: null,
  remoteFiles: [],
  hotspotName: localStorage.getItem(HOTSPOT_KEY) || "",
  forceSettings: false,
  ble: {
    device: null,
    server: null,
    service: null,
    characteristics: new Map(),
    writable: []
  },
  socket: null,
  socketUrl: "",
  currentDownload: null,
  logs: []
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  state.db = await openDatabase();
  state.settings = loadSettings();
  fillSettingsForm();
  await refreshRecordings();
  await registerServiceWorker();
  updateNetworkBadge();
  updateDevicePanel();
  renderRemoteFiles();
  renderRecordings();

  if (!settingsComplete()) {
    openSettings(true);
  }
}

function cacheElements() {
  Object.assign(els, {
    offlineBadge: document.querySelector("#offlineBadge"),
    settingsButton: document.querySelector("#settingsButton"),
    settingsDialog: document.querySelector("#settingsDialog"),
    settingsForm: document.querySelector("#settingsForm"),
    closeSettingsButton: document.querySelector("#closeSettingsButton"),
    resetSettingsButton: document.querySelector("#resetSettingsButton"),
    baseUrlInput: document.querySelector("#baseUrlInput"),
    apiKeyInput: document.querySelector("#apiKeyInput"),
    transcriptionModelInput: document.querySelector("#transcriptionModelInput"),
    summaryModelInput: document.querySelector("#summaryModelInput"),
    contactListInput: document.querySelector("#contactListInput"),
    connectBleButton: document.querySelector("#connectBleButton"),
    findHotspotButton: document.querySelector("#findHotspotButton"),
    wifiReadyButton: document.querySelector("#wifiReadyButton"),
    downloadAllButton: document.querySelector("#downloadAllButton"),
    fileImportInput: document.querySelector("#fileImportInput"),
    bleBadge: document.querySelector("#bleBadge"),
    bleStatus: document.querySelector("#bleStatus"),
    bleCharSelect: document.querySelector("#bleCharSelect"),
    hotspotName: document.querySelector("#hotspotName"),
    socketStatus: document.querySelector("#socketStatus"),
    remoteCount: document.querySelector("#remoteCount"),
    remoteFiles: document.querySelector("#remoteFiles"),
    customHexInput: document.querySelector("#customHexInput"),
    sendHexButton: document.querySelector("#sendHexButton"),
    customTextInput: document.querySelector("#customTextInput"),
    sendTextButton: document.querySelector("#sendTextButton"),
    clearLogButton: document.querySelector("#clearLogButton"),
    logOutput: document.querySelector("#logOutput"),
    recordingCount: document.querySelector("#recordingCount"),
    recordingList: document.querySelector("#recordingList"),
    detailPane: document.querySelector("#detailPane"),
    wifiDialog: document.querySelector("#wifiDialog"),
    wifiDialogText: document.querySelector("#wifiDialogText"),
    wifiDialogSsid: document.querySelector("#wifiDialogSsid"),
    confirmWifiButton: document.querySelector("#confirmWifiButton")
  });
}

function bindEvents() {
  els.settingsButton.addEventListener("click", () => openSettings(false));
  els.closeSettingsButton.addEventListener("click", closeSettings);
  els.resetSettingsButton.addEventListener("click", resetSettingsForm);
  els.settingsForm.addEventListener("submit", saveSettings);
  els.connectBleButton.addEventListener("click", connectBle);
  els.findHotspotButton.addEventListener("click", findHotspot);
  els.wifiReadyButton.addEventListener("click", confirmWifiReady);
  els.downloadAllButton.addEventListener("click", downloadAllNew);
  els.fileImportInput.addEventListener("change", importAudioFiles);
  els.sendHexButton.addEventListener("click", sendCustomHex);
  els.sendTextButton.addEventListener("click", sendCustomText);
  els.clearLogButton.addEventListener("click", () => {
    state.logs = [];
    renderLog();
  });
  els.wifiDialog.addEventListener("close", () => {
    if (els.wifiDialog.returnValue === "ready") {
      connectWifiSocket();
    }
  });
  window.addEventListener("online", updateNetworkBadge);
  window.addEventListener("offline", updateNetworkBadge);
}

async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) {
    setNetworkBadge("Offline cache unsupported");
    return;
  }

  try {
    await navigator.serviceWorker.register("./service-worker.js");
    setNetworkBadge(navigator.onLine ? "Offline-ready" : "Offline");
  } catch (error) {
    setNetworkBadge("Cache failed");
    logLine(`Service worker failed: ${error.message}`, "warn");
  }
}

function updateNetworkBadge() {
  setNetworkBadge(navigator.onLine ? "Offline-ready" : "Offline");
}

function setNetworkBadge(text) {
  els.offlineBadge.textContent = text;
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : { ...DEFAULT_SETTINGS };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function fillSettingsForm() {
  els.baseUrlInput.value = state.settings.baseUrl || DEFAULT_SETTINGS.baseUrl;
  els.apiKeyInput.value = state.settings.apiKey || "";
  els.transcriptionModelInput.value = state.settings.transcriptionModel || DEFAULT_SETTINGS.transcriptionModel;
  els.summaryModelInput.value = state.settings.summaryModel || DEFAULT_SETTINGS.summaryModel;
  els.contactListInput.value = state.settings.contactList || DEFAULT_SETTINGS.contactList;
}

function openSettings(force) {
  state.forceSettings = force;
  els.closeSettingsButton.disabled = force && !settingsComplete();
  fillSettingsForm();
  if (!els.settingsDialog.open) {
    els.settingsDialog.showModal();
  }
}

function closeSettings() {
  if (state.forceSettings && !settingsComplete()) {
    logLine("Save OpenAI settings before continuing.", "warn");
    return;
  }
  els.settingsDialog.close();
}

function resetSettingsForm() {
  localStorage.removeItem(SETTINGS_KEY);
  state.settings = { ...DEFAULT_SETTINGS };
  state.forceSettings = true;
  fillSettingsForm();
  els.closeSettingsButton.disabled = true;
  logLine("OpenAI settings cleared.");
}

function saveSettings(event) {
  event.preventDefault();
  const next = {
    baseUrl: normalizeBaseUrl(els.baseUrlInput.value),
    apiKey: els.apiKeyInput.value.trim(),
    transcriptionModel: els.transcriptionModelInput.value.trim(),
    summaryModel: els.summaryModelInput.value.trim(),
    contactList: els.contactListInput.value.trim() || DEFAULT_SETTINGS.contactList
  };

  if (!next.baseUrl || !next.apiKey || !next.transcriptionModel || !next.summaryModel) {
    logLine("Missing endpoint, key, transcription model, or summary model.", "warn");
    return;
  }

  state.settings = next;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  state.forceSettings = false;
  els.closeSettingsButton.disabled = false;
  els.settingsDialog.close();
  logLine("OpenAI settings saved.");
}

function settingsComplete() {
  return Boolean(
    state.settings.baseUrl &&
    state.settings.apiKey &&
    state.settings.transcriptionModel &&
    state.settings.summaryModel
  );
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(RECORDING_STORE)) {
        const store = db.createObjectStore(RECORDING_STORE, { keyPath: "id" });
        store.createIndex("downloadedAt", "downloadedAt");
        store.createIndex("name", "name");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getStore(mode = "readonly") {
  return state.db.transaction(RECORDING_STORE, mode).objectStore(RECORDING_STORE);
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function refreshRecordings() {
  state.recordings = await requestToPromise(getStore().getAll());
  state.recordings.sort((a, b) => String(b.downloadedAt || "").localeCompare(String(a.downloadedAt || "")));
}

async function saveRecording(recording) {
  await requestToPromise(getStore("readwrite").put(recording));
  await refreshRecordings();
  renderRecordings();
  if (state.selectedId === recording.id) {
    renderSelectedRecording();
  }
}

async function getRecording(id) {
  return requestToPromise(getStore().get(id));
}

async function deleteRecording(id) {
  await requestToPromise(getStore("readwrite").delete(id));
  if (state.selectedId === id) state.selectedId = null;
  await refreshRecordings();
  renderRecordings();
  renderSelectedRecording();
}

async function importAudioFiles(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  for (const file of files) {
    const recording = await buildRecordingFromBlob(file, {
      name: file.name,
      source: "manual import",
      time: file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString(),
      metadata: { imported: true, lastModified: file.lastModified || null }
    });
    await saveRecording(recording);
    logLine(`Imported ${file.name}.`);
  }
}

async function buildRecordingFromBlob(blob, info) {
  const hash = await sha256(blob);
  const name = info.name || `recording-${Date.now()}.wav`;
  const id = `${slugify(name)}-${blob.size}-${hash.slice(0, 16)}`;
  return {
    id,
    name,
    size: blob.size,
    time: info.time || new Date().toISOString(),
    source: info.source || "recorder",
    downloadedAt: new Date().toISOString(),
    metadata: info.metadata || {},
    mime: blob.type || guessMime(name),
    blob,
    sha256: hash,
    transcribed: false,
    summarized: false,
    transcriptText: "",
    transcriptSegments: [],
    transcriptRaw: null,
    summaryText: "",
    summaryAt: "",
    status: "saved"
  };
}

async function sha256(blob) {
  const buffer = await blob.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function renderRecordings() {
  els.recordingCount.textContent = `${state.recordings.length} saved`;

  if (!state.recordings.length) {
    els.recordingList.innerHTML = `<div class="empty-copy">No saved recordings yet.</div>`;
    return;
  }

  els.recordingList.innerHTML = state.recordings.map((recording) => `
    <button class="recording-item" type="button" data-id="${escapeAttr(recording.id)}" aria-current="${recording.id === state.selectedId}">
      <span>
        <span class="item-title">${escapeHtml(recording.name)}</span>
        <span class="item-meta">
          <span>${formatBytes(recording.size)}</span>
          <span>${escapeHtml(formatDate(recording.time || recording.downloadedAt))}</span>
          <span>${escapeHtml(recording.source || "recorder")}</span>
        </span>
      </span>
      <span class="item-flags">
        ${recording.transcribed ? `<span class="flag done">Transcribed</span>` : `<span class="flag">Audio</span>`}
        ${recording.summarized ? `<span class="flag done">Summary</span>` : ""}
      </span>
    </button>
  `).join("");

  els.recordingList.querySelectorAll("[data-id]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      renderRecordings();
      renderSelectedRecording();
    });
  });
}

async function renderSelectedRecording() {
  if (!state.selectedId) {
    els.detailPane.innerHTML = `
      <div class="empty-state">
        <img src="./icons/robot.svg" alt="">
        <h2>Select a recording</h2>
        <p>Saved audio, transcripts, and summaries stay in this browser.</p>
      </div>
    `;
    return;
  }

  const recording = await getRecording(state.selectedId);
  if (!recording) return;
  const audioUrl = recording.blob ? URL.createObjectURL(recording.blob) : "";
  const canTranscribe = Boolean(recording.blob);
  const canSummarize = Boolean(recording.transcriptText);

  els.detailPane.innerHTML = `
    <div class="detail-grid">
      <div class="detail-main">
        <div class="detail-title">
          <h2>${escapeHtml(recording.name)}</h2>
          <p>${escapeHtml(recording.source || "recorder")} - ${formatBytes(recording.size)} - ${escapeHtml(formatDate(recording.time || recording.downloadedAt))}</p>
        </div>
        ${audioUrl ? `<audio controls src="${audioUrl}"></audio>` : ""}
        <div class="detail-actions">
          <button id="transcribeButton" class="primary-action" type="button" ${canTranscribe ? "" : "disabled"}>Transcribe</button>
          <button id="summarizeButton" type="button" ${canSummarize ? "" : "disabled"}>Summarize</button>
          <button id="exportButton" type="button">Export JSON</button>
          <button id="deleteButton" type="button">Delete</button>
        </div>
        <section>
          <div class="panel-heading"><h3>Transcript</h3></div>
          <div class="text-output">${escapeHtml(formatTranscript(recording) || "No transcript yet.")}</div>
        </section>
      </div>
      <div class="detail-side">
        <section>
          <div class="panel-heading"><h3>Summary</h3></div>
          <div class="text-output summary-output">${recording.summaryText ? markdownToHtml(recording.summaryText) : "No summary yet."}</div>
        </section>
        <section>
          <div class="panel-heading"><h3>Metadata</h3></div>
          <pre class="text-output">${escapeHtml(JSON.stringify(stripBlob(recording), null, 2))}</pre>
        </section>
      </div>
    </div>
  `;

  els.detailPane.querySelector("#transcribeButton").addEventListener("click", () => transcribeSelected(recording.id));
  els.detailPane.querySelector("#summarizeButton").addEventListener("click", () => summarizeSelected(recording.id));
  els.detailPane.querySelector("#deleteButton").addEventListener("click", () => deleteRecording(recording.id));
  els.detailPane.querySelector("#exportButton").addEventListener("click", () => exportRecording(recording.id));
}

async function exportRecording(id) {
  const recording = await getRecording(id);
  const exportable = stripBlob(recording);
  const blob = new Blob([JSON.stringify(exportable, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${slugify(recording.name)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function stripBlob(recording) {
  const { blob, ...rest } = recording;
  return rest;
}

function formatTranscript(recording) {
  if (Array.isArray(recording.transcriptSegments) && recording.transcriptSegments.length) {
    return recording.transcriptSegments
      .map((segment) => `${segment.speaker || "Speaker"}: ${segment.text || ""}`.trim())
      .join("\n\n");
  }
  return recording.transcriptText || "";
}

async function connectBle() {
  if (!navigator.bluetooth) {
    logLine("Web Bluetooth is not available in this browser. Use Chrome or Edge on desktop/Android.", "warn");
    setBleState("bad", "Unsupported");
    return;
  }

  try {
    setBleState("warn", "Selecting");
    const device = await navigator.bluetooth.requestDevice({
      filters: [
        { namePrefix: "CB08" },
        { services: [BLE_SERVICE] }
      ],
      optionalServices: [BLE_SERVICE]
    });

    state.ble.device = device;
    device.addEventListener("gattserverdisconnected", onBleDisconnected);
    logLine(`Selected BLE device: ${device.name || device.id}`);

    setBleState("warn", "Connecting");
    state.ble.server = await device.gatt.connect();
    state.ble.service = await state.ble.server.getPrimaryService(BLE_SERVICE);
    state.ble.characteristics.clear();
    state.ble.writable = [];

    for (const uuid of BLE_CHARACTERISTICS) {
      try {
        const characteristic = await state.ble.service.getCharacteristic(uuid);
        state.ble.characteristics.set(shortUuid(uuid), characteristic);
        if (characteristic.properties.write || characteristic.properties.writeWithoutResponse) {
          state.ble.writable.push(characteristic);
        }
        if (characteristic.properties.notify || characteristic.properties.indicate) {
          await characteristic.startNotifications();
          characteristic.addEventListener("characteristicvaluechanged", (event) => {
            const bytes = new Uint8Array(event.target.value.buffer.slice(0));
            handleIncoming(bytes, `BLE ${shortUuid(uuid)}`);
          });
        }
        logLine(`BLE ${shortUuid(uuid)} ready: ${describeProperties(characteristic.properties)}`);
      } catch (error) {
        logLine(`BLE ${shortUuid(uuid)} unavailable: ${error.message}`, "warn");
      }
    }

    setBleState("ok", "Connected");
    updateDevicePanel();
    await sendBleProbe("enableWifi");
    await sleep(300);
    await sendBleProbe("wifi");
  } catch (error) {
    setBleState("bad", "Failed");
    logLine(`BLE connection failed: ${error.message}`, "error");
  }
}

function onBleDisconnected() {
  setBleState("bad", "Disconnected");
  state.ble.server = null;
  state.ble.service = null;
  state.ble.characteristics.clear();
  state.ble.writable = [];
  updateDevicePanel();
  logLine("BLE device disconnected.", "warn");
}

function setBleState(stateName, label) {
  els.bleBadge.dataset.state = stateName;
  els.bleBadge.textContent = label;
  els.bleStatus.textContent = label;
}

function updateDevicePanel() {
  const name = state.ble.device?.name || state.ble.device?.id || "Not connected";
  els.bleStatus.textContent = state.ble.server?.connected ? name : "Not connected";
  els.hotspotName.textContent = state.hotspotName || "Unknown";
  els.socketStatus.textContent = state.socket?.readyState === WebSocket.OPEN ? `Open ${state.socketUrl}` : "Closed";

  const selected = els.bleCharSelect.value;
  const options = [`<option value="auto">Auto writable</option>`].concat(
    state.ble.writable.map((char) => `<option value="${shortUuid(char.uuid)}">${shortUuid(char.uuid)}</option>`)
  );
  els.bleCharSelect.innerHTML = options.join("");
  if ([...els.bleCharSelect.options].some((option) => option.value === selected)) {
    els.bleCharSelect.value = selected;
  }
}

async function findHotspot() {
  if (state.hotspotName) {
    openWifiDialog(state.hotspotName);
    return;
  }

  if (!state.ble.server?.connected) {
    await connectBle();
  }
  if (!state.ble.server?.connected) return;

  logLine("Sending fast-transfer and Wi-Fi state probes over BLE.");
  await sendBleProbe("enableWifi");
  await sleep(300);
  await sendBleProbe("wifi");
  window.setTimeout(() => {
    if (state.hotspotName) openWifiDialog(state.hotspotName);
    else logLine("No Wi-Fi name seen yet. Watch BLE notifications or enter a known SSID in the lab.", "warn");
  }, 1400);
}

async function confirmWifiReady() {
  if (state.hotspotName) {
    openWifiDialog(state.hotspotName);
  } else {
    openWifiDialog("Recorder hotspot");
  }
}

function openWifiDialog(ssid) {
  els.wifiDialogSsid.textContent = ssid;
  els.wifiDialogText.textContent = "Switch your computer or phone to this recorder hotspot, then return here.";
  if (!els.wifiDialog.open) els.wifiDialog.showModal();
}

async function sendBleProbe(kind) {
  const probes = {
    wifi: [
      { label: "method getDeviceWiFiState", bytes: encodeText("getDeviceWiFiState") },
      { label: "json cmd 12", bytes: encodeText(JSON.stringify({ cmd: "12" })) },
      { label: "json method getDeviceWiFiState", bytes: encodeText(JSON.stringify({ cmd: "getDeviceWiFiState" })) },
      { label: "byte 0x12", bytes: new Uint8Array([0x12]) }
    ],
    enableWifi: [
      { label: "method connectDeviceWiFi", bytes: encodeText("connectDeviceWiFi") },
      { label: "json method connectDeviceWiFi", bytes: encodeText(JSON.stringify({ cmd: "connectDeviceWiFi" })) },
      { label: "json cmd 13", bytes: encodeText(JSON.stringify({ cmd: "13" })) }
    ],
    files: [
      { label: "method getRecordFileList", bytes: encodeText("getRecordFileList") },
      { label: "json method getRecordFileList", bytes: encodeText(JSON.stringify({ cmd: "getRecordFileList" })) },
      { label: "json cmd 4", bytes: encodeText(JSON.stringify({ cmd: "4" })) }
    ]
  };

  for (const probe of probes[kind] || []) {
    await sendBleBytes(probe.bytes, probe.label);
    await sleep(220);
  }
}

async function sendBleBytes(bytes, label = "custom") {
  if (!state.ble.writable.length) {
    logLine("No writable BLE characteristic is available.", "warn");
    return;
  }

  const selected = els.bleCharSelect.value;
  const targets = selected && selected !== "auto"
    ? state.ble.writable.filter((char) => shortUuid(char.uuid) === selected)
    : [state.ble.writable[0]];

  for (const characteristic of targets) {
    if (characteristic.properties.writeWithoutResponse && characteristic.writeValueWithoutResponse) {
      await characteristic.writeValueWithoutResponse(bytes);
    } else {
      await characteristic.writeValue(bytes);
    }
    logLine(`BLE -> ${shortUuid(characteristic.uuid)} ${label}: ${hexPreview(bytes)}`);
  }
}

function sendCustomHex() {
  const raw = els.customHexInput.value.trim();
  if (!raw) return;
  try {
    const bytes = parseHex(raw);
    sendBleBytes(bytes, "custom hex");
  } catch (error) {
    logLine(error.message, "warn");
  }
}

function sendCustomText() {
  const raw = els.customTextInput.value;
  if (!raw) return;
  sendBleBytes(encodeText(raw), "custom text");
  if (state.socket?.readyState === WebSocket.OPEN) {
    state.socket.send(raw);
    logLine(`WS -> text: ${raw}`);
  }
}

async function connectWifiSocket() {
  closeSocket();
  const endpoints = ["ws://192.168.1.1:27689", "wss://192.168.1.1:27689"];

  for (const endpoint of endpoints) {
    try {
      logLine(`Opening ${endpoint}`);
      await openSocket(endpoint);
      state.socketUrl = endpoint;
      updateDevicePanel();
      requestFileList();
      return;
    } catch (error) {
      logLine(`${endpoint} failed: ${error.message}`, "warn");
    }
  }

  updateDevicePanel();
  logLine("Could not open recorder WebSocket. On HTTPS GitHub Pages, the browser may block ws:// local-device traffic.", "error");
}

function openSocket(endpoint) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const socket = new WebSocket(endpoint);
    socket.binaryType = "arraybuffer";
    const timeout = window.setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.close();
        reject(new Error("timeout"));
      }
    }, 4500);

    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      state.socket = socket;
      logLine(`WebSocket open: ${endpoint}`);
      resolve(socket);
    });

    socket.addEventListener("message", (event) => handleIncoming(event.data, "WS"));
    socket.addEventListener("close", () => {
      if (state.socket === socket) {
        state.socket = null;
        updateDevicePanel();
      }
      logLine(`WebSocket closed: ${endpoint}`, "warn");
    });
    socket.addEventListener("error", () => {
      if (!settled) {
        settled = true;
        window.clearTimeout(timeout);
        reject(new Error("socket error"));
      }
    });
  });
}

function closeSocket() {
  if (state.socket) {
    state.socket.close();
    state.socket = null;
  }
  state.socketUrl = "";
  updateDevicePanel();
}

function requestFileList() {
  if (state.socket?.readyState === WebSocket.OPEN) {
    const messages = [
      { cmd: "getRecordFileList" },
      { cmd: "4" },
      { action: "getRecordFileList" },
      "getRecordFileList"
    ];
    for (const message of messages) {
      sendSocketMessage(message);
    }
  }
  if (state.ble.server?.connected) {
    sendBleProbe("files");
  }
}

function sendSocketMessage(message) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) return;
  const payload = typeof message === "string" ? message : JSON.stringify(message);
  state.socket.send(payload);
  logLine(`WS -> ${payload}`);
}

async function downloadAllNew() {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    await connectWifiSocket();
  } else {
    requestFileList();
  }

  await sleep(1200);
  if (!state.remoteFiles.length) {
    logLine("No recorder file list has been decoded yet.", "warn");
    return;
  }

  for (const file of state.remoteFiles) {
    const exists = state.recordings.some((recording) => {
      return recording.name === file.name && Number(recording.size || 0) === Number(file.size || 0);
    });
    if (exists) {
      logLine(`Skipping saved file: ${file.name}`);
      continue;
    }
    await downloadRemoteFile(file);
  }
}

function downloadRemoteFile(file) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    logLine("Recorder WebSocket is not connected.", "warn");
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const download = {
      file,
      chunks: [],
      received: 0,
      resolve,
      idleTimer: null,
      timeout: null
    };
    state.currentDownload = download;

    download.timeout = window.setTimeout(() => {
      if (state.currentDownload === download) {
        state.currentDownload = null;
        logLine(`No file bytes received for ${file.name}.`, "warn");
        resolve();
      }
    }, 20000);

    const messages = [
      { cmd: "startGetFileByFrom", fileName: file.name, offset: 0, isNew: true },
      { cmd: "startGetFileByFromToEnd", fileName: file.name, offset: 0, end: file.size || 0, isNew: true },
      { action: "download", fileName: file.name, offset: 0 },
      `startGetFileByFrom ${file.name}`
    ];
    for (const message of messages) {
      sendSocketMessage(message);
    }
    logLine(`Requested recorder file: ${file.name}`);
  });
}

function addDownloadChunk(bytes) {
  const download = state.currentDownload;
  if (!download) return false;
  download.chunks.push(bytes);
  download.received += bytes.byteLength;

  if (download.idleTimer) window.clearTimeout(download.idleTimer);
  download.idleTimer = window.setTimeout(() => finishCurrentDownload("idle"), 1400);
  logLine(`Receiving ${download.file.name}: ${formatBytes(download.received)}`);
  return true;
}

async function finishCurrentDownload(reason) {
  const download = state.currentDownload;
  if (!download) return;
  state.currentDownload = null;
  window.clearTimeout(download.timeout);
  window.clearTimeout(download.idleTimer);

  if (!download.chunks.length) {
    download.resolve();
    return;
  }

  const blob = new Blob(download.chunks, { type: guessMime(download.file.name) });
  const recording = await buildRecordingFromBlob(blob, {
    name: download.file.name,
    source: "recorder Wi-Fi",
    time: download.file.time || new Date().toISOString(),
    metadata: { remoteFile: download.file, finishReason: reason }
  });
  await saveRecording(recording);
  logLine(`Saved ${download.file.name} (${formatBytes(blob.size)}).`);
  download.resolve();
}

function handleIncoming(data, source) {
  if (data instanceof ArrayBuffer) {
    const bytes = new Uint8Array(data);
    if (addDownloadChunk(bytes)) return;
    logLine(`${source} <- binary ${formatBytes(bytes.byteLength)} ${hexPreview(bytes)}`);
    tryParseIncomingText(textDecoder.decode(bytes), source);
    return;
  }

  if (data instanceof Uint8Array) {
    logLine(`${source} <- ${hexPreview(data)} ${printablePreview(data)}`);
    tryParseIncomingText(textDecoder.decode(data), source);
    return;
  }

  if (typeof data === "string") {
    logLine(`${source} <- ${data.slice(0, 500)}`);
    tryParseIncomingText(data, source);
  }
}

function tryParseIncomingText(text, source) {
  const trimmed = text.trim();
  if (!trimmed) return;

  const ssid = extractSsid(trimmed);
  if (ssid) setHotspotName(ssid);

  const parsed = parseJsonLoose(trimmed);
  if (parsed) {
    handleRecorderMessage(parsed, source);
  }
}

function handleRecorderMessage(message, source) {
  if (Array.isArray(message)) {
    absorbRemoteFiles(message, source);
    return;
  }

  const data = message.data ?? message.result ?? message.payload ?? null;
  if (data && typeof data === "object") {
    if (typeof data.wifiName === "string" && data.wifiName.trim()) {
      setHotspotName(data.wifiName.trim());
      openWifiDialog(data.wifiName.trim());
    }

    if (Array.isArray(data)) {
      absorbRemoteFiles(data, source);
    } else if (Array.isArray(data.files) || Array.isArray(data.records) || Array.isArray(data.recordings)) {
      absorbRemoteFiles(data.files || data.records || data.recordings, source);
    }

    const base64 = data.fileData || data.audio || data.chunk || data.base64;
    if (typeof base64 === "string" && state.currentDownload) {
      addDownloadChunk(base64ToBytes(base64));
    }

    const progress = Number(data.progress);
    if (state.currentDownload && Number.isFinite(progress) && progress >= 100) {
      finishCurrentDownload("progress");
    }
  }

  if (Array.isArray(message.files) || Array.isArray(message.records) || Array.isArray(message.recordings)) {
    absorbRemoteFiles(message.files || message.records || message.recordings, source);
  }
}

function absorbRemoteFiles(items, source) {
  const normalized = items.map(normalizeRemoteFile).filter(Boolean);
  if (!normalized.length) return;

  const map = new Map(state.remoteFiles.map((file) => [remoteFileKey(file), file]));
  for (const file of normalized) map.set(remoteFileKey(file), file);
  state.remoteFiles = Array.from(map.values()).sort((a, b) => String(b.time || "").localeCompare(String(a.time || "")));
  renderRemoteFiles();
  logLine(`Decoded ${normalized.length} recorder file(s) from ${source}.`);
}

function normalizeRemoteFile(item) {
  if (!item || typeof item !== "object") return null;
  const name = item.name || item.recordName || item.fileName || item.path;
  if (!name) return null;
  return {
    name: String(name),
    size: Number(item.size || item.fileLength || item.length || item.bytes || 0),
    time: item.time || item.date || item.createdAt || item.recordTime || "",
    raw: item
  };
}

function renderRemoteFiles() {
  els.remoteCount.textContent = `${state.remoteFiles.length} found`;
  if (!state.remoteFiles.length) {
    els.remoteFiles.innerHTML = `<div class="empty-copy">No recorder list decoded.</div>`;
    return;
  }

  els.remoteFiles.innerHTML = state.remoteFiles.map((file) => `
    <button class="remote-item" type="button" data-name="${escapeAttr(file.name)}">
      <span>
        <span class="item-title">${escapeHtml(file.name)}</span>
        <span class="item-meta">
          <span>${formatBytes(file.size)}</span>
          <span>${escapeHtml(formatDate(file.time))}</span>
        </span>
      </span>
      <span class="item-flags"><span class="flag progress">Remote</span></span>
    </button>
  `).join("");

  els.remoteFiles.querySelectorAll("[data-name]").forEach((button) => {
    button.addEventListener("click", () => {
      const file = state.remoteFiles.find((entry) => entry.name === button.dataset.name);
      if (file) downloadRemoteFile(file);
    });
  });
}

async function transcribeSelected(id) {
  if (!settingsComplete()) {
    openSettings(true);
    return;
  }

  const recording = await getRecording(id);
  if (!recording?.blob) return;
  if (recording.blob.size > OPENAI_AUDIO_LIMIT) {
    logLine(`OpenAI file uploads are limited to 25 MB. ${recording.name} is ${formatBytes(recording.blob.size)}.`, "warn");
    return;
  }

  try {
    logLine(`Transcribing ${recording.name} with ${state.settings.transcriptionModel}.`);
    recording.status = "transcribing";
    await saveRecording(recording);

    const form = new FormData();
    const filename = ensureAudioExtension(recording.name, recording.mime);
    form.append("file", new File([recording.blob], filename, { type: recording.mime || guessMime(filename) }));
    form.append("model", state.settings.transcriptionModel);
    form.append("response_format", state.settings.transcriptionModel.includes("diarize") ? "diarized_json" : "json");

    const response = await fetch(apiEndpoint("audio/transcriptions"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${state.settings.apiKey}`
      },
      body: form
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const raw = await response.json();
    const normalized = normalizeTranscriptResponse(raw);
    recording.transcribed = true;
    recording.status = "transcribed";
    recording.transcriptRaw = raw;
    recording.transcriptText = normalized.text;
    recording.transcriptSegments = normalized.segments;
    await saveRecording(recording);
    logLine(`Transcribed ${recording.name}.`);
  } catch (error) {
    const latest = await getRecording(id);
    if (latest) {
      latest.status = "transcription failed";
      await saveRecording(latest);
    }
    logLine(`Transcription failed: ${error.message}`, "error");
  }
}

function normalizeTranscriptResponse(raw) {
  const text = raw.text || raw.transcript || "";
  const candidateSegments = raw.segments || raw.speaker_segments || raw.diarization || [];
  const segments = Array.isArray(candidateSegments)
    ? candidateSegments.map((segment, index) => ({
      speaker: normalizeSpeaker(segment.speaker || segment.speaker_label || segment.label || segment.channel || `Person ${index + 1}`),
      text: segment.text || segment.transcript || segment.word || "",
      start: segment.start ?? segment.start_time ?? null,
      end: segment.end ?? segment.end_time ?? null
    })).filter((segment) => segment.text)
    : [];

  if (segments.length) {
    return {
      text: segments.map((segment) => `${segment.speaker}: ${segment.text}`).join("\n\n"),
      segments
    };
  }

  return { text, segments: text ? [{ speaker: "Person 1", text }] : [] };
}

function normalizeSpeaker(value) {
  const text = String(value || "").trim();
  if (!text) return "Person";
  if (/^speaker[_\s-]?\d+$/i.test(text)) {
    const number = text.match(/\d+/)?.[0] || "";
    return `Person ${number}`;
  }
  return text;
}

async function summarizeSelected(id) {
  if (!settingsComplete()) {
    openSettings(true);
    return;
  }

  const recording = await getRecording(id);
  if (!recording?.transcriptText) return;

  try {
    logLine(`Summarizing ${recording.name} with ${state.settings.summaryModel}.`);
    recording.status = "summarizing";
    await saveRecording(recording);

    const prompt = buildSummaryPrompt(recording.transcriptText, state.settings.contactList);
    const summary = await createSummary(prompt);
    recording.summaryText = summary;
    recording.summaryAt = new Date().toISOString();
    recording.summarized = true;
    recording.status = "summarized";
    await saveRecording(recording);
    logLine(`Summary saved for ${recording.name}.`);
  } catch (error) {
    const latest = await getRecording(id);
    if (latest) {
      latest.status = "summary failed";
      await saveRecording(latest);
    }
    logLine(`Summary failed: ${error.message}`, "error");
  }
}

async function createSummary(prompt) {
  const responsesPayload = {
    model: state.settings.summaryModel,
    input: [
      { role: "system", content: prompt },
      { role: "user", content: "Generate the structured business summary now." }
    ]
  };

  const responses = await fetch(apiEndpoint("responses"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify(responsesPayload)
  });

  if (responses.ok) {
    return extractText(await responses.json());
  }

  if (![404, 405].includes(responses.status)) {
    throw new Error(await responses.text());
  }

  const chat = await fetch(apiEndpoint("chat/completions"), {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({
      model: state.settings.summaryModel,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: "Generate the structured business summary now." }
      ]
    })
  });

  if (!chat.ok) throw new Error(await chat.text());
  return extractText(await chat.json());
}

function jsonHeaders() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.settings.apiKey}`
  };
}

function apiEndpoint(path) {
  return `${normalizeBaseUrl(state.settings.baseUrl)}/${path.replace(/^\/+/, "")}`;
}

function extractText(payload) {
  if (payload.output_text) return payload.output_text;
  if (payload.choices?.[0]?.message?.content) return payload.choices[0].message.content;
  if (Array.isArray(payload.output)) {
    return payload.output.flatMap((item) => {
      if (Array.isArray(item.content)) {
        return item.content.map((part) => part.text || part.output_text || "").filter(Boolean);
      }
      return item.text || "";
    }).filter(Boolean).join("\n");
  }
  return JSON.stringify(payload, null, 2);
}

function buildSummaryPrompt(transcriptionText, contactList) {
  return `## System Role & Objective
You are an expert executive assistant and business analyst. Your task is to analyze the provided meeting transcription between "Person 1" and "Person 2", mapping their true identities using the provided Contact List where possible, and extract a comprehensive, structured business summary.

## Contextual Data

### 1. Business Contact List (Reference)
The following people are common business contacts. Use this list to infer or explicitly map who "Person 1" and "Person 2" actually are based on context clues, names mentioned, or conversational topics:
${contactList || DEFAULT_SETTINGS.contactList}

### 2. Meeting Transcription to Analyze
"""
${transcriptionText}
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
}

function parseJsonLoose(text) {
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

function extractSsid(text) {
  const jsonLike = text.match(/"wifiName"\s*:\s*"([^"]+)"/i);
  if (jsonLike) return jsonLike[1];
  const named = text.match(/(?:ssid|wifi|wifiName)\s*[:=]\s*([A-Za-z0-9_. -]{3,64})/i);
  if (named) return named[1].trim();
  const cb08 = text.match(/\bCB08[A-Za-z0-9_.-]{0,48}\b/);
  return cb08 ? cb08[0] : "";
}

function setHotspotName(name) {
  state.hotspotName = name;
  localStorage.setItem(HOTSPOT_KEY, name);
  updateDevicePanel();
  logLine(`Recorder hotspot: ${name}`);
}

function encodeText(text) {
  return textEncoder.encode(text);
}

function parseHex(value) {
  const clean = value.replace(/0x/gi, "").replace(/[^a-fA-F0-9]/g, "");
  if (!clean || clean.length % 2) {
    throw new Error("Enter complete hex bytes.");
  }
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function base64ToBytes(value) {
  const binary = atob(value.replace(/^data:.*?;base64,/, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function describeProperties(properties) {
  return [
    properties.read ? "read" : "",
    properties.write ? "write" : "",
    properties.writeWithoutResponse ? "write-no-response" : "",
    properties.notify ? "notify" : "",
    properties.indicate ? "indicate" : ""
  ].filter(Boolean).join(", ") || "unknown";
}

function shortUuid(uuid) {
  const match = String(uuid).match(/0000(ae2[0-4])-0000/i);
  return match ? match[1].toUpperCase() : String(uuid).slice(0, 8).toUpperCase();
}

function remoteFileKey(file) {
  return `${file.name}|${file.size || 0}|${file.time || ""}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unit]}`;
}

function formatDate(value) {
  if (!value) return "Unknown time";
  const number = Number(value);
  const date = Number.isFinite(number) && String(value).length <= 10
    ? new Date(number * 1000)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString();
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "recording";
}

function guessMime(name) {
  const lower = String(name || "").toLowerCase();
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a")) return "audio/mp4";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".opus")) return "audio/ogg";
  if (lower.endsWith(".wav")) return "audio/wav";
  return "audio/wav";
}

function ensureAudioExtension(name, mime) {
  if (/\.(mp3|mp4|mpeg|mpga|m4a|wav|webm)$/i.test(name)) return name;
  if (mime === "audio/mpeg") return `${name}.mp3`;
  if (mime === "audio/webm") return `${name}.webm`;
  if (mime === "audio/mp4") return `${name}.m4a`;
  return `${name}.wav`;
}

function hexPreview(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const hex = Array.from(view.slice(0, 48)).map((byte) => byte.toString(16).padStart(2, "0")).join(" ");
  return view.length > 48 ? `${hex} ...` : hex;
}

function printablePreview(bytes) {
  const text = textDecoder.decode(bytes).replace(/[^\x20-\x7E]+/g, " ").trim();
  return text ? `"${text.slice(0, 120)}"` : "";
}

function logLine(message, level = "info") {
  const stamp = new Date().toLocaleTimeString();
  const prefix = level === "error" ? "ERR" : level === "warn" ? "WARN" : "INFO";
  state.logs.push(`[${stamp}] ${prefix} ${message}`);
  state.logs = state.logs.slice(-220);
  renderLog();
}

function renderLog() {
  els.logOutput.textContent = state.logs.join("\n");
  els.logOutput.scrollTop = els.logOutput.scrollHeight;
}

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  let html = "";
  let list = "";

  const closeList = () => {
    if (list) {
      html += `</${list}>`;
      list = "";
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      closeList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      closeList();
      const level = heading[1].length === 1 ? 2 : heading[1].length;
      html += `<h${level}>${inlineMarkdown(heading[2])}</h${level}>`;
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (list !== "ul") {
        closeList();
        html += "<ul>";
        list = "ul";
      }
      html += `<li>${inlineMarkdown(bullet[1])}</li>`;
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (list !== "ol") {
        closeList();
        html += "<ol>";
        list = "ol";
      }
      html += `<li>${inlineMarkdown(numbered[1])}</li>`;
      continue;
    }

    closeList();
    html += `<p>${inlineMarkdown(trimmed)}</p>`;
  }

  closeList();
  return html || "No summary yet.";
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>");
}

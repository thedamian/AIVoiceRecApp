# SoniCloud Device File Download Process

SoniCloud (bundle ID `com.voiceicloud`, native app name 声云语音转写) downloads recordings from the recorder pen using a two-phase protocol: BLE to retrieve WiFi hotspot credentials, then a WebSocket connection over the hotspot to list and stream audio files.

---

## Phase 1 — BLE Discovery (get hotspot credentials)

The device advertises itself under the name prefix **`CB08`**.

1. The app opens a Bluetooth device picker filtered to devices named `CB08`.
2. User selects the recorder from the picker (browser always shows this step — it cannot be skipped).
3. App connects to the GATT server on the device.
4. App enumerates the primary BLE service:
   - **Service UUID:** `0000ae20-0000-1000-8000-00805f9b34fb`
5. App discovers four vendor characteristics under that service:
   - `0000ae21-0000-1000-8000-00805f9b34fb`
   - `0000ae22-0000-1000-8000-00805f9b34fb`
   - `0000ae23-0000-1000-8000-00805f9b34fb`
   - `0000ae24-0000-1000-8000-00805f9b34fb`
6. App subscribes to notify/indicate characteristics to receive async responses.
7. App reads any readable characteristics to collect any static hotspot info the device publishes.
8. App writes WiFi-probe commands to any writable characteristics:
   - `{"cmd":"12"}`
   - `{"cmd":"getWiFiHotspotState"}`
   - `{"cmd":"getDeviceWiFiState"}`
   - `{"cmd":"connectDeviceWiFi"}`
   - Plain strings: `getWiFiHotspotState`, `getDeviceWiFiState`, `connectDeviceWiFi`
9. The device replies via BLE notification with a JSON payload that includes the hotspot SSID and password:
   ```json
   {"data": {"wifiName": "<SSID>", "password": "<password>"}}
   ```
   The app also accepts the fields `ssid`, `hotspot`, `wifi`, `pass`, `pwd`, and `wifiPassword`.

---

## Phase 2 — WiFi Hotspot Connection (manual)

BLE tells the app the hotspot credentials but **cannot switch WiFi automatically** — the user must do this in system settings.

1. App displays the discovered SSID and password in a dialog.
2. User opens **System Settings → WiFi** and connects to the recorder's hotspot.
   - The recorder's hotspot gateway is always **`192.168.1.1`**.
   - Once connected, there is no internet access — the app shell must already be cached (see Phase 5).
3. User returns to the app and clicks **"I am connected"**.
4. App pings `http://192.168.1.1` (no-cors) to confirm the connection is live.

---

## Phase 3 — File Discovery over WebSocket

The primary protocol observed in the SoniCloud native app uses a **WebSocket on port 27689**.

**WebSocket endpoint:** `ws://192.168.1.1:27689`

1. App opens a WebSocket connection to `ws://192.168.1.1:27689`.
2. App sends the following file-list probe commands (all JSON):
   ```json
   {"cmd": "4"}
   {"cmd": "3"}
   {"cmd": "2"}
   {"cmd": "1"}
   {"cmd": "getRecordFileList"}
   ```
3. Device responds with a JSON payload listing available recordings. The native SoniCloud app method name for the response handler is **`backRecordFileJson`** / **`record_file_state`**. Example response shape:
   ```json
   {"cmd": "...", "state": "...", "data": {"record_state": "...", "path": "...", "json": [...]}}
   ```
4. App walks the JSON tree to extract audio file entries by looking for fields: `path`, `file`, `url`, `href`, `filename`, `name`, `recordName`.

**HTTP fallback (if WebSocket is unavailable):**

App tries each endpoint in order until it gets a usable list:
- `/api/recordings`
- `/api/files`
- `/api/audio`
- `/recordings`
- `/files`
- `/list`
- `/`

Responses may be JSON arrays/objects or HTML pages with `<a href>` links. Accepted audio extensions: `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.flac`, `.webm`.

---

## Phase 4 — File Transfer

### WebSocket transfer (primary — for files discovered via WebSocket)

1. App opens a new WebSocket to `ws://192.168.1.1:27689`.
2. App sends the transfer command (all three variants are tried):
   ```json
   {"cmd": "5", "path": "<filename>"}
   {"cmd": "5", "data": {"path": "<filename>"}}
   {"cmd": "download", "path": "<filename>"}
   ```
   Command `"5"` is the transfer command observed in the SoniCloud native app (`DeviceWiFiSocket`).
3. Device streams the audio file as **binary `arraybuffer` WebSocket messages** (chunks).
4. App accumulates all binary chunks into a Blob.
5. Transfer is considered complete when any of:
   - A JSON status frame arrives with `progress >= 100` (and at least one binary chunk has been received).
   - No binary chunk arrives for **1.2 seconds** after the last chunk.
   - The WebSocket closes.

### HTTP transfer (fallback — for files discovered via HTTP)

Simple `fetch(url, { cache: "no-store" })` against `http://192.168.1.1/<path>`.

> **Browser constraint:** Direct downloads from the insecure `http://192.168.1.1` device are blocked when the app is served from HTTPS (mixed content / Private Network Access rules). The WebSocket path (`ws://`) has the same restriction. The app must be loaded from `http://` or `localhost`, or the recorder firmware must support HTTPS with valid CORS headers for the app's origin.

---

## Phase 5 — PWA Offline Cache (prerequisite before hotspot switch)

Because the recorder hotspot has no internet, the app shell must be cached **before** switching WiFi.

1. Load the app from its HTTPS GitHub Pages URL while on a normal internet connection.
2. Wait for the **"Offline ready"** badge to appear (service worker has cached the shell).
3. Now it is safe to switch WiFi to the recorder hotspot — the UI will continue to work from cache.

AI transcription and summarization still require internet (they call an external OpenAI-compatible API), so those steps must be done after switching back.

---

## Phase 6 — Local Storage

Downloaded recordings are stored in **IndexedDB** (`sonicapp-recordings` database, `recordings` object store). Each entry includes:

| Field | Description |
|---|---|
| `id` | Derived from source URL + blob size |
| `name` | Filename from the recorder |
| `sourceUrl` | Full URL or `manual-import` |
| `date` | Recording timestamp (if provided by device) |
| `blob` | Raw audio Blob |
| `downloadedAt` | ISO timestamp of download |
| `transcript` | Populated after transcription |
| `summary` | Populated after summarization |

---

## Key Protocol Constants (from the installed SoniCloud app)

| Constant | Value |
|---|---|
| Device base URL | `http://192.168.1.1` |
| WebSocket URL | `ws://192.168.1.1:27689` |
| BLE service UUID | `0000ae20-0000-1000-8000-00805f9b34fb` |
| BLE characteristics | `0000ae21` – `0000ae24` (vendor, suffix `…-0000-1000-8000-00805f9b34fb`) |
| BLE device name prefix | `CB08` |
| File list command | `{"cmd":"getRecordFileList"}` or `{"cmd":"1"}` – `{"cmd":"4"}` |
| File transfer command | `{"cmd":"5","path":"<file>"}` |
| Record state message | `{"cmd":"...","state":"...","data":{"record_state":"...","path":"..."}}` |
| Native socket class | `DeviceWiFiSocket` |
| Native file-list method | `getRecordFileList` / `backRecordFileJson` |

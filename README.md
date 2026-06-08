# SonicApp Recorder Sync

A static GitHub Pages app for downloading AI recorder audio from the SonicApp recorder hotspot, transcribing it with an OpenAI-compatible audio transcription model, and summarizing the transcript with an OpenAI-compatible chat model.

## Files

- `index.html` - app shell
- `styles.css` - responsive UI
- `app.js` - localStorage settings, IndexedDB recording library, Web Bluetooth discovery, recorder downloads, transcription, and summary calls
- `manifest.webmanifest` - Progressive Web App manifest
- `service-worker.js` - offline app shell cache
- `icons/` - robot app icons

## Hosting

Publish these files with GitHub Pages. No backend or build step is required.

## Progressive Web App

The app registers a service worker and caches the app shell, stylesheet, JavaScript, manifest, and robot icons. Load the GitHub Pages site once while online and wait for the "Offline ready" badge before switching WiFi to the recorder hotspot.

Recordings, transcripts, summaries, AI settings, and discovered hotspot details are already local-first through IndexedDB and localStorage.

AI transcription and summarization still require network access to the configured OpenAI-compatible base URL. The offline cache keeps the UI available while you are on the recorder hotspot; it does not make external AI APIs available without internet.

## Browser constraints

- Web Bluetooth requires HTTPS and a compatible browser such as Chrome or Edge. The browser will always show a device picker; a website cannot silently connect to BLE.
- WiFi switching cannot be automated by a browser. The app can try BLE discovery for a device named `CB08`, but the user still has to connect to the hotspot in system WiFi settings.
- GitHub Pages is served over HTTPS. If the recorder only serves `http://192.168.1.1`, browsers may block direct downloads as mixed content or Private Network Access. Direct downloads work best when the recorder supports HTTPS and sends CORS headers for the GitHub Pages origin.
- If direct downloads are blocked, use the in-app manual audio import fallback after exporting or downloading recordings another way.
- The recorder must allow browser requests from the GitHub Pages origin. If `192.168.1.1` does not send CORS headers, direct `fetch` downloads may be blocked by the browser.
- Because there is no backend, the AI API key is stored in localStorage and used directly in browser requests. Use a scoped key or a compatible gateway if possible.

## Recorder discovery

The app tries these endpoints on `http://192.168.1.1`:

It first probes the recorder protocol found in the installed SoniCloud app:

- WebSocket: `ws://192.168.1.1:27689`
- Observed native app methods/strings: `DeviceWiFiSocket`, `getRecordFileList`, `backRecordFileJson`, `record_file_state`, and transfer command `"cmd":"5"`

Then it falls back to HTTP discovery:

- `/api/recordings`
- `/api/files`
- `/api/audio`
- `/recordings`
- `/files`
- `/list`
- `/`

It accepts JSON lists or HTML pages that link to audio files with common extensions such as `.wav`, `.mp3`, `.m4a`, `.aac`, `.ogg`, `.flac`, and `.webm`.

If the recorder uses a different API, update `RECORDING_ENDPOINTS` or `extractRecordingCandidates()` in `app.js`.

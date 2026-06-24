# SoniCloud Web

Static GitHub Pages PWA for working with a SoniCloud-style AI recorder.

The app stores OpenAI-compatible API settings in `localStorage` and recordings,
transcripts, and summaries in IndexedDB. It uses Web Bluetooth for the recorder
BLE service discovered in SoniCloud.app:

- Service: `0000AE20-0000-1000-8000-00805F9B34FB`
- Characteristics: `AE21`, `AE22`, `AE23`, `AE24`
- Fast-transfer host: `192.168.1.1:27689`

The original SoniCloud app uses native Bluetooth and a SocketRocket WebSocket.
This web version exposes protocol diagnostics because the exact binary command
payloads still need to be verified against a live recorder.

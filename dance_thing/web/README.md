# Dancestagram Lite (Web MVP)

This is a plain HTML/CSS/JS MVP so it stays easy to learn and modify.

## Run

Serve the folder from localhost so the camera + OAuth work:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/web/`.

## What works

- Webcam capture and simple motion-based crouch detection.
- Mock bucket API that rotates through sample images.
- OAuth scaffold for Bluesky (requires a hosted client metadata URL).
- Basic feed fetch wiring that seeds the mock buckets.

## What is mocked

- Bucket API is in `web/mock_api.js`.
- Feed images are randomly assigned to buckets (no moderation yet).

## OAuth Notes

- You must host `web/oauth-client-metadata.json` at a public URL and enter it in the UI.
- For local dev, use a tunnel (ngrok or Cloudflare Tunnel) that exposes your `web/` folder.

## Local Tunnel Setup (Quick)

### Option A: Cloudflare Tunnel

1. Install `cloudflared`.
2. Run a local server:
```bash
python3 -m http.server 8000
```
3. Start the tunnel:
```bash
cloudflared tunnel --url http://127.0.0.1:8000
```
4. Use the public URL the tunnel prints:
   - `Client ID URL`: `https://<your-subdomain>.trycloudflare.com/web/oauth-client-metadata.json`
   - Open the app at: `https://<your-subdomain>.trycloudflare.com/web/`

### Option B: ngrok

1. Install `ngrok` and authenticate.
2. Run a local server:
```bash
python3 -m http.server 8000
```
3. Start the tunnel:
```bash
ngrok http 8000
```
4. Use the public URL:
   - `Client ID URL`: `https://<your-subdomain>.ngrok-free.app/web/oauth-client-metadata.json`
   - Open the app at: `https://<your-subdomain>.ngrok-free.app/web/`

## Client Metadata Checklist

Before OAuth works, update the following fields in `web/oauth-client-metadata.json` to match your public URL:
- `client_id`
- `client_uri`
- `logo_uri`
- `policy_uri`
- `tos_uri`
- `redirect_uris` (must include your `/web/` URL)

## Next steps

- Replace `mock_api.js` with real bucket API calls.
- Port motion logic to WebCodecs or OpenCV.js if needed.
- Add OAuth PKCE flow for Bluesky.

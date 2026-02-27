# Dancestagram Lite (Web MVP)

This is a plain HTML/CSS/JS MVP so it stays easy to learn and modify.

## Run

Serve the folder from localhost so the camera works:

```bash
python3 -m http.server 8000
```

Then open `http://127.0.0.1:8000/web/`.

## What works

- Webcam capture and simple motion-based crouch detection.
- Mock bucket API starts empty and fills from feed fetch.
- Feed fetch wiring that seeds the mock buckets from a bsky.app feed URL.

## What is mocked

- Bucket API is in `web/mock_api.js`.
- Feed images are randomly assigned to buckets (slow/medium/fast; no moderation yet).

## Next steps

- Replace `mock_api.js` with real bucket API calls.
- Port motion logic to WebCodecs or OpenCV.js if needed.
- Add OAuth PKCE flow for Bluesky.

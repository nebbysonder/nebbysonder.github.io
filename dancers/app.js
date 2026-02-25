import { getBucketStatus, getNextFromBucket, seedBuckets } from "./mock_api.js";
import {
  initOAuth,
  hasSession,
  resolveFeedUri,
  fetchFeed,
} from "./oauth.js";

const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const feedImage = document.getElementById("feedImage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const motionReadout = document.getElementById("motionReadout");
const stateReadout = document.getElementById("stateReadout");
const bucketLabel = document.getElementById("bucketLabel");
const bucketCounts = document.getElementById("bucketCounts");
const feedHandleInput = document.getElementById("feedHandleInput");
const feedSlugInput = document.getElementById("feedSlugInput");
const fetchFeedBtn = document.getElementById("fetchFeedBtn");

const ctx = overlay.getContext("2d");

const DEFAULT_CLIENT_ID = "https://nebbysonder.github.io/dancers/oauth-client-metadata.json";

const CAM_W = 320;
const CAM_H = 240;
const LINE_FRAC = 0.55;
const DIFF_THRESHOLD = 6;
const STAND_MAX_FRAC_BELOW = 0.3;
const CROUCH_MIN_FRAC_BELOW = 0.75;
const STAND_FRAMES = 6;
const CROUCH_FRAMES = 2;
const MIN_PIXELS = 200;
const MIN_BLOB_AREA_FRAC = 0.02;
const CONSENSUS_FRAC = 0.67;

let animationId = null;
let stream = null;
let prevFrame = null;
let state = "idle";
let standCount = 0;
let crouchCount = 0;
let motionEnergy = 0;
let startTime = 0;

const frameCanvas = document.createElement("canvas");
frameCanvas.width = CAM_W;
frameCanvas.height = CAM_H;
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

const buckets = ["return", "resonance", "retreat"];
let nextBucketIndex = 1;

function resizeOverlay() {
  if (video.videoWidth && video.videoHeight) {
    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
  } else {
    overlay.width = video.clientWidth;
    overlay.height = video.clientHeight;
  }
}

function updateBucketCounts() {
  const status = getBucketStatus();
  bucketCounts.textContent =
    `return ${status.counts.return} | resonance ${status.counts.resonance} | retreat ${status.counts.retreat}`;
}

function advanceFeed() {
  const bucket = buckets[nextBucketIndex];
  const { item } = getNextFromBucket(bucket);
  bucketLabel.textContent = `Bucket: ${bucket}`;
  if (item) {
    feedImage.src = item.image_url;
  }
  nextBucketIndex = (nextBucketIndex + 1) % buckets.length;
  updateBucketCounts();
}

function startCamera() {
  return navigator.mediaDevices.getUserMedia({ video: true });
}

function stopCamera() {
  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }
}

function drawFrameMask(mask, lineY) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
  ctx.fillRect(0, lineY, overlay.width, overlay.height - lineY);

  ctx.strokeStyle = "rgba(255, 255, 255, 0.8)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, lineY);
  ctx.lineTo(overlay.width, lineY);
  ctx.stroke();

  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "12px monospace";
  ctx.fillText(`State: ${state}`, 12, 24);
}

function processFrame() {
  if (!video.videoWidth) {
    animationId = requestAnimationFrame(processFrame);
    return;
  }
  if (video.videoWidth && (overlay.width !== video.videoWidth || overlay.height !== video.videoHeight)) {
    resizeOverlay();
  }

  frameCtx.save();
  frameCtx.scale(-1, 1);
  frameCtx.drawImage(video, -CAM_W, 0, CAM_W, CAM_H);
  frameCtx.restore();
  const img = frameCtx.getImageData(0, 0, CAM_W, CAM_H);
  const data = img.data;

  let totalFg = 0;
  let belowFg = 0;
  const lineY = Math.floor(LINE_FRAC * CAM_H);
  const mask = new Uint8Array(CAM_W * CAM_H);

  if (!prevFrame) {
    prevFrame = new Uint8ClampedArray(data);
  }

  let diffSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    const pr = prevFrame[i];
    const pg = prevFrame[i + 1];
    const pb = prevFrame[i + 2];
    const pgray = 0.299 * pr + 0.587 * pg + 0.114 * pb;

    const diff = Math.abs(gray - pgray);
    diffSum += diff;
    if (diff > DIFF_THRESHOLD) {
      totalFg += 1;
      mask[i / 4] = 1;
      const pxIndex = i / 4;
      const y = Math.floor(pxIndex / CAM_W);
      if (y >= lineY) {
        belowFg += 1;
      }
    }
  }

  prevFrame = new Uint8ClampedArray(data);
  motionEnergy += totalFg;

  let fracBelow = 0;
  let blobCount = 0;
  let blobCrouchRatio = 0;
  if (totalFg < MIN_PIXELS) {
    // no-op
  } else {
    fracBelow = belowFg / totalFg;

    const minBlobArea = Math.max(1, Math.floor(MIN_BLOB_AREA_FRAC * CAM_W * CAM_H));
    const visited = new Uint8Array(CAM_W * CAM_H);
    const stack = [];
    const blobFracs = [];

    for (let idx = 0; idx < mask.length; idx += 1) {
      if (!mask[idx] || visited[idx]) continue;
      let area = 0;
      let below = 0;
      stack.push(idx);
      visited[idx] = 1;
      while (stack.length) {
        const cur = stack.pop();
        area += 1;
        const y = Math.floor(cur / CAM_W);
        if (y >= lineY) below += 1;
        const x = cur - y * CAM_W;
        const neighbors = [
          cur - 1,
          cur + 1,
          cur - CAM_W,
          cur + CAM_W,
        ];
        for (const n of neighbors) {
          if (n < 0 || n >= mask.length) continue;
          if (mask[n] && !visited[n]) {
            const ny = Math.floor(n / CAM_W);
            const nx = n - ny * CAM_W;
            if (Math.abs(nx - x) > 1 || Math.abs(ny - y) > 1) continue;
            visited[n] = 1;
            stack.push(n);
          }
        }
      }
      if (area >= minBlobArea) {
        blobFracs.push(below / area);
      }
    }

    blobCount = blobFracs.length;
    if (blobCount <= 1) {
      blobCrouchRatio = fracBelow;
    } else {
      const crouchVotes = blobFracs.filter((v) => v >= CROUCH_MIN_FRAC_BELOW).length;
      blobCrouchRatio = crouchVotes / blobCount;
    }

    if (state === "need_stand") {
      if (blobCrouchRatio <= STAND_MAX_FRAC_BELOW) {
        standCount += 1;
        if (standCount >= STAND_FRAMES) {
          state = "ready_crouch";
          crouchCount = 0;
        }
      } else {
        standCount = 0;
      }
    } else if (state === "ready_crouch") {
      if (blobCount > 0 && blobCrouchRatio >= CONSENSUS_FRAC) {
        crouchCount += 1;
        if (crouchCount >= CROUCH_FRAMES) {
          const duration = Math.max(0.001, (performance.now() - startTime) / 1000);
          const rate = motionEnergy / duration;
          motionReadout.textContent = `Motion: ${rate.toFixed(1)}`;
          motionEnergy = 0;
          startTime = performance.now();
          state = "need_stand";
          standCount = 0;
          crouchCount = 0;
          advanceFeed();
        }
      } else if (blobCrouchRatio <= STAND_MAX_FRAC_BELOW) {
        standCount += 1;
        if (standCount >= STAND_FRAMES) {
          crouchCount = 0;
        }
      } else {
        crouchCount = 0;
      }
    }
  }

  stateReadout.textContent = `State: ${state}`;
  drawFrameMask((totalFg / (CAM_W * CAM_H)).toFixed(2), lineY * (overlay.height / CAM_H));
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.font = "12px monospace";
  ctx.fillStyle = "rgba(0, 0, 0, 0.45)";
  ctx.fillRect(8, 8, 150, 156);
  ctx.fillStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillText(`FG: ${totalFg}`, 12, 44);
  ctx.fillText(`Below: ${(fracBelow * 100).toFixed(1)}%`, 12, 60);
  ctx.fillText(`Blobs: ${blobCount}`, 12, 76);
  ctx.fillText(`BlobC: ${(blobCrouchRatio * 100).toFixed(1)}%`, 12, 92);
  ctx.fillText(`Stand: ${standCount} / ${STAND_FRAMES}`, 12, 108);
  ctx.fillText(`Crouch: ${crouchCount} / ${CROUCH_FRAMES}`, 12, 124);
  const avgDiff = diffSum / (data.length / 4);
  ctx.fillText(`Diff: ${DIFF_THRESHOLD}`, 12, 140);
  ctx.fillText(`AvgD: ${avgDiff.toFixed(1)}`, 12, 156);

  animationId = requestAnimationFrame(processFrame);
}

async function handleStart() {
  startBtn.disabled = true;
  try {
    stream = await startCamera();
    video.srcObject = stream;
    await video.play();
    resizeOverlay();
    overlay.style.width = `${video.clientWidth}px`;
    overlay.style.height = `${video.clientHeight}px`;
    state = "need_stand";
    standCount = 0;
    crouchCount = 0;
    motionEnergy = 0;
    startTime = performance.now();
    updateBucketCounts();
    advanceFeed();
    animationId = requestAnimationFrame(processFrame);
    stopBtn.disabled = false;
  } catch (err) {
    startBtn.disabled = false;
    alert("Could not start camera. Check permissions.");
    console.error(err);
  }
}

function handleStop() {
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  stopCamera();
  state = "idle";
  prevFrame = null;
  motionReadout.textContent = "Motion: --";
  stateReadout.textContent = "State: idle";
  stopBtn.disabled = true;
  startBtn.disabled = false;
}

window.addEventListener("resize", resizeOverlay);
startBtn.addEventListener("click", handleStart);
stopBtn.addEventListener("click", handleStop);

fetchFeedBtn.addEventListener("click", async () => {
  const feedHandle = feedHandleInput.value.trim();
  const feedSlug = feedSlugInput.value.trim();
  if (!feedHandle || !feedSlug) {
    alert("Enter feed handle and slug.");
    return;
  }
  if (!hasSession()) {
    alert("Connect with OAuth first.");
    return;
  }
  fetchFeedBtn.disabled = true;
  fetchFeedBtn.textContent = "Fetching...";
  try {
    const feedUri = await resolveFeedUri(feedHandle, feedSlug);
    const data = await fetchFeed({ feedUri, limit: 25 });
    const items = [];
    for (const view of data.feed ?? []) {
      const post = view.post;
      const images = post?.embed?.images ?? [];
      for (const img of images) {
        const imageUrl = img.thumb ?? img.fullsize;
        if (!imageUrl) continue;
        const bucket = buckets[Math.floor(Math.random() * buckets.length)];
        items.push({
          image_url: imageUrl,
          brightness: 0,
          bucket,
          added_at: new Date().toISOString(),
        });
      }
    }
    if (!items.length) {
      alert("No images found in feed.");
    } else {
      seedBuckets(items);
      updateBucketCounts();
      advanceFeed();
    }
  } catch (err) {
    console.error(err);
    alert("Feed fetch failed. Check console for details.");
  } finally {
    fetchFeedBtn.disabled = false;
    fetchFeedBtn.textContent = "Fetch Feed";
  }
});

const storedClientId = window.sessionStorage.getItem("bsky_client_id");
initOAuth(storedClientId || DEFAULT_CLIENT_ID).catch((err) => {
  console.error(err);
});

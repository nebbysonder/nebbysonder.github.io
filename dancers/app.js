import { getBucketStatus, getNextFromBucket, seedBuckets, clearBuckets, peekNextInBucket } from "./mock_api.js";

const video = document.getElementById("camera");
const overlay = document.getElementById("overlay");
const feedImage = document.getElementById("feedImage");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const stateReadout = document.getElementById("stateReadout");
const bucketLabel = document.getElementById("bucketLabel");
const bucketCounts = document.getElementById("bucketCounts");
const appStatus = document.getElementById("appStatus");
const hudBelow = document.getElementById("hudBelow");
const hudAbove = document.getElementById("hudAbove");
const hudDiff = document.getElementById("hudDiff");
const hudLatency = document.getElementById("hudLatency");
const hudLoad = document.getElementById("hudLoad");
const feedUrlInput = document.getElementById("feedUrlInput");
const fetchFeedBtn = document.getElementById("fetchFeedBtn");
const presetCnyBtn = document.getElementById("presetCnyBtn");
const presetDanceBtn = document.getElementById("presetDanceBtn");
const presetBirdsBtn = document.getElementById("presetBirdsBtn");
const presetGardenBtn = document.getElementById("presetGardenBtn");

const ctx = overlay.getContext("2d");

feedImage.src = "";
feedImage.alt = "No feed items yet";

function setAppStatus(message) {
  appStatus.textContent = `Status: ${message}`;
}

window.addEventListener("error", (event) => {
  console.error(event.error || event.message);
  setAppStatus("error");
});

window.addEventListener("unhandledrejection", (event) => {
  console.error(event.reason);
  setAppStatus("error");
});
const CAM_W = 320;
const CAM_H = 240;
const LINE_FRAC_UPPER = 0.55;
const LINE_FRAC_LOWER = 0.65;
const DIFF_THRESHOLD = 13;
const STAND_MIN_FRAC_ABOVE = 0.45;
const PRE_CROUCH_MIN_FRAC_BELOW = 0.55;
const CROUCH_MIN_FRAC_BELOW = 0.7;
const STAND_FRAMES = 4;
const CROUCH_FRAMES = 1;
const MIN_PIXELS = 500;
const MIN_BLOB_AREA_FRAC = 0.02;
const CONSENSUS_FRAC = 0.67;

let animationId = null;
let stream = null;
let prevFrame = null;
let bgModel = null;
let state = "idle";
let standCount = 0;
let crouchCount = 0;
let motionEnergy = 0;
let startTime = 0;
let lastSetSrcTime = 0;
let lastDetectTime = 0;
let preTriggered = false;

const frameCanvas = document.createElement("canvas");
frameCanvas.width = CAM_W;
frameCanvas.height = CAM_H;
const frameCtx = frameCanvas.getContext("2d", { willReadFrequently: true });

const buckets = ["slow", "medium", "fast"];
let nextBucketIndex = 1;
const preloadCache = new Map();

const RESOLVE_ENDPOINT = "https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle";
const FEED_ENDPOINT = "https://public.api.bsky.app/xrpc/app.bsky.feed.getFeed";
const NSFW_LABELS = new Set(["porn", "sexual", "nudity", "nsfl", "gore"]);
const HIDE_LABELS = new Set(["!hide"]);

function summarizeLabels(labels) {
  if (!labels || !Array.isArray(labels)) return { isNsfw: false, shouldHide: false };
  const values = labels
    .map((label) => (label?.val ? String(label.val).toLowerCase() : null))
    .filter(Boolean);
  const isNsfw = values.some((val) => NSFW_LABELS.has(val));
  const shouldHide = values.some((val) => HIDE_LABELS.has(val));
  return { isNsfw, shouldHide };
}

function parseFeedUrl(input) {
  const url = new URL(input.trim());
  const parts = url.pathname.split("/").filter(Boolean);
  const profileIndex = parts.indexOf("profile");
  const feedIndex = parts.indexOf("feed");
  if (profileIndex === -1 || feedIndex === -1) {
    throw new Error("URL does not look like a feed URL.");
  }
  const handle = parts[profileIndex + 1];
  const slug = parts[feedIndex + 1];
  if (!handle || !slug) {
    throw new Error("Missing handle or feed slug in URL.");
  }
  return { handle, slug };
}

async function resolveFeedFromUrl(feedUrl) {
  let parsed;
  try {
    parsed = parseFeedUrl(feedUrl);
  } catch (err) {
    throw new Error("Invalid feed URL. Use a bsky.app feed URL.");
  }
  const { handle, slug } = parsed;
  if (handle.startsWith("did:")) {
    return { feedUri: `at://${handle}/app.bsky.feed.generator/${slug}` };
  }
  const response = await fetch(`${RESOLVE_ENDPOINT}?handle=${encodeURIComponent(handle)}`);
  if (!response.ok) {
    throw new Error(`Resolve failed (${response.status}).`);
  }
  const data = await response.json();
  if (!data.did) {
    throw new Error("No DID returned.");
  }
  return { feedUri: `at://${data.did}/app.bsky.feed.generator/${slug}` };
}

async function fetchFeed(feedUri, limit = 25) {
  const response = await fetch(
    `${FEED_ENDPOINT}?feed=${encodeURIComponent(feedUri)}&limit=${limit}`
  );
  if (!response.ok) {
    throw new Error(`Feed fetch failed (${response.status}).`);
  }
  return response.json();
}

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
    `slow ${status.counts.slow} | medium ${status.counts.medium} | fast ${status.counts.fast}`;
}

function advanceFeed() {
  const bucket = buckets[nextBucketIndex];
  const { item } = getNextFromBucket(bucket);
  bucketLabel.textContent = `Bucket: ${bucket}`;
  if (item) {
    lastSetSrcTime = performance.now();
    if (lastDetectTime) {
      const detectToSet = lastSetSrcTime - lastDetectTime;
      hudLatency.textContent = `Latency: ${detectToSet.toFixed(0)}ms`;
    } else {
      hudLatency.textContent = "Latency: --";
    }
    feedImage.src = item.image_url;
    feedImage.alt = "Feed item";
    feedImage.onload = () => {
      const loadMs = performance.now() - lastSetSrcTime;
      hudLoad.textContent = `Load: ${loadMs.toFixed(0)}ms`;
    };
  } else {
    feedImage.src = "";
    feedImage.alt = "No feed items yet";
  }
  nextBucketIndex = (nextBucketIndex + 1) % buckets.length;
  updateBucketCounts();
  preloadBuckets();
}

function preloadBuckets() {
  for (const bucket of buckets) {
    const item = peekNextInBucket(bucket);
    if (!item || !item.image_url) continue;
    if (preloadCache.has(item.image_url)) continue;
    const img = new Image();
    img.src = item.image_url;
    preloadCache.set(item.image_url, img);
  }
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

function drawFrameMask(mask, lineYUpper, lineYLower) {
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  // Band visualization removed by request.
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
  let aboveFg = 0;
  const lineYUpper = Math.floor(LINE_FRAC_UPPER * CAM_H);
  const lineYLower = Math.floor(LINE_FRAC_LOWER * CAM_H);
  const mask = new Uint8Array(CAM_W * CAM_H);

  if (!prevFrame) {
    prevFrame = new Uint8ClampedArray(data);
  }
  if (!bgModel || bgModel.length !== CAM_W * CAM_H) {
    bgModel = new Float32Array(CAM_W * CAM_H);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      bgModel[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
  }

  const BG_ALPHA = 0.1;
  const BG_ALPHA_FORE = 0.02;
  let diffSum = 0;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;

    const bg = bgModel[i / 4];
    const diff = Math.abs(gray - bg);
    diffSum += diff;
    if (diff > DIFF_THRESHOLD) {
      totalFg += 1;
      mask[i / 4] = 1;
      const pxIndex = i / 4;
      const y = Math.floor(pxIndex / CAM_W);
      if (y >= lineYLower) {
        belowFg += 1;
      } else if (y <= lineYUpper) {
        aboveFg += 1;
      }
      bgModel[i / 4] = bg + (gray - bg) * BG_ALPHA_FORE;
    } else {
      bgModel[i / 4] = bg + (gray - bg) * BG_ALPHA;
    }
  }

  prevFrame = new Uint8ClampedArray(data);
  motionEnergy += totalFg;

  let fracBelow = 0;
  let fracAbove = 0;
  if (totalFg > 0) {
    fracBelow = belowFg / totalFg;
  }

  if (totalFg > 0) {
    fracBelow = belowFg / totalFg;
    fracAbove = aboveFg / totalFg;
  }

  if (state === "need_stand") {
    if (totalFg >= MIN_PIXELS && fracAbove >= STAND_MIN_FRAC_ABOVE) {
      standCount += 1;
      if (standCount >= STAND_FRAMES) {
        state = "ready_crouch";
        crouchCount = 0;
        preTriggered = false;
      }
    } else {
      standCount = 0;
    }
  } else if (state === "ready_crouch") {
    if (!preTriggered && totalFg >= MIN_PIXELS && fracBelow >= PRE_CROUCH_MIN_FRAC_BELOW) {
      preTriggered = true;
      preloadBuckets();
    }
    if (totalFg >= MIN_PIXELS && fracBelow >= CROUCH_MIN_FRAC_BELOW) {
      crouchCount += 1;
      if (crouchCount >= CROUCH_FRAMES) {
        lastDetectTime = performance.now();
        const duration = Math.max(0.001, (performance.now() - startTime) / 1000);
        const rate = motionEnergy / duration;
        motionEnergy = 0;
        startTime = performance.now();
        state = "need_stand";
        standCount = 0;
        crouchCount = 0;
        preTriggered = false;
        advanceFeed();
      }
    } else if (totalFg >= MIN_PIXELS && fracAbove >= STAND_MIN_FRAC_ABOVE) {
      standCount += 1;
      if (standCount >= STAND_FRAMES) {
        crouchCount = 0;
        preTriggered = false;
      }
    } else {
      crouchCount = 0;
    }
  }

  stateReadout.textContent = `State: ${state}`;
  drawFrameMask(
    mask,
    lineYUpper * (overlay.height / CAM_H),
    lineYLower * (overlay.height / CAM_H)
  );
  hudBelow.textContent = `Below: ${(fracBelow * 100).toFixed(1)}%`;
  hudAbove.textContent = `Above: ${(fracAbove * 100).toFixed(1)}%`;
  hudDiff.textContent = `Diff: ${DIFF_THRESHOLD}`;
  if (preTriggered) {
    hudLatency.textContent = "Latency: pre";
  }
  if (!lastDetectTime) {
    hudLatency.textContent = "Latency: --";
  }

  animationId = requestAnimationFrame(processFrame);
}

async function handleStart() {
  startBtn.disabled = true;
  try {
    if (stream) {
      stopCamera();
    }
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
  video.srcObject = null;
  state = "idle";
  prevFrame = null;
  bgModel = null;
  preTriggered = false;
  stateReadout.textContent = "State: idle";
  stopBtn.disabled = true;
  startBtn.disabled = false;
}

window.addEventListener("resize", resizeOverlay);
startBtn.addEventListener("click", handleStart);
stopBtn.addEventListener("click", handleStop);

fetchFeedBtn.addEventListener("click", async () => {
  const feedUrl = feedUrlInput.value.trim();
  if (!feedUrl) {
    alert("Enter a feed URL.");
    return;
  }
  console.log("Feed input:", feedUrl);
  fetchFeedBtn.disabled = true;
  fetchFeedBtn.textContent = "…";
  feedImage.src = "";
  feedImage.alt = "Loading feed...";
  try {
    clearBuckets();
    preloadCache.clear();
    const feedUri = feedUrl.startsWith("at://")
      ? feedUrl
      : (await resolveFeedFromUrl(feedUrl)).feedUri;
    const data = await fetchFeed(feedUri, 25);
    const items = [];
    for (const view of data.feed ?? []) {
      const post = view.post;
      const labelMeta = summarizeLabels(post?.labels);
      if (labelMeta.isNsfw || labelMeta.shouldHide) {
        continue;
      }
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
      preloadBuckets();
      advanceFeed();
    }
  } catch (err) {
    console.error(err);
    alert("Feed fetch failed. Check console for details.");
  } finally {
    fetchFeedBtn.disabled = false;
    fetchFeedBtn.textContent = "▶";
  }
});

const PRESET_DID = "did:plc:pt6lv5iru5kzindbhvc3cyiv";
const PRESET_BASE = `https://bsky.app/profile/${PRESET_DID}/feed`;
const PRESET_BIRDS = "https://bsky.app/profile/did:plc:ffkgesg3jsv2j7aagkzrtcvt/feed/aaagllxbcbsje";
const PRESET_GARDEN = "https://bsky.app/profile/did:plc:5rw2on4i56btlcajojaxwcat/feed/aaao6g552b33o";

function triggerFetch(url) {
  feedUrlInput.value = url;
  fetchFeedBtn.click();
}

if (presetCnyBtn) {
  presetCnyBtn.addEventListener("click", () => {
    triggerFetch(`at://${PRESET_DID}/app.bsky.feed.generator/firehorse`);
  });
}

if (presetDanceBtn) {
  presetDanceBtn.addEventListener("click", () => {
    triggerFetch(`at://${PRESET_DID}/app.bsky.feed.generator/dancers`);
  });
}

if (presetBirdsBtn) {
  presetBirdsBtn.addEventListener("click", () => {
    triggerFetch(PRESET_BIRDS);
  });
}

if (presetGardenBtn) {
  presetGardenBtn.addEventListener("click", () => {
    triggerFetch(PRESET_GARDEN);
  });
}

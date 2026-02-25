const demoImages = [
  {
    image_url:
      "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80",
    brightness: 142.5,
    bucket: "return",
    added_at: new Date().toISOString(),
  },
  {
    image_url:
      "https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80",
    brightness: 188.2,
    bucket: "resonance",
    added_at: new Date().toISOString(),
  },
  {
    image_url:
      "https://images.unsplash.com/photo-1469474968028-56623f02e42e?auto=format&fit=crop&w=1200&q=80",
    brightness: 166.8,
    bucket: "retreat",
    added_at: new Date().toISOString(),
  },
];

const bucketState = {
  return: [demoImages[0]],
  resonance: [demoImages[1]],
  retreat: [demoImages[2]],
};

export function getBucketStatus() {
  return {
    counts: {
      return: bucketState.return.length,
      resonance: bucketState.resonance.length,
      retreat: bucketState.retreat.length,
    },
  };
}

export function getNextFromBucket(bucket) {
  const queue = bucketState[bucket] ?? [];
  if (!queue.length) {
    return { item: null, remaining: 0 };
  }
  const item = queue.shift();
  queue.push(item);
  return { item, remaining: queue.length };
}

export function seedBuckets(items) {
  for (const item of items) {
    if (!bucketState[item.bucket]) {
      bucketState[item.bucket] = [];
    }
    bucketState[item.bucket].push(item);
  }
  return { accepted: items.length, skipped: 0, expires_at: null };
}

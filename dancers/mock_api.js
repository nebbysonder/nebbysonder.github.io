const bucketState = {
  slow: [],
  medium: [],
  fast: [],
};

export function getBucketStatus() {
  return {
    counts: {
      slow: bucketState.slow.length,
      medium: bucketState.medium.length,
      fast: bucketState.fast.length,
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

export function peekNextInBucket(bucket) {
  const queue = bucketState[bucket] ?? [];
  return queue.length ? queue[0] : null;
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

export function clearBuckets() {
  for (const key of Object.keys(bucketState)) {
    bucketState[key] = [];
  }
}

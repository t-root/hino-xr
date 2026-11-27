const CLASSIC_WORKER_PREFIX = "/@classic-worker/";

export const spawnInferenceWorker = (entry: string): Worker =>
  new Worker(`${CLASSIC_WORKER_PREFIX}${entry}`);

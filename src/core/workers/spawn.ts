/** Matches the classic-worker URL the Python server serves. */
const CLASSIC_WORKER_PREFIX = "/@classic-worker/";

/**
 * Spawns a plugin's inference worker as a classic worker.
 *
 * MediaPipe's WASM glue is a classic script that declares `ModuleFactory` as a
 * plain top-level `var`. A classic worker turns that into a global, which is
 * exactly what MediaPipe then looks for; a module worker keeps it module-local
 * and every task dies at start-up with "ModuleFactory not set." So the worker
 * type is not a preference here, it is the difference between working and not.
 *
 * The server bundles the file as a classic script and hands it over at
 * `/@classic-worker/<path under src>`.
 *
 * @param entry Path of the worker file, relative to `src`. A test checks that
 *              the file named here exists, since nothing else connects them.
 */
export const spawnInferenceWorker = (entry: string): Worker =>
  new Worker(`${CLASSIC_WORKER_PREFIX}${entry}`);

/**
 * The key that lets this page use the server's `/api` from another device.
 *
 * The computer that runs the server needs none. A phone opens the address the server printed, which ends in
 * `?key=...`; the key is kept here and the address is cleaned, so it is not left in history or shared by accident.
 */

const STORAGE_KEY = "hino.accessKey";
const HEADER = "X-Access-Key";

/** Where the key waits when the browser will not keep it. */
let memory: string | null = null;

/** Call once, before anything talks to the server. */
export const initAccessKey = (): void => {
  const url = new URL(window.location.href);
  const key = url.searchParams.get("key");
  if (!key) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
    // Storage blocked: the key works until the page is closed, which is all that can be done.
    memory = key;
  }
  url.searchParams.delete("key");
  window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
};

const stored = (): string | null => {
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? memory;
  } catch {
    return memory;
  }
};

/** `init` with the access key added, for any request to the server's `/api`. */
export const withAccessKey = (init: RequestInit = {}): RequestInit => {
  const key = stored();
  if (!key) return init;
  const headers = new Headers(init.headers);
  headers.set(HEADER, key);
  return { ...init, headers };
};

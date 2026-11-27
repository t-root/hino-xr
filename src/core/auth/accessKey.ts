const STORAGE_KEY = "hino.accessKey";
const HEADER = "X-Access-Key";

let memory: string | null = null;

export const initAccessKey = (): void => {
  const url = new URL(window.location.href);
  const key = url.searchParams.get("key");
  if (!key) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, key);
  } catch {
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

export const withAccessKey = (init: RequestInit = {}): RequestInit => {
  const key = stored();
  if (!key) return init;
  const headers = new Headers(init.headers);
  headers.set(HEADER, key);
  return { ...init, headers };
};

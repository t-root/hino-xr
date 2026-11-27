import { createStore } from "zustand/vanilla";

type LogLevel = "debug" | "log" | "info" | "warn" | "error";

type LogEntry = Readonly<{
  id: number;
  level: LogLevel;
  text: string;
  atMs: number;
}>;

const LIMIT = 300;

const MAX_TEXT = 400;

const FLUSH_MS = 200;

const LEVELS: readonly LogLevel[] = ["debug", "log", "info", "warn", "error"];

type LogState = {
  entries: readonly LogEntry[];
  append: (entries: readonly LogEntry[]) => void;
  clear: () => void;
};

export const useLogStore = createStore<LogState>((set) => ({
  entries: [],
  append: (incoming) => set((state) => ({ entries: [...state.entries, ...incoming].slice(-LIMIT) })),
  clear: () => set({ entries: [] }),
}));

const describe = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value === undefined) return "undefined";
  if (typeof value === "object" && value !== null) {
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
};

const format = (args: readonly unknown[]): string => {
  const text = args.map(describe).filter((part) => part.length > 0).join(" ");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
};

let installed: (() => void) | null = null;
let nextId = 1;
let pending: LogEntry[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let recording = false;

const flush = (): void => {
  timer = null;
  if (pending.length === 0) return;
  const batch = pending;
  pending = [];
  useLogStore.getState().append(batch);
};

const record = (level: LogLevel, args: readonly unknown[]): void => {
  if (recording) return;
  recording = true;
  try {
    pending.push({ id: nextId++, level, text: format(args), atMs: Date.now() });
    if (pending.length > LIMIT) pending = pending.slice(-LIMIT);
    if (timer === null) timer = setTimeout(flush, FLUSH_MS);
  } finally {
    recording = false;
  }
};

export const captureConsole = (target: Console = console): (() => void) => {
  if (installed) return installed;

  const originals = new Map(LEVELS.map((level) => [level, target[level]] as const));
  for (const level of LEVELS) {
    const original = originals.get(level);
    target[level] = (...args: unknown[]): void => {
      record(level, args);
      original?.apply(target, args);
    };
  }

  const onError = (event: ErrorEvent): void => record("error", [event.message]);
  const onRejection = (event: PromiseRejectionEvent): void =>
    record("error", ["unhandled rejection", event.reason]);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  installed = () => {
    for (const [level, original] of originals) if (original) target[level] = original;
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    if (timer !== null) clearTimeout(timer);
    timer = null;
    pending = [];
    installed = null;
  };
  return installed;
};

export const clockOf = (atMs: number): string => {
  const time = new Date(atMs);
  const pad = (value: number, size = 2): string => `${value}`.padStart(size, "0");
  return `${pad(time.getHours())}:${pad(time.getMinutes())}:${pad(time.getSeconds())}.${pad(
    time.getMilliseconds(),
    3,
  )}`;
};

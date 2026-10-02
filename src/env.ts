/**
 * Optional values the test runner may inject. The Python server does not
 * define `import.meta.env`; missing keys fall back to this origin (`/` and `/api`).
 */
type Injected = {
  DEV?: boolean;
  BASE_URL?: string;
};

const injected = (import.meta as ImportMeta & { env?: Injected }).env ?? {};

export const ENV = {
  DEV: Boolean(injected.DEV),
  BASE_URL: injected.BASE_URL ?? "/",
} as const;

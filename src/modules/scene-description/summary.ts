import type { Locale } from "@/shared/contracts/locale";
import { fill } from "@/i18n/text";
import text from "./text.json";

/** How many of each kind one look found. */
export type Counts = ReadonlyMap<string, number>;

const words = text as unknown as Readonly<Record<string, Readonly<Record<Locale, string>> | undefined>>;

/** At most this many kinds are read out; a list longer than that is not a sentence. */
const MAX_KINDS = 6;

/**
 * What was in view over several looks: for each kind, the most any one look found.
 * One look can miss a cup that the next one sees, but a cup seen twice is never two.
 */
export const peakCounts = (looks: readonly Counts[]): Counts => {
  const peak = new Map<string, number>();
  for (const look of looks) {
    for (const [kind, count] of look) peak.set(kind, Math.max(peak.get(kind) ?? 0, count));
  }
  return peak;
};

/** English plural for a class name with no entry of its own. */
const pluralEn = (name: string): string => {
  if (/(s|x|z|ch|sh)$/.test(name)) return `${name}es`;
  if (/[^aeiou]y$/.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
};

const nameOf = (kind: string, count: number, locale: Locale): string => {
  const one = words[`class.${kind}`]?.[locale] ?? kind;
  const base = one.toLowerCase();
  if (count === 1) return base;
  const many = words[`class.${kind}.many`]?.[locale];
  if (many) return many.toLowerCase();
  return locale === "en" ? pluralEn(base) : base;
};

const numberOf = (count: number, locale: Locale): string => words[`number.${count}`]?.[locale] ?? `${count}`;

/** "two people, a cup and a laptop", as it is said. */
export const describeScene = (counts: Counts, locale: Locale): string => {
  const entries = [...counts.entries()].filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, MAX_KINDS);
  if (entries.length === 0) return text.nothing[locale];
  const parts = entries.map(([kind, count]) => `${numberOf(count, locale)} ${nameOf(kind, count, locale)}`);
  const last = parts.pop() as string;
  const list = parts.length === 0 ? last : `${parts.join(", ")} ${text.and[locale]} ${last}`;
  return fill(text.sentence[locale], { list });
};

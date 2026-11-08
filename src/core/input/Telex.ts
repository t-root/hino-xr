/**
 * Telex, the way Vietnamese is typed on a Latin keyboard: `aa` makes a circumflex a, `dd` makes d with a
 * stroke, `w` turns a, o and u into the breve and horn forms, and `s f r x j` put on the five tone marks
 * (acute, grave, hook, tilde, dot below). `z` takes the mark off. Typing the same key again undoes it, so
 * `aaa` is `aa`.
 *
 * Only the word being typed is touched, and a space ends it. The mark goes on the vowel Vietnamese puts it
 * on (modern spelling) and moves if a later letter changes where it belongs.
 */

type Shape = "" | "^" | "(" | "+";

type Piece = { base: string; upper: boolean; shape: Shape; tone: number };

const SHAPE_MARK: Record<Exclude<Shape, "">, string> = { "^": "\u0302", "(": "\u0306", "+": "\u031b" };
/** none, acute, grave, hook, tilde, dot below */
const TONE_MARK = ["", "\u0301", "\u0300", "\u0309", "\u0303", "\u0323"] as const;
const TONE_KEYS: Readonly<Record<string, number>> = { s: 1, f: 2, r: 3, x: 4, j: 5 };
const VOWELS = "aeiouy";
const D_STROKE = "\u0111";
const U_HORN = "\u01b0";

const shapeOfMark = (mark: string): Shape | null =>
  mark === "\u0302" ? "^" : mark === "\u0306" ? "(" : mark === "\u031b" ? "+" : null;

const parse = (word: string): Piece[] => {
  const pieces: Piece[] = [];
  for (const char of word.normalize("NFD")) {
    const last = pieces[pieces.length - 1];
    const shape = shapeOfMark(char);
    const tone = TONE_MARK.indexOf(char as (typeof TONE_MARK)[number]);
    if (last && shape) {
      last.shape = shape;
    } else if (last && tone > 0) {
      last.tone = tone;
    } else {
      const lower = char.toLowerCase();
      pieces.push({ base: lower, upper: char !== lower, shape: "", tone: 0 });
    }
  }
  return pieces;
};

const compose = (pieces: readonly Piece[]): string =>
  pieces
    .map((piece) => {
      const text = (piece.base + (piece.shape ? SHAPE_MARK[piece.shape] : "") + TONE_MARK[piece.tone]).normalize("NFC");
      return piece.upper ? text.toUpperCase() : text;
    })
    .join("");

const isVowel = (piece: Piece | undefined): boolean => piece !== undefined && VOWELS.includes(piece.base);

/** The indexes of the vowels of the syllable; the u of qu and the i of gi are consonants. */
const vowelRun = (pieces: readonly Piece[]): number[] => {
  const run: number[] = [];
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i] as Piece;
    if (!isVowel(piece)) {
      if (run.length > 0) break;
      continue;
    }
    if (piece.base === "u" && i > 0 && pieces[i - 1]?.base === "q") continue;
    if (piece.base === "i" && i === 1 && pieces[0]?.base === "g" && isVowel(pieces[2])) continue;
    run.push(i);
  }
  return run;
};

/** Which vowel of the run carries the mark. */
const toneIndex = (pieces: readonly Piece[], run: readonly number[]): number => {
  const shaped = run.filter((i) => (pieces[i] as Piece).shape !== "");
  if (shaped.length > 0) return shaped[shaped.length - 1] as number;
  if (run.length === 1) return run[0] as number;
  if (run.length >= 3) return run[1] as number;
  const first = run[0] as number;
  const second = run[1] as number;
  const closed = second < pieces.length - 1;
  if (closed) return second;
  // Modern spelling: an open pair takes the mark on its first vowel (hoa, khoe, thuy with the mark on o, o, u).
  return first;
};

const currentTone = (pieces: readonly Piece[]): number => pieces.find((piece) => piece.tone > 0)?.tone ?? 0;

const setTone = (pieces: Piece[], tone: number): void => {
  for (const piece of pieces) piece.tone = 0;
  const run = vowelRun(pieces);
  if (tone > 0 && run.length > 0) (pieces[toneIndex(pieces, run)] as Piece).tone = tone;
};

/** The same word, with the mark moved to the vowel it now belongs on. */
const replace = (pieces: Piece[]): string => {
  const tone = currentTone(pieces);
  if (tone > 0) setTone(pieces, tone);
  return compose(pieces);
};

const append = (pieces: Piece[], key: string): string => {
  const kept = replace(pieces);
  return kept + key;
};

const toggleShape = (piece: Piece, shape: Shape): boolean => {
  if (piece.shape === shape) {
    piece.shape = "";
    return false;
  }
  piece.shape = shape;
  return true;
};

/**
 * The word after `key` is typed at its end. `word` is the letters before the caret since the last space;
 * the result replaces them.
 */
export const telex = (word: string, key: string): string => {
  const k = key.toLowerCase();
  const pieces = parse(word);

  if (k in TONE_KEYS || k === "z") {
    const run = vowelRun(pieces);
    if (run.length === 0) return word + key;
    if (k === "z") {
      if (currentTone(pieces) === 0) return word + key;
      setTone(pieces, 0);
      return compose(pieces);
    }
    const tone = TONE_KEYS[k] as number;
    if (currentTone(pieces) === tone) {
      setTone(pieces, 0);
      return compose(pieces) + key;
    }
    setTone(pieces, tone);
    return compose(pieces);
  }

  if (k === "d") {
    const last = pieces[pieces.length - 1];
    if (last?.base === "d") {
      last.base = D_STROKE;
      return replace(pieces);
    }
    if (last?.base === D_STROKE) {
      last.base = "d";
      return replace(pieces) + key;
    }
    return append(pieces, key);
  }

  if (k === "a" || k === "e" || k === "o") {
    for (let i = pieces.length - 1; i >= 0; i -= 1) {
      const piece = pieces[i] as Piece;
      if (piece.base !== k || (piece.shape !== "" && piece.shape !== "^")) continue;
            const changed = toggleShape(piece, "^");
      return changed ? replace(pieces) : replace(pieces) + key;
    }
    return append(pieces, key);
  }

  if (k === "w") {
    const run = vowelRun(pieces);
    const u = run.find((i) => (pieces[i] as Piece).base === "u" && (pieces[i + 1] as Piece | undefined)?.base === "o");
    if (u !== undefined) {
      // u followed by o, with w, takes the horn on both at once.
      const both = [pieces[u] as Piece, pieces[u + 1] as Piece];
      if (both.every((piece) => piece.shape === "+")) {
        for (const piece of both) piece.shape = "";
        return replace(pieces) + key;
      }
      for (const piece of both) piece.shape = "+";
      return replace(pieces);
    }
    for (let i = run.length - 1; i >= 0; i -= 1) {
      const piece = pieces[run[i] as number] as Piece;
      const shape: Shape | null = piece.base === "a" ? "(" : piece.base === "o" || piece.base === "u" ? "+" : null;
      if (!shape) continue;
      const changed = toggleShape(piece, shape);
      return changed ? replace(pieces) : replace(pieces) + key;
    }
    // Nothing to turn: a lone w is u with a horn.
    const last = pieces[pieces.length - 1];
    if (!last || !isVowel(last)) return replace(pieces) + (key === "W" ? U_HORN.toUpperCase() : U_HORN);
    return append(pieces, key);
  }

  return append(pieces, key);
};

/** The letters at the end of `before`: the word `telex` works on. */
export const tailWord = (before: string): string => /[\p{L}]{1,12}$/u.exec(before)?.[0] ?? "";

import type { HandTrackingStatus } from "@/core/input/HandTrackingService";
import type { SettingsCategory } from "@/core/state/SharedUiStore";
import { LOCALES, type Locale, type LocalizedText } from "@/shared/contracts/locale";
import type { VoiceIssue, VoiceState, ModelState } from "@/shared/contracts/model";
import type { PluginPaletteItemState } from "@/shared/contracts/plugin";
import type { ModulePermission } from "@/shared/contracts/vision";
import raw from "./text.json";

/**
 * Every word the application says, loaded from `text.json`.
 *
 * The sentences live in data, not in code, so translating the app is editing
 * one file that needs no knowledge of TypeScript, and so a component can be
 * read without wading through prose. This module is the only thing that knows
 * the file exists; everything else asks for a key.
 *
 * The `satisfies` below is the whole safety net: it fails the build if any
 * entry is missing a language, which is the mistake that otherwise ships as a
 * blank label somebody notices months later in the language they do not read.
 */
const catalogue = raw satisfies Record<string, LocalizedText>;

export type MessageKey = keyof typeof catalogue;

export const TEXT: Readonly<Record<MessageKey, LocalizedText>> = catalogue;

/** Text written in every language, for code that renders later or elsewhere. */
export const message = (key: MessageKey): LocalizedText => TEXT[key];

export type TextValues = Readonly<Record<string, string | number>>;

/** `{name}` in a message is filled in at render time. */
export const fill = (template: string, values?: TextValues): string =>
  values
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
    : template;

const everyLocale = (of: (locale: Locale) => string): LocalizedText =>
  Object.fromEntries(LOCALES.map((locale) => [locale, of(locale)])) as LocalizedText;

/**
 * Fills the blanks in every language at once.
 *
 * Needed where a sentence is built long before anyone reads it — a failure
 * travelling through an event, say — and so cannot know which language the
 * screen will be in by then. Values may themselves be written in every
 * language, and each one is resolved into the sentence around it.
 */
export const format = (
  text: LocalizedText,
  values: Readonly<Record<string, string | number | LocalizedText>>,
): LocalizedText =>
  everyLocale((locale) =>
    fill(
      text[locale],
      Object.fromEntries(
        Object.entries(values).map(([name, value]) => [
          name,
          typeof value === "object" ? value[locale] : value,
        ]),
      ),
    ),
  );

/** Joins a list that has to stay readable in whichever language it ends up in. */
export const joinLocalized = (parts: readonly LocalizedText[], separator = ", "): LocalizedText =>
  everyLocale((locale) => parts.map((part) => part[locale]).join(separator));

/**
 * Keys built from a runtime value.
 *
 * Written as typed helpers rather than assembled at the call site, so the
 * compiler checks that every category, state and permission that exists has a
 * message — a cast would only find out at runtime, as a blank label.
 */
export const categoryKey = (category: SettingsCategory): MessageKey => `category.${category}`;

export const pluginStateKey = (state: PluginPaletteItemState): MessageKey => `plugin.state.${state}`;

export const permissionKey = (permission: ModulePermission): MessageKey => `permission.${permission}`;

export const handStateKey = (status: HandTrackingStatus): MessageKey => `hand.${status}`;

export const assistantStateKey = (state: ModelState): MessageKey => `assistant.${state}`;

export const assistantVoiceKey = (state: VoiceState): MessageKey => `assistant.voice.${state}`;

export const voiceIssueKey = (issue: VoiceIssue): MessageKey => `assistant.${issue}`;

/**
 * A language named in its own language.
 *
 * A list where the other language is written in the language you cannot read is
 * useless to the one person who needs it: whoever is looking for a way out.
 */
export const languageName = (locale: Locale): string => TEXT[`language.name.${locale}`][locale];

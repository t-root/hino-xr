import type { SettingsCategory } from "@/core/state/SharedUiStore";
import { LOCALES, type Locale, type LocalizedText } from "@/shared/contracts/locale";
import type { VoiceIssue, VoiceState, ModelState } from "@/shared/contracts/model";
import type { PluginPaletteItemState } from "@/shared/contracts/plugin";
import type { ModulePermission } from "@/shared/contracts/vision";
import raw from "./text.json";

const catalogue = raw satisfies Record<string, LocalizedText>;

export type MessageKey = keyof typeof catalogue;

export const TEXT: Readonly<Record<MessageKey, LocalizedText>> = catalogue;

export const message = (key: MessageKey): LocalizedText => TEXT[key];

export type TextValues = Readonly<Record<string, string | number>>;

export const fill = (template: string, values?: TextValues): string =>
  values
    ? template.replace(/\{(\w+)\}/g, (match, name: string) => String(values[name] ?? match))
    : template;

const everyLocale = (of: (locale: Locale) => string): LocalizedText =>
  Object.fromEntries(LOCALES.map((locale) => [locale, of(locale)])) as LocalizedText;

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

export const joinLocalized = (parts: readonly LocalizedText[], separator = ", "): LocalizedText =>
  everyLocale((locale) => parts.map((part) => part[locale]).join(separator));

export const categoryKey = (category: SettingsCategory): MessageKey => `category.${category}`;

export const pluginStateKey = (state: PluginPaletteItemState): MessageKey => `plugin.state.${state}`;

export const permissionKey = (permission: ModulePermission): MessageKey => `permission.${permission}`;

export const micModeKey = (mode: string): MessageKey => `diagnostics.mic.${mode}` as MessageKey;

export const assistantStateKey = (state: ModelState): MessageKey => `assistant.${state}`;

export const assistantVoiceKey = (state: VoiceState): MessageKey => `assistant.voice.${state}`;

export const voiceIssueKey = (issue: VoiceIssue): MessageKey => `assistant.${issue}`;

export const languageName = (locale: Locale): string => TEXT[`language.name.${locale}`][locale];

import { hasOrientationGrant } from "@/core/device/features";
import { ASSISTANT_NAME } from "@/core/models/identity";
import { useLocaleStore } from "@/core/state/LocaleStore";
import { useLogStore } from "@/core/observability/ConsoleLog";
import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { DEFAULT_LENS, GREETING_MAX, type LensSettings, type Settings } from "@/core/state/settings";
import { DEFAULT_VOICE, VOICE_RANGE, type VoiceSettings } from "@/shared/contracts/voice";
import { LISTEN_RANGE } from "@/shared/contracts/wake";
import { DEFAULT_THEME, hexToHsl, hslToHex } from "@/ui/theme";
import { MENU_SCROLL_KEY, SETTINGS_CATEGORIES, useSharedUiStore } from "@/core/state/SharedUiStore";
import { nextTurn } from "@/core/view/orientation";
import { LOCALES, type LocalizedText } from "@/shared/contracts/locale";
import type { AssistantSnapshot, ChatMessage, ModelState } from "@/shared/contracts/model";
import {
  assistantStateKey,
  assistantVoiceKey,
  categoryKey,
  languageName,
  permissionKey,
  pluginStateKey,
  voiceIssueKey,
} from "@/i18n/text";
import { el, empty, watch } from "../dom";
import { loc, t, watchLocale } from "../i18n/useText";
import { mountColourGroup, mountSliderField, mountSwitchField, mountTextField } from "../components/Field";
import { MenuStrip, updateMenuStrip } from "../components/MenuStrip";
import { ScrollBox } from "../components/ScrollBox";
import { paintLogSection } from "./LogSection";

const sourceFile = (source: string): string => {
  const parts = source.replaceAll("\\", "/").split("/");
  return parts[parts.length - 1] ?? source;
};

const sliderHsl = (hex: string) => {
  const { h, s, l } = hexToHsl(hex);
  return { h: Math.round(h), s: Math.round(s), l: Math.round(l) };
};

const assistantBusy = (state: ModelState): boolean =>
  state === "loading" || state === "generating" || state === "listening" || state === "speaking";

const stateTone = (state: ModelState): "accent" | "strong" | "dim" =>
  state === "failed" || state === "offline" ? "accent" : state === "ready" || state === "speaking" ? "strong" : "dim";

const voiceTone = (voice: AssistantSnapshot["voice"]): "accent" | "strong" | "dim" =>
  voice === "failed" ? "accent" : voice === "ready" ? "strong" : "dim";

const writeNote = (node: HTMLElement, text: string): void => {
  node.hidden = text.length === 0;
  if (text && node.textContent !== text) node.textContent = text;
};

/** Live `reply` still paints when the store has not copied it into `messages` yet. */
const chatTurns = (assistant: AssistantSnapshot): ChatMessage[] => {
  const rows = assistant.messages.filter((item) => item.role !== "system");
  const reply = assistant.reply;
  if (rows.length === 0) return reply.trim() ? [{ role: "assistant", content: reply }] : [];
  const last = rows[rows.length - 1];
  if (last?.role === "assistant") {
    if (reply && last.content !== reply) return [...rows.slice(0, -1), { role: "assistant", content: reply }];
    return rows;
  }
  return reply.trim() ? [...rows, { role: "assistant", content: reply }] : rows;
};

const paintChat = (root: HTMLElement, assistant: AssistantSnapshot): void => {
  const turns = chatTurns(assistant).filter((item) => item.content.trim());
  while (root.childElementCount > turns.length) root.lastElementChild?.remove();
  turns.forEach((turn, index) => {
    let row = root.children[index] as HTMLElement | undefined;
    if (!row) {
      row = el("div", { className: "chat__row" }, [
        el("span", { className: "chat__who" }),
        el("p", { className: "chat__text" }),
      ]);
      root.append(row);
    }
    row.dataset.role = turn.role;
    const who = row.children[0] as HTMLElement;
    const text = row.children[1] as HTMLElement;
    const label = turn.role === "user" ? t("assistant.you") : ASSISTANT_NAME;
    if (who.textContent !== label) who.textContent = label;
    if (text.textContent !== turn.content) text.textContent = turn.content;
    text.classList.toggle("assistant-reply", turn.role === "assistant");
  });
};

type SettingsPanelProps = Readonly<{
  stereo: boolean;
  /** Set while content on screen makes a second eye impossible to keep in sync. */
  monoReason: LocalizedText | null;
  onChange: (settings: Settings) => void;
  onToggleStereo: () => void;
  onTogglePlugin: (id: string) => void;
  onAssistantLoad: (id?: string) => void;
  onAssistantAsk: (prompt: string) => void;
  onAssistantTalkStart: () => void;
  onAssistantPreview: (text: string) => void;
}>;

/**
 * The settings menu, centred in each eye.
 *
 * Open flag, centred entry, drag offset and which screen is up all live in the
 * shared store, so the copy in the other eye follows every touch (rules.md).
 */
export const SettingsPanel = (parent: ParentNode, props: SettingsPanelProps): (() => void) => {
  let menu: HTMLElement | null = null;
  let strip: HTMLElement | null = null;
  let scroll: ReturnType<typeof ScrollBox> | null = null;
  let viewKey = "";
  const patchers: Array<() => void> = [];

  const settingsOf = () => useRuntimeStore.getState().settings;
  const patch = (next: Partial<Settings>) => props.onChange({ ...settingsOf(), ...next });
  const patchLens = (next: Partial<LensSettings>) => patch({ lens: { ...settingsOf().lens, ...next } });
  const patchVoice = (next: Partial<VoiceSettings>) =>
    patch({ assistant: { ...settingsOf().assistant, voice: { ...settingsOf().assistant.voice, ...next } } });

  const choose = (next: number) => {
    const ui = useSharedUiStore.getState();
    if (next === ui.settingsSlot) ui.openSettingsSlot(next);
    else ui.setSettingsSlot(next);
  };

  const stripProps = () => ({
    items: SETTINGS_CATEGORIES,
    label: (item: (typeof SETTINGS_CATEGORIES)[number]) => t(categoryKey(item)),
    slot: useSharedUiStore.getState().settingsSlot,
    drag: useSharedUiStore.getState().settingsDrag,
    onDrag: useSharedUiStore.getState().setSettingsDrag,
    onSettle: useSharedUiStore.getState().settleSettingsBand,
    onSelect: choose,
  });

  const fillDetail = (content: HTMLElement) => {
    empty(content);
    patchers.length = 0;
    const category = useSharedUiStore.getState().settingsCategory;
    const settings = settingsOf();
    const viewTurn = useRuntimeStore.getState().viewTurn;
    const deviceGrants = useRuntimeStore.getState().deviceGrants;
    const assistant = useRuntimeStore.getState().assistant;
    const locale = useLocaleStore.getState().locale;
    const diagnosticsOpen = useSharedUiStore.getState().diagnosticsOpen;

    content.append(el("h3", { className: "menu__title", text: t(categoryKey(category)) }));

    if (category === "stereo") {
      const row = el("div", { className: "row" });
      const button = el("button", {
        className: "chip",
        dataset: { active: props.stereo },
        disabled: props.monoReason !== null,
        text:
          props.monoReason !== null ? t("stereo.locked") : props.stereo ? t("stereo.two") : t("stereo.one"),
        onClick: props.onToggleStereo,
      });
      row.append(button);
      content.append(row);
      if (props.monoReason !== null) {
        content.append(el("p", { className: "note", text: t("stereo.lockedNote", { reason: loc(props.monoReason) }) }));
      }
    }

    if (category === "orientation") {
      mountSwitchField(content, {
        label: t("orientation.auto"),
        checked: settings.view.autoRotate,
        onChange: (autoRotate) => patch({ view: { rotation: viewTurn, autoRotate } }),
      });
      if (settings.view.autoRotate && !hasOrientationGrant(deviceGrants) && deviceGrants.orientation === "denied") {
        content.append(el("p", { className: "note", text: t("orientation.autoDenied") }));
      }
      content.append(
        el("div", { className: "row" }, [
          el("button", {
            className: "chip",
            text: t("orientation.rotate"),
            onClick: () => patch({ view: { rotation: nextTurn(useRuntimeStore.getState().viewTurn), autoRotate: false } }),
          }),
        ]),
      );
    }

    if (category === "lens") {
      content.append(
        el("div", { className: "row" }, [
          el("button", { className: "chip", text: t("lens.reset"), onClick: () => patch({ lens: DEFAULT_LENS }) }),
        ]),
      );
      const sliders = [
        mountSliderField(content, {
          label: t("lens.ipd"),
          value: settings.render.ipdMeters,
          min: 0.05,
          max: 0.08,
          step: 0.001,
          format: (value) => `${(value * 1000).toFixed(0)} mm`,
          onChange: (ipdMeters) => patch({ render: { ...settingsOf().render, ipdMeters } }),
        }),
        mountSliderField(content, {
          label: t("lens.eyeGap"),
          value: settings.lens.eyeGapPx,
          min: 0,
          max: 80,
          step: 2,
          format: (value) => `${value.toFixed(0)} px`,
          onChange: (eyeGapPx) => patchLens({ eyeGapPx }),
        }),
        mountSliderField(content, {
          label: t("lens.fov"),
          value: settings.lens.fovYDeg,
          min: 45,
          max: 100,
          step: 1,
          format: (value) => `${value.toFixed(0)}°`,
          onChange: (fovYDeg) => patchLens({ fovYDeg }),
        }),
        mountSliderField(content, {
          label: t("lens.frameScale"),
          value: settings.lens.frameScale,
          min: 0.5,
          max: 1,
          step: 0.01,
          format: (value) => `${Math.round(value * 100)}%`,
          onChange: (frameScale) => patchLens({ frameScale }),
        }),
        mountSliderField(content, {
          label: t("lens.center"),
          value: settings.lens.lensCenterOffset,
          min: -0.15,
          max: 0.15,
          step: 0.005,
          format: (value) => `${(value * 100).toFixed(1)}%`,
          onChange: (lensCenterOffset) => patchLens({ lensCenterOffset }),
        }),
        mountSliderField(content, {
          label: t("lens.k1"),
          value: settings.lens.k1,
          min: 0,
          max: 0.6,
          step: 0.01,
          format: (value) => value.toFixed(2),
          onChange: (k1) => patchLens({ k1 }),
        }),
        mountSliderField(content, {
          label: t("lens.k2"),
          value: settings.lens.k2,
          min: 0,
          max: 0.4,
          step: 0.01,
          format: (value) => value.toFixed(2),
          onChange: (k2) => patchLens({ k2 }),
        }),
        mountSliderField(content, {
          label: t("lens.uiDistance"),
          value: settings.render.uiPlaneDistance,
          min: 1,
          max: 3,
          step: 0.05,
          format: (value) => `${value.toFixed(2)} m`,
          onChange: (uiPlaneDistance) => patch({ render: { ...settingsOf().render, uiPlaneDistance } }),
        }),
      ];
      patchers.push(() => {
        const lens = settingsOf();
        sliders[0]?.sync({ value: lens.render.ipdMeters });
        sliders[1]?.sync({ value: lens.lens.eyeGapPx });
        sliders[2]?.sync({ value: lens.lens.fovYDeg });
        sliders[3]?.sync({ value: lens.lens.frameScale });
        sliders[4]?.sync({ value: lens.lens.lensCenterOffset });
        sliders[5]?.sync({ value: lens.lens.k1 });
        sliders[6]?.sync({ value: lens.lens.k2 });
        sliders[7]?.sync({ value: lens.render.uiPlaneDistance });
      });
    }

    if (category === "gesture") {
      const a = mountSliderField(content, {
        label: t("gesture.sensitivity"),
        value: settings.gesture.sensitivity,
        min: 0.6,
        max: 1.6,
        step: 0.05,
        format: (value) => `${value.toFixed(2)}×`,
        onChange: (sensitivity) => patch({ gesture: { ...settingsOf().gesture, sensitivity } }),
      });
      const b = mountSliderField(content, {
        label: t("gesture.drag"),
        value: settings.gesture.dragThreshold,
        min: 0.004,
        max: 0.04,
        step: 0.002,
        format: (value) => `${(value * 100).toFixed(1)}%`,
        onChange: (dragThreshold) => patch({ gesture: { ...settingsOf().gesture, dragThreshold } }),
      });
      const c = mountSliderField(content, {
        label: t("gesture.hold"),
        value: settings.gesture.dragHoldMs,
        min: 200,
        max: 1200,
        step: 50,
        format: (value) => t("unit.ms", { value }),
        onChange: (dragHoldMs) => patch({ gesture: { ...settingsOf().gesture, dragHoldMs } }),
      });
      mountSwitchField(content, {
        label: t("gesture.snap"),
        checked: settings.flags.snapGesture,
        onChange: (snapGesture) => patch({ flags: { ...settingsOf().flags, snapGesture } }),
      });
      patchers.push(() => {
        const g = settingsOf();
        a.sync({ value: g.gesture.sensitivity });
        b.sync({ value: g.gesture.dragThreshold });
        c.sync({ value: g.gesture.dragHoldMs });
      });
    }

    if (category === "cursor") {
      const a = mountSliderField(content, {
        label: t("cursor.opacity"),
        value: settings.cursor.opacity,
        min: 0,
        max: 1,
        step: 0.05,
        format: (value) => `${Math.round(value * 100)}%`,
        onChange: (opacity) => patch({ cursor: { ...settingsOf().cursor, opacity } }),
      });
      const b = mountSliderField(content, {
        label: t("cursor.size"),
        value: settings.cursor.scale,
        min: 0.5,
        max: 2,
        step: 0.05,
        format: (value) => `${Math.round(value * 100)}%`,
        onChange: (scale) => patch({ cursor: { ...settingsOf().cursor, scale } }),
      });
      patchers.push(() => {
        const c = settingsOf().cursor;
        a.sync({ value: c.opacity });
        b.sync({ value: c.scale });
      });
    }

    if (category === "colour") {
      content.append(
        el("div", { className: "row" }, [
          el("button", { className: "chip", text: t("colour.reset"), onClick: () => patch({ theme: DEFAULT_THEME }) }),
        ]),
      );
      const labels = () => ({
        hue: t("colour.hue"),
        saturation: t("colour.saturation"),
        lightness: t("colour.lightness"),
        opacity: t("colour.opacity"),
      });
      content.append(el("h3", { text: t("colour.primary") }));
      const primary = sliderHsl(settings.theme.primary);
      const primaryGroup = mountColourGroup(content, {
        swatch: "primary",
        hue: primary.h,
        saturation: primary.s,
        lightness: primary.l,
        opacity: settings.theme.primaryOpacity,
        labels: labels(),
        onChange: ({ h, s, l, opacity }) =>
          patch({ theme: { ...settingsOf().theme, primary: hslToHex(h, s, l), primaryOpacity: opacity } }),
      });
      content.append(el("h3", { text: t("colour.accent") }));
      const accent = sliderHsl(settings.theme.accent);
      const accentGroup = mountColourGroup(content, {
        swatch: "accent",
        hue: accent.h,
        saturation: accent.s,
        lightness: accent.l,
        opacity: settings.theme.accentOpacity,
        labels: labels(),
        onChange: ({ h, s, l, opacity }) =>
          patch({ theme: { ...settingsOf().theme, accent: hslToHex(h, s, l), accentOpacity: opacity } }),
      });
      patchers.push(() => {
        const theme = settingsOf().theme;
        const p = sliderHsl(theme.primary);
        const a = sliderHsl(theme.accent);
        primaryGroup.sync({ hue: p.h, saturation: p.s, lightness: p.l, opacity: theme.primaryOpacity });
        accentGroup.sync({ hue: a.h, saturation: a.s, lightness: a.l, opacity: theme.accentOpacity });
      });
    }

    if (category === "pipeline") {
      const a = mountSliderField(content, {
        label: t("pipeline.handFps"),
        value: settings.pipeline.handTrackingFps,
        min: 8,
        max: 30,
        step: 1,
        format: (value) => t("unit.fps", { value }),
        onChange: (handTrackingFps) => patch({ pipeline: { ...settingsOf().pipeline, handTrackingFps } }),
      });
      const b = mountSliderField(content, {
        label: t("pipeline.moduleFps"),
        value: settings.pipeline.moduleFps,
        min: 2,
        max: 20,
        step: 1,
        format: (value) => t("unit.fps", { value }),
        onChange: (moduleFps) => patch({ pipeline: { ...settingsOf().pipeline, moduleFps } }),
      });
      const c = mountSliderField(content, {
        label: t("pipeline.analysisSize"),
        value: settings.pipeline.analysisMaxSize,
        min: 256,
        max: 768,
        step: 32,
        format: (value) => `${value} px`,
        onChange: (analysisMaxSize) => patch({ pipeline: { ...settingsOf().pipeline, analysisMaxSize } }),
      });
      patchers.push(() => {
        const p = settingsOf().pipeline;
        a.sync({ value: p.handTrackingFps });
        b.sync({ value: p.moduleFps });
        c.sync({ value: p.analysisMaxSize });
      });
    }

    if (category === "plugin") {
      const emptyNote = el("p", { className: "note", text: t("plugin.empty") });
      const rows: Array<{
        root: HTMLElement;
        title: HTMLElement;
        meta: HTMLElement;
        button: HTMLButtonElement;
      }> = [];
      content.append(emptyNote);
      const paintPlugins = () => {
        const list = useRuntimeStore.getState().plugins;
        emptyNote.hidden = list.length > 0;
        while (rows.length > list.length) rows.pop()?.root.remove();
        list.forEach((plugin, index) => {
          let row = rows[index];
          if (!row) {
            const title = el("strong");
            const meta = el("small");
            const button = el("button", { className: "chip" });
            const root = el("div", { className: "module-row" }, [el("div", {}, [title, meta]), button]);
            row = { root, title, meta, button };
            rows.push(row);
            content.append(root);
          }
          row.button.onclick = () => props.onTogglePlugin(plugin.id);
          if (row.title.textContent !== loc(plugin.title)) row.title.textContent = loc(plugin.title);
          const meta =
            t(pluginStateKey(plugin.state)) +
            (plugin.permissions.length > 0
              ? ` · ${plugin.permissions.map((permission) => t(permissionKey(permission))).join(", ")}`
              : "");
          if (row.meta.textContent !== meta) row.meta.textContent = meta;
          row.button.dataset.active = String(plugin.enabled);
          const label = plugin.enabled ? t("plugin.off") : t("plugin.on");
          if (row.button.textContent !== label) row.button.textContent = label;
        });
      };
      paintPlugins();
      patchers.push(paintPlugins);
    }

    if (category === "assistant") {
      const enabled = mountSwitchField(content, {
        label: t("assistant.enabled"),
        checked: settings.assistant.enabled,
        onChange: (next) => patch({ assistant: { ...settingsOf().assistant, enabled: next } }),
      });
      content.append(el("p", { className: "note", text: t("assistant.enabledHint") }));
      content.append(el("p", { className: "note", text: t("assistant.who", { name: ASSISTANT_NAME }) }));
      const statusChip = el("span", {
        className: "chip",
        dataset: { tone: stateTone(assistant.state) },
        text: t(assistantStateKey(assistant.state)),
      });
      const voiceChip = el("span", {
        className: "chip",
        dataset: { tone: voiceTone(assistant.voice) },
        text: t(assistantVoiceKey(assistant.voice)),
      });
      content.append(statusChip, voiceChip);
      const deviceNote = el("p", { className: "note" });
      const sourceNote = el("p", { className: "note" });
      const errorNote = el("p", { className: "note" });
      const issueNote = el("p", { className: "note" });
      const waitNote = el("p", { className: "note", text: t("assistant.voiceWait") });
      content.append(deviceNote, sourceNote, errorNote, issueNote, waitNote);
      content.append(el("h3", { text: t("assistant.models") }));
      const offlineNote = el("p", { className: "note", text: t("assistant.offline") });
      const offlineLoad = el("button", {
        className: "chip",
        text: t("assistant.load"),
        disabled: assistantBusy(assistant.state),
        onClick: () => props.onAssistantLoad(),
      });
      const catalogRows: Array<{ id: string; status: HTMLElement; button: HTMLButtonElement }> = [];
      if (assistant.catalog.length === 0) {
        content.append(offlineNote, offlineLoad);
      } else {
        for (const item of assistant.catalog) {
          const status = el("small", {
            text:
              t(assistantStateKey(item.state)) +
              (item.device ? ` · ${item.device}` : "") +
              (item.source ? ` · ${sourceFile(item.source)}` : ""),
          });
          const button = el("button", {
            className: "chip",
            dataset: { active: settings.assistant.modelId === item.id },
            disabled: assistantBusy(assistant.state),
            text: t("assistant.load"),
            onClick: () => {
              patch({ assistant: { ...settingsOf().assistant, modelId: item.id } });
              props.onAssistantLoad(item.id);
            },
          });
          catalogRows.push({ id: item.id, status, button });
          content.append(el("div", { className: "module-row" }, [el("div", {}, [el("strong", { text: item.id }), status]), button]));
        }
      }
      const ping = el("button", {
        className: "chip",
        text: t("assistant.ping"),
        disabled: !settings.assistant.enabled || assistant.state !== "ready",
        onClick: () => props.onAssistantAsk(t("assistant.pingPrompt")),
      });
      const talk = el("button", {
        className: "chip chip--hold",
        type: "button",
        dataset: { active: assistant.state === "listening" },
        disabled:
          !settings.assistant.enabled ||
          (assistant.state !== "listening" && (assistant.state !== "ready" || assistant.voice !== "ready")),
        text: assistant.state === "listening" ? t("assistant.talkHold") : t("assistant.talk"),
        onClick: () => props.onAssistantTalkStart(),
      });
      content.append(el("div", { className: "row" }, [ping]), talk);
      const greeting = mountTextField(content, {
        label: t("assistant.greeting"),
        value: settings.assistant.greeting[locale],
        maxLength: GREETING_MAX,
        onChange: (text) =>
          patch({
            assistant: {
              ...settingsOf().assistant,
              greeting: { ...settingsOf().assistant.greeting, [useLocaleStore.getState().locale]: text },
            },
          }),
      });
      content.append(el("p", { className: "note", text: t("assistant.greetingHint") }));
      patchers.push(() => {
        greeting.sync({ value: settingsOf().assistant.greeting[useLocaleStore.getState().locale] });
      });
      const listenWindow = mountSliderField(content, {
        label: t("assistant.listenWindow"),
        value: settings.assistant.listenSeconds,
        min: LISTEN_RANGE.min,
        max: LISTEN_RANGE.max,
        step: LISTEN_RANGE.step,
        format: (value) => t("unit.seconds", { value: value.toFixed(0) }),
        onChange: (listenSeconds) => patch({ assistant: { ...settingsOf().assistant, listenSeconds } }),
      });
      content.append(el("p", { className: "note", text: t("assistant.listenHint", { name: ASSISTANT_NAME }) }));
      patchers.push(() => {
        listenWindow.sync({ value: settingsOf().assistant.listenSeconds });
      });
      content.append(el("h3", { text: t("assistant.voiceTitle") }));
      content.append(el("p", { className: "note", text: t("assistant.voiceNote") }));
      const voice = settings.assistant.voice;
      const voiceSliders = [
        mountSliderField(content, {
          label: t("assistant.voicePitch"),
          value: voice.pitchHz,
          ...VOICE_RANGE.pitchHz,
          format: (value) => t("unit.hz", { value: value.toFixed(0) }),
          onChange: (pitchHz) => patchVoice({ pitchHz }),
        }),
        mountSliderField(content, {
          label: t("assistant.voiceSpeed"),
          value: voice.speed,
          ...VOICE_RANGE.speed,
          format: (value) => `${value.toFixed(2)}×`,
          onChange: (speed) => patchVoice({ speed }),
        }),
        mountSliderField(content, {
          label: t("assistant.voiceExpression"),
          value: voice.expression,
          ...VOICE_RANGE.expression,
          format: (value) => value.toFixed(2),
          onChange: (expression) => patchVoice({ expression }),
        }),
        mountSliderField(content, {
          label: t("assistant.voiceRhythm"),
          value: voice.rhythm,
          ...VOICE_RANGE.rhythm,
          format: (value) => value.toFixed(2),
          onChange: (rhythm) => patchVoice({ rhythm }),
        }),
        mountSliderField(content, {
          label: t("assistant.voicePause"),
          value: voice.pause,
          ...VOICE_RANGE.pause,
          format: (value) => t("unit.seconds", { value: value.toFixed(2) }),
          onChange: (pause) => patchVoice({ pause }),
        }),
      ];
      const preview = el("button", {
        className: "chip",
        text: t("assistant.voicePreview"),
        disabled: !settings.assistant.enabled || assistant.state !== "ready",
        onClick: () => props.onAssistantPreview(t("assistant.voiceSample")),
      });
      const resetVoice = el("button", {
        className: "chip",
        text: t("assistant.voiceReset"),
        onClick: () => patchVoice(DEFAULT_VOICE),
      });
      content.append(el("div", { className: "row" }, [preview, resetVoice]));
      patchers.push(() => {
        const live = settingsOf().assistant;
        const liveVoice = live.voice;
        voiceSliders[0]?.sync({ value: liveVoice.pitchHz });
        voiceSliders[1]?.sync({ value: liveVoice.speed });
        voiceSliders[2]?.sync({ value: liveVoice.expression });
        voiceSliders[3]?.sync({ value: liveVoice.rhythm });
        voiceSliders[4]?.sync({ value: liveVoice.pause });
        preview.disabled = !live.enabled || useRuntimeStore.getState().assistant.state !== "ready";
      });
      content.append(el("h3", { text: t("assistant.chat") }));
      const emptyNote = el("p", { className: "note", text: t("assistant.empty") });
      const chat = el("div", { className: "chat" });
      content.append(emptyNote, chat);
      const paint = (live: AssistantSnapshot, nextSettings: Settings) => {
        enabled.sync({ checked: nextSettings.assistant.enabled });
        statusChip.dataset.tone = stateTone(live.state);
        statusChip.textContent = t(assistantStateKey(live.state));
        voiceChip.dataset.tone = voiceTone(live.voice);
        voiceChip.textContent = t(assistantVoiceKey(live.voice));
        writeNote(deviceNote, live.device ? t("assistant.device", { device: live.device }) : "");
        writeNote(sourceNote, live.source ? sourceFile(live.source) : "");
        writeNote(errorNote, live.error ?? "");
        writeNote(issueNote, live.voiceIssue ? t(voiceIssueKey(live.voiceIssue)) : "");
        waitNote.hidden = !(live.state === "ready" && live.voice !== "ready");
        const locked = assistantBusy(live.state);
        offlineLoad.disabled = locked;
        for (const row of catalogRows) {
          const item = live.catalog.find((entry) => entry.id === row.id);
          if (!item) continue;
          row.status.textContent =
            t(assistantStateKey(item.state)) +
            (item.device ? ` · ${item.device}` : "") +
            (item.source ? ` · ${sourceFile(item.source)}` : "");
          row.button.disabled = locked;
          row.button.dataset.active = String(nextSettings.assistant.modelId === item.id);
        }
        ping.disabled = !nextSettings.assistant.enabled || live.state !== "ready";
        talk.disabled =
          !nextSettings.assistant.enabled ||
          (live.state !== "listening" && (live.state !== "ready" || live.voice !== "ready"));
        talk.dataset.active = String(live.state === "listening");
        talk.textContent = live.state === "listening" ? t("assistant.talkHold") : t("assistant.talk");
      };
      const paintReply = (live: AssistantSnapshot) => {
        const last = chat.lastElementChild;
        const turns = chatTurns(live).filter((item) => item.content.trim());
        const lastTurn = turns[turns.length - 1];
        if (
          last &&
          turns.length === chat.childElementCount &&
          lastTurn &&
          last instanceof HTMLElement &&
          last.dataset.role === lastTurn.role
        ) {
          const text = last.children[1] as HTMLElement | undefined;
          if (text && text.textContent !== lastTurn.content) text.textContent = lastTurn.content;
          emptyNote.hidden = true;
          return;
        }
        paintChat(chat, live);
        emptyNote.hidden = chat.childElementCount > 0;
      };
      paint(assistant, settings);
      paintReply(assistant);
      let shellKey = "";
      let replyKey = "";
      const syncAssistant = () => {
        const live = useRuntimeStore.getState().assistant;
        const nextSettings = settingsOf();
        const nextShell = [
          live.state,
          live.voice,
          live.error ?? "",
          live.device ?? "",
          live.source ?? "",
          live.voiceIssue ?? "",
          nextSettings.assistant.enabled,
          nextSettings.assistant.modelId,
          live.catalog.map((item) => `${item.id}:${item.state}`).join(","),
        ].join("|");
        const nextReply = `${live.messages.length}:${live.reply}`;
        if (nextShell !== shellKey) {
          shellKey = nextShell;
          paint(live, nextSettings);
        }
        if (nextReply !== replyKey) {
          replyKey = nextReply;
          paintReply(live);
        }
      };
      syncAssistant();
      patchers.push(syncAssistant);
    }

    if (category === "camera") {
      mountSwitchField(content, {
        label: t("camera.mirror"),
        checked: settings.render.mirrorFrontCamera,
        onChange: (mirrorFrontCamera) => patch({ render: { ...settingsOf().render, mirrorFrontCamera } }),
      });
    }

    if (category === "diagnostics") {
      const toggle = mountSwitchField(content, {
        label: t("diagnostics.toggle"),
        checked: diagnosticsOpen,
        onChange: useSharedUiStore.getState().setDiagnosticsOpen,
      });
      patchers.push(() => {
        toggle.sync({ checked: useSharedUiStore.getState().diagnosticsOpen });
      });
    }

    if (category === "log") paintLogSection(content);

    if (category === "language") {
      const row = el("div", { className: "row" });
      for (const value of LOCALES) {
        row.append(
          el("button", {
            className: "chip",
            dataset: { active: locale === value },
            text: languageName(value),
            onClick: () => useLocaleStore.getState().setLocale(value),
          }),
        );
      }
      content.append(row);
    }
  };

  const rebuild = () => {
    const ui = useSharedUiStore.getState();
    if (!ui.menuOpen) {
      menu?.remove();
      menu = null;
      strip = null;
      scroll?.dispose();
      scroll = null;
      viewKey = "";
      return;
    }
    if (!menu) {
      menu = el("section", { className: "menu" });
      parent.append(menu);
    }
    const locale = useLocaleStore.getState().locale;
    if (!ui.settingsDetail) {
      const key = `strip|${locale}`;
      if (viewKey !== key) {
        viewKey = key;
        scroll?.dispose();
        scroll = null;
        empty(menu);
        strip = MenuStrip(menu, stripProps());
      } else if (strip) {
        updateMenuStrip(strip, stripProps());
      }
      return;
    }
    const catalogIds =
      ui.settingsCategory === "assistant"
        ? useRuntimeStore.getState().assistant.catalog.map((item) => item.id).join(",")
        : "";
    const key = `detail|${ui.settingsCategory}|${locale}|${catalogIds}`;
    const keepControls = [
      "lens",
      "gesture",
      "cursor",
      "colour",
      "pipeline",
      "diagnostics",
      "assistant",
      "plugin",
    ].includes(ui.settingsCategory);
    if (viewKey === key && keepControls) {
      for (const run of patchers) run();
      return;
    }
    viewKey = key;
    strip = null;
    if (!scroll || !menu.contains(scroll.root)) {
      empty(menu);
      scroll = ScrollBox(menu, { id: MENU_SCROLL_KEY, className: "menu__body" });
      menu.append(
        el("button", {
          className: "menu__close",
          text: t("menu.back"),
          onClick: () => useSharedUiStore.getState().closeSettingsDetail(),
        }),
      );
    }
    fillDetail(scroll.content);
  };

  rebuild();
  const stop = [
    watch(useSharedUiStore, (state) => state.menuOpen, rebuild),
    watch(useSharedUiStore, (state) => state.settingsDetail, rebuild),
    watch(useSharedUiStore, (state) => state.settingsCategory, rebuild),
    watch(useSharedUiStore, (state) => state.settingsSlot, rebuild),
    watch(useSharedUiStore, (state) => state.settingsDrag, rebuild),
    watch(useSharedUiStore, (state) => state.diagnosticsOpen, rebuild),
    watch(useRuntimeStore, (state) => state.settings, rebuild),
    watch(useRuntimeStore, (state) => state.plugins, () => {
      if (useSharedUiStore.getState().settingsCategory !== "plugin") return;
      rebuild();
    }),
    watch(useRuntimeStore, (state) => state.assistant.catalog.map((item) => item.id).join(","), () => {
      if (useSharedUiStore.getState().settingsCategory !== "assistant") return;
      rebuild();
    }),
    watch(useRuntimeStore, (state) => state.assistant.reply, () => {
      const ui = useSharedUiStore.getState();
      if (!ui.menuOpen || !ui.settingsDetail || ui.settingsCategory !== "assistant") return;
      for (const run of patchers) run();
    }),
    watch(useRuntimeStore, (state) => state.assistant.state, () => {
      const ui = useSharedUiStore.getState();
      if (!ui.menuOpen || !ui.settingsDetail || ui.settingsCategory !== "assistant") return;
      for (const run of patchers) run();
    }),
    watch(useRuntimeStore, (state) => state.assistant.voice, () => {
      const ui = useSharedUiStore.getState();
      if (!ui.menuOpen || !ui.settingsDetail || ui.settingsCategory !== "assistant") return;
      for (const run of patchers) run();
    }),
    watch(useRuntimeStore, (state) => state.assistant.messages.length, () => {
      const ui = useSharedUiStore.getState();
      if (!ui.menuOpen || !ui.settingsDetail || ui.settingsCategory !== "assistant") return;
      for (const run of patchers) run();
    }),
    watch(useRuntimeStore, (state) => state.viewTurn, rebuild),
    watch(useRuntimeStore, (state) => state.deviceGrants, rebuild),
    watch(useLogStore, (state) => state.entries, () => {
      if (useSharedUiStore.getState().settingsCategory !== "log") return;
      rebuild();
    }),
    watchLocale(rebuild),
  ];

  return () => {
    for (const unsub of stop) unsub();
    scroll?.dispose();
    menu?.remove();
  };
};

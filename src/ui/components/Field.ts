import { el } from "../dom";

export const mountSliderField = (
  parent: ParentNode,
  options: {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    format?: (value: number) => string;
    onChange: (value: number) => void;
  },
): { sync: (next: { label?: string; value: number }) => void } => {
  const caption = el("span", { text: options.label });
  const readout = el("span", { text: options.format ? options.format(options.value) : String(options.value) });
  const input = el("input", {
    type: "range",
    min: options.min,
    max: options.max,
    step: options.step,
    value: options.value,
    onInput: (event) => options.onChange(Number((event.target as HTMLInputElement).value)),
  });
  parent.append(
    el("div", { className: "field" }, [el("label", {}, [caption, readout]), input]),
  );
  return {
    sync: (next) => {
      if (next.label !== undefined) caption.textContent = next.label;
      readout.textContent = options.format ? options.format(next.value) : String(next.value);
      if (input.value !== String(next.value)) input.value = String(next.value);
    },
  };
};

export const mountTextField = (
  parent: ParentNode,
  options: {
    label: string;
    value: string;
    maxLength: number;
    onChange: (value: string) => void;
  },
): { sync: (next: { label?: string; value: string }) => void } => {
  const caption = el("span", { text: options.label });
  const input = el("input", {
    type: "text",
    value: options.value,
    onInput: (event) => options.onChange((event.target as HTMLInputElement).value),
  });
  input.maxLength = options.maxLength;
  parent.append(el("div", { className: "field" }, [el("label", {}, [caption]), input]));
  return {
    sync: (next) => {
      if (next.label !== undefined) caption.textContent = next.label;
      if (input.value !== next.value) input.value = next.value;
    },
  };
};

export const mountSwitchField = (
  parent: ParentNode,
  options: {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  },
): { sync: (next: { label?: string; checked: boolean }) => void } => {
  const caption = el("span", { text: options.label });
  const input = el("input", {
    type: "checkbox",
    checked: options.checked,
    onChange: (event) => options.onChange((event.target as HTMLInputElement).checked),
  });
  parent.append(el("label", { className: "switch", dataset: { handTarget: true } }, [caption, input]));
  return {
    sync: (next) => {
      if (next.label !== undefined) caption.textContent = next.label;
      input.checked = next.checked;
    },
  };
};

export const mountColourGroup = (
  parent: ParentNode,
  options: {
    swatch: "primary" | "accent";
    hue: number;
    saturation: number;
    lightness: number;
    opacity: number;
    labels: Readonly<{ hue: string; saturation: string; lightness: string; opacity: string }>;
    onChange: (next: Readonly<{ h: number; s: number; l: number; opacity: number }>) => void;
  },
): {
  sync: (next: {
    hue: number;
    saturation: number;
    lightness: number;
    opacity: number;
    labels?: Readonly<{ hue: string; saturation: string; lightness: string; opacity: string }>;
  }) => void;
} => {
  parent.append(el("div", { className: "swatch", dataset: { swatch: options.swatch } }));
  const state = {
    h: options.hue,
    s: options.saturation,
    l: options.lightness,
    opacity: options.opacity,
  };
  const emit = (patch: Partial<typeof state>) => {
    Object.assign(state, patch);
    options.onChange({ ...state });
  };
  const hue = mountSliderField(parent, {
    label: options.labels.hue,
    value: Math.round(options.hue / 3.6),
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${value.toFixed(0)}%`,
    onChange: (pct) => emit({ h: pct * 3.6 }),
  });
  const sat = mountSliderField(parent, {
    label: options.labels.saturation,
    value: options.saturation,
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${value.toFixed(0)}%`,
    onChange: (s) => emit({ s }),
  });
  const light = mountSliderField(parent, {
    label: options.labels.lightness,
    value: options.lightness,
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${value.toFixed(0)}%`,
    onChange: (l) => emit({ l }),
  });
  const alpha = mountSliderField(parent, {
    label: options.labels.opacity,
    value: Math.round(options.opacity * 100),
    min: 0,
    max: 100,
    step: 1,
    format: (value) => `${value.toFixed(0)}%`,
    onChange: (pct) => emit({ opacity: pct / 100 }),
  });
  return {
    sync: (next) => {
      state.h = next.hue;
      state.s = next.saturation;
      state.l = next.lightness;
      state.opacity = next.opacity;
      hue.sync({
        ...(next.labels ? { label: next.labels.hue } : {}),
        value: Math.round(next.hue / 3.6),
      });
      sat.sync({
        ...(next.labels ? { label: next.labels.saturation } : {}),
        value: next.saturation,
      });
      light.sync({
        ...(next.labels ? { label: next.labels.lightness } : {}),
        value: next.lightness,
      });
      alpha.sync({
        ...(next.labels ? { label: next.labels.opacity } : {}),
        value: Math.round(next.opacity * 100),
      });
    },
  };
};

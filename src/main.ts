import { captureConsole } from "./core/observability/ConsoleLog";
import { currentLocale } from "./core/state/LocaleStore";
import { loadSettings } from "./core/state/settings";
import { applyTheme } from "./ui/theme";
import { mountApp } from "./app/App";

// Before anything else runs: a phone in a headset has no devtools, so whatever
// fails during startup has to be readable inside the app itself.
captureConsole();

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing");

// Keeps the CSS variables and the renderer reading the same colour tokens.
applyTheme(loadSettings().theme);

// The document is served in one language and read in another; hyphenation and
// screen readers go by this attribute, not by what the file was written in.
document.documentElement.lang = currentLocale();

mountApp(container);

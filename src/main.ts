import { initAccessKey } from "./core/auth/accessKey";
import { captureConsole } from "./core/observability/ConsoleLog";
import { currentLocale } from "./core/state/LocaleStore";
import { loadSettings } from "./core/state/settings";
import { loadInterfaceFont } from "./ui/font";
import { applyTheme } from "./ui/theme";
import { mountApp } from "./app/App";

captureConsole();

initAccessKey();

const container = document.getElementById("root");
if (!container) throw new Error("Root element missing");

applyTheme(loadSettings().theme);

document.documentElement.lang = currentLocale();

void loadInterfaceFont().then(() => mountApp(container));

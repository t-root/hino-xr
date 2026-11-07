import { sessionBootStep, type SessionBootStep } from "@/core/bootstrap/sessionBoot";
import { useRuntimeStore } from "@/core/state/RuntimeStore";
import { useSharedUiStore } from "@/core/state/SharedUiStore";
import { TEXT, type MessageKey } from "@/i18n/text";
import { el, watch } from "../dom";
import { t, watchLocale } from "../i18n/useText";

const BOOT_OUTRO_MS = 1100;

const reducedMotion = (): boolean =>
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const outroWait = (): number => (reducedMotion() ? 40 : BOOT_OUTRO_MS);

/** How long the HUD outro holds the overlay after the camera is revealed. */
export const bootOutroMs = outroWait;

const STEP_ORDER: readonly SessionBootStep[] = ["camera", "hands", "assistant", "voice", "ready"];

const STEP_LABEL: Readonly<Record<SessionBootStep, MessageKey>> = {
  camera: "start.busy",
  hands: "boot.log.hands",
  assistant: "boot.log.assistant",
  voice: "boot.log.voice",
  ready: "boot.log.ready",
};

type Milestone = Readonly<{ key: "init" | SessionBootStep; done: boolean }>;

/** Milestones reached so far: `init`, then one per boot step, in order. */
const milestones = (step: SessionBootStep): readonly Milestone[] => {
  const index = STEP_ORDER.indexOf(step);
  const entries: Milestone[] = [{ key: "init", done: true }];
  for (let i = 0; i <= index; i += 1) {
    entries.push({ key: STEP_ORDER[i], done: i < index || step === "ready" });
  }
  return entries;
};

/** The boot console is English in every language, like the filler lines between the milestones. */
const labelFor = (key: Milestone["key"]): string => TEXT[key === "init" ? "boot.log.init" : STEP_LABEL[key]].en;

/**
 * Filler chatter between the real milestones, never localised: a real boot
 * console prints kernel and service names verbatim in every locale, so
 * translating fake ones would only make them look less genuine.
 */
const FILLER_LINES: readonly string[] = [
  "Reached target Sockets.",
  "Reached target Paths.",
  "Basic System target reached.",
  "Multi-User System target reached.",
  "Starting Journal Service...",
  "Started Journal Service.",
  "Starting Load Kernel Modules...",
  "Started Load Kernel Modules.",
  "Starting udev Kernel Device Manager...",
  "Started udev Kernel Device Manager.",
  "Starting Network Time Synchronization...",
  "Started Network Time Synchronization.",
  "Starting D-Bus System Message Bus...",
  "Started D-Bus System Message Bus.",
  "Starting Login Service...",
  "Started Login Service.",
  "Starting Permit User Sessions...",
  "Started Permit User Sessions.",
  "Starting Network Manager...",
  "Started Network Manager.",
  "Starting Avahi mDNS/DNS-SD Stack...",
  "Started Avahi mDNS/DNS-SD Stack.",
  "Starting Hardware RNG Entropy Gatherer Daemon...",
  "Started Hardware RNG Entropy Gatherer Daemon.",
  "Starting Authorization Manager...",
  "Started Authorization Manager.",
  "Starting USB HID device enumeration...",
  "Started USB HID device enumeration.",
  "Detected device /dev/video0.",
  "Detected device /dev/video1.",
  "Loading kernel module: uvcvideo.",
  "Loading kernel module: snd_hda_intel.",
  "Starting Sound Card Daemon...",
  "Started Sound Card Daemon.",
  "Mounted /boot.",
  "Mounted /home.",
  "Starting irqbalance daemon...",
  "Started irqbalance daemon.",
  "Starting Disk Manager...",
  "Started Disk Manager.",
  "Starting Cache Cleanup...",
  "Started Cache Cleanup.",
  "Starting Time & Date Service...",
  "Started Time & Date Service.",
  "Starting Update UTMP about System Boot...",
  "Started Update UTMP about System Boot.",
  "Calibrating GPU shader cache.",
  "Allocating stereo depth buffer.",
  "Probing gesture sensor array.",
  "Initializing hand skeleton solver.",
  "Warming up inference runtime.",
  "System Logging Service starting...",
  "System Logging Service started.",
  "System Initialization starting...",
  "System Initialization started.",
  "System Time Synchronization starting...",
  "System Time Synchronization started.",
  "System Message Bus Socket starting...",
  "System Message Bus Socket started.",
  "System Security Services Daemon starting...",
  "System Security Services Daemon started.",
  "System Resource Monitor starting...",
  "System Resource Monitor started.",
  "System Power Management starting...",
  "System Power Management started.",
  "System Thermal Daemon starting...",
  "System Thermal Daemon started.",
  "System Clock Synchronization starting...",
  "System Clock Synchronization started.",
  "System Firmware Updater starting...",
  "System Firmware Updater started.",
  "System Crash Reporter starting...",
  "System Crash Reporter started.",
  "System Watchdog Timer starting...",
  "System Watchdog Timer started.",
  "System Audit Daemon starting...",
  "System Audit Daemon started.",
  "System Cryptographic Key Store starting...",
  "System Cryptographic Key Store started.",
  "System Hardware Abstraction Layer starting...",
  "System Hardware Abstraction Layer started.",
  "System Device Tree Overlay starting...",
  "System Device Tree Overlay started.",
  "System Entropy Pool starting...",
  "System Entropy Pool started.",
  "System Swap Manager starting...",
  "System Swap Manager started.",
  "System Performance Profiler starting...",
  "System Performance Profiler started.",
  "System Fault Recovery Service starting...",
  "System Fault Recovery Service started.",
  "System Calibration Service starting...",
  "System Calibration Service started.",
  "System Integrity Check starting...",
  "System Integrity Check started.",
  "System Policy Engine starting...",
  "System Policy Engine started.",
  "System Service Registry starting...",
  "System Service Registry started.",
  "System Event Dispatcher starting...",
  "System Event Dispatcher started.",
  "System Memory Allocator starting...",
  "System Memory Allocator started.",
  "System Process Scheduler starting...",
  "System Process Scheduler started.",
  "System Interrupt Controller starting...",
  "System Interrupt Controller started.",
  "System Bus Arbiter starting...",
  "System Bus Arbiter started.",
  "System Display Compositor starting...",
  "System Display Compositor started.",
  "System Input Router starting...",
  "System Input Router started.",
  "System Sensor Hub starting...",
  "System Sensor Hub started.",
  "System Vision Pipeline starting...",
  "System Vision Pipeline started.",
  "System Depth Mapper starting...",
  "System Depth Mapper started.",
  "System Spatial Anchor Service starting...",
  "System Spatial Anchor Service started.",
  "System Passthrough Compositor starting...",
  "System Passthrough Compositor started.",
  "System Gesture Dispatcher starting...",
  "System Gesture Dispatcher started.",
  "System Audio Router starting...",
  "System Audio Router started.",
  "System Voice Gateway starting...",
  "System Voice Gateway started.",
  "System Network Stack starting...",
  "System Network Stack started.",
  "System Storage Cache starting...",
  "System Storage Cache started.",
  "System Telemetry Collector starting...",
  "System Telemetry Collector started.",
  "System Diagnostics Agent starting...",
  "System Diagnostics Agent started.",
  "System Session Manager starting...",
  "System Session Manager started.",
  "System Boot Loader Interface starting...",
  "System Boot Loader Interface started.",
  "System Update Verifier starting...",
  "System Update Verifier started.",
  "System Locale Service starting...",
  "System Locale Service started.",
  "System Font Cache starting...",
  "System Font Cache started.",
  "System Shader Compiler starting...",
  "System Shader Compiler started.",
  "System Render Scheduler starting...",
  "System Render Scheduler started.",
  "System Initialization target reached.",
  "Reached target Local File Systems.",
  "Reached target Remote File Systems.",
  "System Time Synchronized target reached.",
  "System Update target reached.",
  "Mounting Kernel Debug File System...",
  "Mounted Kernel Debug File System.",
  "Mounting Temporary File System...",
  "Mounted Temporary File System.",
  "Remounting Root and Kernel File Systems...",
  "Remounted Root and Kernel File Systems.",
  "Checking File System on /dev/mmcblk0p2...",
  "File System check passed on /dev/mmcblk0p2.",
  "Starting Create System Users...",
  "Started Create System Users.",
  "Starting Apply Kernel Variables...",
  "Started Apply Kernel Variables.",
  "Starting Create Volatile Files and Directories...",
  "Started Create Volatile Files and Directories.",
];

const buildLine = (milestone: boolean): HTMLElement =>
  el("div", { className: milestone ? "boot-term__line boot-term__line--milestone" : "boot-term__line" }, [
    el("span", { className: "boot-term__tag" }),
    el("span", { className: "boot-term__text" }),
  ]);

const paintLine = (line: HTMLElement, text: string, done: boolean, milestone: boolean): void => {
  line.dataset.done = String(done);
  const tag = line.querySelector(".boot-term__tag");
  const body = line.querySelector(".boot-term__text");
  if (tag) tag.textContent = done ? (milestone ? "[ CORE ]" : "[ OK ]") : "[ .... ]";
  if (body) body.textContent = text;
};

/** Draws once from a shuffled bag, so the same line rarely repeats twice in a row. */
const fillerDeck = (): (() => string) => {
  let bag: number[] = [];
  return () => {
    if (bag.length === 0) {
      bag = FILLER_LINES.map((_, i) => i);
      for (let i = bag.length - 1; i > 0; i -= 1) {
        const j = Math.floor(Math.random() * (i + 1));
        [bag[i], bag[j]] = [bag[j], bag[i]];
      }
    }
    return FILLER_LINES[bag.pop() as number];
  };
};

const FILLER_INTERVAL_MS = 45;
const MAX_LINES = 120;

/** One line of the boot log: a filler sentence, or the n-th milestone. */
type BootEntry = Readonly<{ seq: number; filler: string | null; milestone: number }>;

/**
 * The boot log, held once for every eye (rules.md).
 *
 * Each eye mounts its own copy of the overlay; if each drew its own filler
 * lines it would shuffle its own deck on its own timer and the two eyes would
 * read different words at different moments. So there is one deck, one timer
 * and one ordered list of entries here, and every copy only redraws it.
 */
const bootLog = (() => {
  const listeners = new Set<() => void>();
  let entries: BootEntry[] = [];
  let seq = 0;
  let reachedCount = 0;
  let timer = 0;
  let nextFiller = fillerDeck();

  const push = (filler: string | null, milestone: number) => {
    seq += 1;
    entries.push({ seq, filler, milestone });
    if (entries.length > MAX_LINES) entries = entries.slice(-MAX_LINES);
  };
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const tick = () => {
    const ui = useSharedUiStore.getState();
    if (!ui.starting || ui.bootOutro) return;
    push(nextFiller(), -1);
    notify();
  };

  return {
    entries: (): readonly BootEntry[] => entries,
    /** Adds a line for every milestone reached since the last call. */
    reach(count: number): void {
      if (count <= reachedCount) return;
      while (reachedCount < count) push(null, reachedCount++);
      notify();
    },
    /** A new boot starts a new log. */
    reset(): void {
      entries = [];
      reachedCount = 0;
      nextFiller = fillerDeck();
    },
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      if (listeners.size === 1 && !reducedMotion()) timer = window.setInterval(tick, FILLER_INTERVAL_MS);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) window.clearInterval(timer);
      };
    },
  };
})();

/**
 * Terminal boot log while Core starts: a continuous stream of console lines
 * scrolls upward like a Linux boot, mundane service chatter mostly, with the
 * real boot milestones (camera, hands, assistant, voice, ready) printed in
 * their own tagged, coloured line so they stand out from the noise.
 *
 * Camera stays visible. Veil and log both mount on `.camera-frame` (rules.md). The square already bleeds a few pixels past the picture, so the
 * 50% black layer covers the camera without leaving the frame.
 */
export const LoadingOverlay = (frame: HTMLElement): (() => void) => {
  let shell: HTMLElement | null = null;
  let veil: HTMLElement | null = null;
  let term: HTMLElement | null = null;
  let cursor: HTMLElement | null = null;
  /** Lines drawn in this copy, by the shared log's sequence number. */
  const drawn = new Map<number, HTMLElement>();
  const milestoneEls = new Map<number, HTMLElement>();

  const tearDown = () => {
    shell?.remove();
    veil?.remove();
    shell = null;
    veil = null;
    term = null;
    cursor = null;
    drawn.clear();
    milestoneEls.clear();
  };

  /** Brings this copy's lines in line with the shared log. */
  const drawLog = () => {
    if (!term || !cursor) return;
    const entries = bootLog.entries();
    const keep = new Set(entries.map((entry) => entry.seq));
    for (const [seq, line] of drawn) {
      if (keep.has(seq)) continue;
      line.remove();
      drawn.delete(seq);
    }
    for (const entry of entries) {
      if (drawn.has(entry.seq)) continue;
      const milestone = entry.filler === null;
      const line = buildLine(milestone);
      if (milestone) milestoneEls.set(entry.milestone, line);
      else paintLine(line, entry.filler ?? "", true, false);
      term.insertBefore(line, cursor);
      drawn.set(entry.seq, line);
    }
  };

  const sync = () => {
    const ui = useSharedUiStore.getState();
    if (!ui.starting) {
      tearDown();
      bootLog.reset();
      return;
    }
    if (!shell || !veil || !term || !cursor) {
      tearDown();
      veil = el("div", { className: "start__veil" });
      cursor = el("div", { className: "boot-term__cursor", text: "_" });
      term = el("div", { className: "boot-term" }, [cursor]);
      const hud = el("div", { className: "boot-hud" }, [term]);
      shell = el("div", { className: "start start--boot", dataset: { boot: true } }, [hud]);
      shell.setAttribute("aria-label", t("start.booting"));
      shell.setAttribute("aria-busy", "true");
      frame.append(veil, shell);
    }
    const live = useRuntimeStore.getState();
    const reached = milestones(sessionBootStep(live));
    bootLog.reach(reached.length);
    drawLog();
    reached.forEach((entry, i) => {
      const line = milestoneEls.get(i);
      if (line) paintLine(line, labelFor(entry.key), entry.done, true);
    });
    shell.dataset.outro = String(ui.bootOutro);
    veil.dataset.outro = String(ui.bootOutro);
    shell.setAttribute("aria-busy", ui.bootOutro ? "false" : "true");
  };

  sync();
  const stop = [
    bootLog.subscribe(drawLog),
    watch(useSharedUiStore, (state) => state.starting, sync),
    watch(useSharedUiStore, (state) => state.bootOutro, sync),
    watch(useRuntimeStore, (state) => state.cameraState, sync),
    watch(useRuntimeStore, (state) => state.handStatus, sync),
    watch(useRuntimeStore, (state) => state.assistant.state, sync),
    watch(useRuntimeStore, (state) => state.assistant.voice, sync),
    watch(useRuntimeStore, (state) => state.assistant.greeted, sync),
    watch(useRuntimeStore, (state) => state.settings, sync),
    watchLocale(sync),
  ];
  return () => {
    for (const unsub of stop) unsub();
    tearDown();
  };
};

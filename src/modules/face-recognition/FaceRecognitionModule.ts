import { ASSETS } from "@/core/config";
import { createDetectorModule } from "@/core/modules/DetectorModule";
import type { ModuleContext, VisionModule } from "@/core/modules/module-contract";
import { SharedState } from "@/core/sync";
import { spawnInferenceWorker } from "@/core/workers/spawn";
import { fill } from "@/i18n/text";
import type { Locale } from "@/shared/contracts/locale";
import type { Detection, DetectionBatch, FramePacket } from "@/shared/contracts/vision";
import { EMBEDDING_MODEL_URL, FACE_MODEL_URL, ORT_BASE_URL, ORT_SCRIPT_URL } from "./assets";
import { faceRecognitionManifest } from "./manifest";
import { bestMatch, decodeEmbedding, toVector, type Sample } from "./matching";
import { addSample, createPerson, listPeople, removePerson, updatePerson, type Person, type PersonFields } from "./peopleApi";
import { mountFaceScreen } from "./screen";
import text from "./text.json";

/** Lower than a person detector's: a face half turned away still scores well below one straight on. */
const MIN_CONFIDENCE = 0.4;
const MAX_RESULTS = 8;
/** A face that matched a person and is not matched for a moment (blink, turn) keeps the name for this long, ms. */
const STICKY_MS = 1500;
/** The face the wearer means is the biggest one seen in the last few seconds, ms. */
const FOCUS_MS = 3000;
/** What was said about a stranger so far is kept this long for the next sentence, ms. */
const DRAFT_MS = 90_000;
const INFO_IN_LABEL = 36;

export type TextKey = Exclude<keyof typeof text, "displayName" | "description">;

export type FaceStatus =
  | Readonly<{ kind: "none" }>
  | Readonly<{ kind: "unknown" }>
  | Readonly<{ kind: "known"; person: Person }>;

export type ScreenState = {
  locale: Locale;
  people: readonly Person[];
  face: FaceStatus;
  mode: "idle" | "edit" | "list";
  form: { id: string | null; name: string; year: string; info: string };
  busy: boolean;
  message: string;
};

type Seen = { personId: string | null; at: number };
type Focus = { vector: Float32Array; personId: string | null; area: number; at: number };
type Draft = { name?: string; year?: number; info?: string; at: number };

const EMPTY_FORM = { id: null, name: "", year: "", info: "" } as const;

const shorten = (value: string, limit: number): string => (value.length > limit ? `${value.slice(0, limit - 1)}…` : value);

/** What is printed beside a face that is known: name, year of birth, and the start of the note. */
export const labelFor = (person: Person): string =>
  [person.name, person.year ?? "", shorten(person.info, INFO_IN_LABEL)].filter((part) => part !== "").join(" - ");

/**
 * Face recognition: where the faces are, and whose.
 *
 * The detector finds each face and turns it into 128 numbers (in its worker; no picture is kept). Here those
 * numbers are matched to the people saved on the model server, and the name, year of birth and note of the
 * match are written beside the face. The same people are added, edited and removed on this plugin's own screen
 * and by voice ("save this person, name ...", in either language), which Core hands over as the `person` command.
 */
class FaceRecognitionModule implements VisionModule {
  readonly manifest = faceRecognitionManifest;

  readonly state = new SharedState<ScreenState>({
    locale: "vi",
    people: [],
    face: { kind: "none" },
    mode: "idle",
    form: { ...EMPTY_FORM },
    busy: false,
    message: "",
  });

  private readonly detector = createDetectorModule({
    manifest: faceRecognitionManifest,
    createWorker: () => spawnInferenceWorker("modules/face-recognition/face.worker.ts"),
    init: {
      wasmBase: ASSETS.wasmBase,
      modelUrl: FACE_MODEL_URL,
      scoreThreshold: MIN_CONFIDENCE,
      options: {
        maxResults: MAX_RESULTS,
        embeddingUrl: EMBEDDING_MODEL_URL,
        ortScriptUrl: ORT_SCRIPT_URL,
        ortBase: ORT_BASE_URL,
      },
    },
    // Faces leave the frame and come back constantly, so an id is held a little longer than a body's.
    maxMissedFrames: 10,
  });

  private context: ModuleContext | null = null;
  private people: readonly Person[] = [];
  private samples: Sample[] = [];
  private readonly seen = new Map<string, Seen>();
  private focus: Focus | null = null;
  private pending: Float32Array | null = null;
  private draft: Draft | null = null;

  async initialize(context: ModuleContext): Promise<void> {
    this.context = context;
    await this.detector.initialize(context);
    this.state.set({ locale: context.locale() });
    context.screen?.show((element) => mountFaceScreen(element, this));
    await this.reload();
  }

  async process(frame: FramePacket, signal: AbortSignal): Promise<DetectionBatch> {
    const batch = await this.detector.process(frame, signal);
    const locale = this.context?.locale() ?? "vi";
    const now = performance.now();
    // Held in an object so the biggest face found while mapping is seen after the map, not narrowed away.
    const biggest: { face: Focus | null } = { face: null };

    const detections = batch.detections.map((detection): Detection => {
      const { embedding: code, ...rest } = detection.attributes ?? {};
      const vector = typeof code === "string" ? decodeEmbedding(code) : null;
      let personId: string | null | undefined;
      const before = this.seen.get(detection.id);

      if (vector) {
        personId = bestMatch(vector, this.samples)?.personId ?? null;
        if (personId === null && before?.personId && now - before.at < STICKY_MS) personId = before.personId;
        this.seen.set(detection.id, { personId, at: now });
        const area = detection.bounds.width * detection.bounds.height;
        if (!biggest.face || area > biggest.face.area) biggest.face = { vector, personId, area, at: now };
      } else if (before && now - before.at < STICKY_MS * 2) {
        personId = before.personId;
      }

      const person = personId ? this.people.find((item) => item.id === personId) : undefined;
      if (person) {
        return {
          ...detection,
          label: labelFor(person),
          attributes: { ...rest, identified: true, personId: person.id, plainLabel: true },
        };
      }
      if (personId === null) {
        return { ...detection, label: text.unknown[locale], attributes: { ...rest, identified: false, plainLabel: true } };
      }
      return { ...detection, label: text.face[locale], attributes: rest };
    });

    for (const [id, item] of this.seen) if (now - item.at > STICKY_MS * 4) this.seen.delete(id);
    if (biggest.face) this.focus = biggest.face;
    this.publishFace(locale, now);
    return { ...batch, detections };
  }

  async setEnabled(enabled: boolean): Promise<void> {
    await this.detector.setEnabled(enabled);
    if (!enabled) {
      this.seen.clear();
      this.focus = null;
    }
  }

  async dispose(): Promise<void> {
    this.seen.clear();
    await this.detector.dispose();
  }

  // ---- the people ----

  say(key: TextKey, values?: Record<string, string | number>): string {
    return fill(text[key][this.context?.locale() ?? "vi"], values);
  }

  private async reload(): Promise<void> {
    try {
      this.people = await listPeople();
    } catch (error) {
      this.people = [];
      this.state.set({ message: this.failure(error) });
    }
    this.samples = this.people.flatMap((person) =>
      person.samples.flatMap((values) => {
        const vector = toVector(values);
        return vector ? [{ personId: person.id, vector }] : [];
      }),
    );
    this.state.set({ people: this.people });
  }

  private failure(error: unknown): string {
    const reason = error instanceof Error ? error.message : String(error);
    return reason === "offline" ? this.say("offline") : this.say("failed", { reason });
  }

  /** The face the wearer means, as numbers: the biggest one seen in the last few seconds. */
  private currentFace(now = performance.now()): Focus | null {
    return this.focus && now - this.focus.at < FOCUS_MS ? this.focus : null;
  }

  private publishFace(locale: Locale, now: number): void {
    const face = this.currentFace(now);
    const person = face?.personId ? this.people.find((item) => item.id === face.personId) : undefined;
    const next: FaceStatus = !face ? { kind: "none" } : person ? { kind: "known", person } : { kind: "unknown" };
    const current = this.state.get();
    const same =
      current.face.kind === next.kind &&
      (next.kind !== "known" || (current.face.kind === "known" && current.face.person === next.person));
    if (!same || current.locale !== locale) this.state.set({ face: next, locale });
  }

  // ---- what the screen asks for ----

  beginAdd(): void {
    const face = this.currentFace();
    if (!face) {
      this.state.set({ message: this.say("noFace") });
      return;
    }
    this.pending = Float32Array.from(face.vector);
    this.state.set({ mode: "edit", form: { ...EMPTY_FORM }, message: "" });
  }

  beginEdit(id: string): void {
    const person = this.people.find((item) => item.id === id);
    if (!person) return;
    this.pending = null;
    this.state.set({
      mode: "edit",
      form: { id, name: person.name, year: person.year === null ? "" : String(person.year), info: person.info },
      message: "",
    });
  }

  setField(field: "name" | "year" | "info", value: string): void {
    this.state.set({ form: { ...this.state.get().form, [field]: value } });
  }

  showList(): void {
    this.state.set({ mode: "list", message: "" });
  }

  close(): void {
    this.pending = null;
    this.state.set({ mode: "idle", form: { ...EMPTY_FORM } });
  }

  async submit(): Promise<void> {
    const { form } = this.state.get();
    const name = form.name.trim();
    if (!name) {
      this.state.set({ message: this.say("needName") });
      return;
    }
    const year = form.year.trim() === "" ? null : Number(form.year);
    if (year !== null && !Number.isInteger(year)) {
      this.state.set({ message: this.say("badYear") });
      return;
    }
    this.state.set({ busy: true, message: "" });
    try {
      if (form.id) {
        await updatePerson(form.id, { name, year, info: form.info });
        this.state.set({ message: this.say("updated", { name }) });
      } else {
        await createPerson({ name, year, info: form.info }, this.pending ? Array.from(this.pending) : null);
        this.state.set({ message: this.say("saved", { name }) });
      }
      this.close();
      await this.reload();
    } catch (error) {
      this.state.set({ message: this.failure(error) });
    } finally {
      this.state.set({ busy: false });
    }
  }

  /** Another look at someone already saved, so they are known in more light and from more angles. */
  async addSampleToFace(): Promise<void> {
    const face = this.currentFace();
    const person = face?.personId ? this.people.find((item) => item.id === face.personId) : undefined;
    if (!face || !person) return;
    try {
      await addSample(person.id, Array.from(face.vector));
      this.state.set({ message: this.say("sampleAdded", { name: person.name }) });
      await this.reload();
    } catch (error) {
      this.state.set({ message: this.failure(error) });
    }
  }

  async remove(id: string): Promise<void> {
    try {
      await removePerson(id);
      this.state.set({ message: this.say("removed") });
      await this.reload();
    } catch (error) {
      this.state.set({ message: this.failure(error) });
    }
  }

  // ---- what is said ----

  /**
   * "Save this person, name ..., born ..., info ..." (or the same in Vietnamese), worked out by the server and handed over here. The face
   * is the one in front of the camera. A stranger needs a name before they are saved; whatever was said so far
   * waits a minute and a half for the rest.
   */
  async command(name: string, payload: Readonly<Record<string, unknown>>): Promise<string | null> {
    if (name !== "person") return null;
    const said: PersonFields & { year?: number } = {
      ...(typeof payload.name === "string" && payload.name !== "" ? { name: payload.name } : {}),
      ...(typeof payload.year === "number" ? { year: payload.year } : {}),
      ...(typeof payload.info === "string" && payload.info !== "" ? { info: payload.info } : {}),
    };
    const face = this.currentFace();
    if (!face) return this.say("noFace");

    try {
      const person = face.personId ? this.people.find((item) => item.id === face.personId) : undefined;
      if (person) {
        if (Object.keys(said).length === 0) {
          await addSample(person.id, Array.from(face.vector));
          await this.reload();
          return this.say("known", { name: person.name });
        }
        await updatePerson(person.id, said);
        await this.reload();
        return this.say("updated", { name: said.name ?? person.name });
      }

      const now = performance.now();
      const draft: Draft = { ...(this.draft && now - this.draft.at < DRAFT_MS ? this.draft : {}), ...said, at: now };
      if (!draft.name) {
        this.draft = draft;
        return this.say("askName");
      }
      await createPerson({ name: draft.name, ...(draft.year !== undefined ? { year: draft.year } : {}), info: draft.info ?? "" }, Array.from(face.vector));
      this.draft = null;
      await this.reload();
      return draft.year !== undefined
        ? this.say("savedWithYear", { name: draft.name, year: draft.year })
        : this.say("saved", { name: draft.name });
    } catch (error) {
      return this.failure(error);
    }
  }
}

export const createFaceRecognitionModule = (): VisionModule => new FaceRecognitionModule();
export type FaceController = FaceRecognitionModule;

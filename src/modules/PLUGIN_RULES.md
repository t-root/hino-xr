# Plugin rules

Read by the assistant every time it writes or changes a plugin (`assistant/models/pluginsmith.py` puts this file into the
prompt), and by whoever writes one by hand. It is written in English because the model that writes plugins is prompted in
English. Most rules are checked by the tests (`python run.py test`); a plugin that breaks them is refused or fails the build.
The rules for Core, the assistant and the server are in `rules.md` at the root, not here.

## 1. What a plugin is

A plugin is one folder, `src/modules/<id>/` (`<id>` is kebab-case and equals `manifest.id`). Everything it owns is in
that folder and nowhere else: no other file is created or edited to install it, and nothing in Core names it. The build
finds it by its `plugin.ts`.

| File | Role |
|---|---|
| `plugin.ts` | `definePlugin({ manifest, load })`. Imports only `./manifest` and `@/core/modules/definePlugin`; everything else is loaded by `await import()` inside `load`, so a plugin that is off costs nothing. |
| `manifest.ts` | id, version, name and description (from `text.json`), `input`, `outputKinds`, `execution`, `permissions`. |
| `text.json` | Every word the wearer can see, in both `vi` and `en`. |
| `Module.ts` (or any names) | The plugin itself: a `VisionModule` (`initialize`, `process`, `setEnabled`, `dispose`; optional `command`). |
| `models.json`, `vendor.json` | Only when the plugin needs files or packages. Python downloads them **into the plugin folder** (`models/`, `vendor/`). Never edit these two files. |

When you write a new plugin you write `Module.ts` only: the other files are made from your META. When you change a
plugin you may change any `.ts`, `.json` (not `models.json`, `vendor.json`) or `.css` file of it, and add none.

## 2. Imports and code you may not use

- Import only from the plugin's own folder (`./...`) and from `@/core/...`, `@/shared/...`, `@/i18n/text`, `@/ui/theme`,
  `@/env`. Never from another plugin (`../<other>`, `@/modules/...`): what two plugins need belongs in Core, not in one of them.
- From Core (`@/...`) import names, never a default export: the page gives the plugin the app's own copy of that module, and a
  plugin's file is built apart from the app and swapped in while the server runs.
- No `eval`, `Function`, dynamic `import()` of a URL or a computed path, `require`, `Proxy`, `Reflect`, `prototype`,
  `__proto__`, `.constructor`, `import.meta`, `<script>`, `ServiceWorker`, `SharedWorker`.
- No Node.js and no npm. A package the plugin needs goes in its `vendor.json`; you do not add one.
- Do not open the camera (`getUserMedia`): the camera is Core's. The plugin receives `FramePacket`s.
- Do not touch the page outside what Core hands over: the only element a plugin may fill is its own screen (section 7).

## 3. Words, language and glyphs

- Every visible word lives in `text.json` with both `vi` and `en`, and is read with `context.locale()` at the moment it is
  shown (the language can change while the plugin runs). No Vietnamese in `.ts` files, comments included.
- No emoji, arrows or icon glyphs in code or text. Draw shapes with CSS or canvas.

## 4. Colour and CSS

- No colour literals (`#...`, `rgb(`, `hsl(`, `0x......`). Take colours from `@/ui/theme` (`uiColor(alpha)`,
  `uiColorHex()`, `ALPHA`) so the plugin follows the wearer's theme.
- Every selector sits under one root class of the plugin (for example `.my-plugin .row`). Never style a selector of Core.
- Corners are square: `border-radius: 0`, and no `quadraticCurveTo`, `arcTo` or `roundRect` in canvas code. Panels are translucent, not opaque.
- No `overflow: auto` or `overflow: scroll`: content that is too long is cut, not scrolled.

## 5. Two eyes: what is drawn on screen is drawn twice

The interface is drawn **once per eye**: two DOM copies that must always look identical. Core gives the tools in
`@/core/sync`; use them and invent nothing:

| You need | Use | Never |
|---|---|---|
| What is shown: step, button, choice | `SharedState`: copies draw from it, a press writes to it | State kept in a variable of one copy |
| A widget with its own view (pan, zoom) | `CopySync` | Each copy moving by itself |
| Painted pixels (canvas, WebGL, image) | `CanvasMirror`: draw once into a source, copy to every eye | A `<canvas>` or `<img>` per eye |
| Animation, a loop | `frameClock.onFrame(...)` | `requestAnimationFrame`, `setInterval` |
| Hover | Write every `:hover` rule together with `[data-twin-hover]` | A `:hover` rule alone |
| Randomness | Make the number once, keep it in the shared state | `Math.random()` inside a copy |

- Do not create `<video>`, `<iframe>`, `<audio>`, `<canvas>`, `<img>` yourself; Core's `runtime.media` and `CanvasMirror` do.
- `setTimeout` is only for changing shared state (a debounce), never for drawing.
- Do not measure the DOM of one copy to decide what to show. The size is Core's; both eyes have the same frame.
- A third-party library with a clock of its own must have its animations switched off.

## 6. A detector plugin (the default)

- `process(frame, signal)` is called with one downscaled frame and returns a `DetectionBatch`: boxes in `0..1`
  coordinates (`x`, `y`, `width`, `height`), each with `id`, `kind`, `confidence`, `label`. Core draws the boxes and labels.
  The plugin never draws its own overlay.
- Honour `signal`: Core aborts work that outlives its frame. Return fast; a slow plugin is slowed down, then failed after five
  bad frames in a row.
- The label is chosen with the locale at the time of the frame: `text.label[context.locale()]`.
- Take the bitmap you are given as read-only and do not keep it beyond the call.
- A model that runs in a worker is declared in `models.json` and used through `createDetectorModule` (see the plugins
  `object-detection`, `person-detection`, `face-recognition`). A quantised int8 model runs on the CPU only.

## 7. A plugin with a screen of its own (permission `screen`)

- `context.screen?.show((element) => { ...; return () => { /* take this copy down */ }; })`. Core calls the function once
  per eye, with an empty element, now and again whenever the eyes are rebuilt. Draw each copy from one shared state.
- The screen is a box of 50% of the camera frame, in the middle. Size things with `@container` and `cqi`, not `@media`, `vw`
  or `vh`. Opening it closes Core's menu; `context.screen.close()` switches the plugin off.
- The hand cursor is always above everything. Do not give anything a `z-index` near `2147483647`.

## 8. Permissions

`META.permissions` lists what the plugin needs; ask for the least. `camera-frame` is always there.
`network` is for anything that sends data off the device (frames, crops, results, text): fetching a model file from a pinned
URL is not that. `snapshot` keeps a still of the camera past the frame it was given. `screen` is section 7. The plugins the
assistant writes (ids that begin with `ai-`) are granted what they ask for after the wearer approves them.

## 9. Using an AI model from a plugin

A plugin never loads a model of its own for language, and never holds a key. To ask the language model, send the question to
the server of the project, which has a stage for plugins that is not the assistant's:

`POST ${ENV.BASE_URL}api/plugin-ai/chat` with `{ "messages": [{ "role": "user", "content": "..." }], "maxTokens": 256 }`,
answered by `{ "text": "..." }`. Send it with `withAccessKey` from `@/core/auth/accessKey`, ask for the `network`
permission, send nothing the wearer did not expect, handle a failure (the server answers 503 when the model is down) and
say so with a `LocalizedError` from `text.json`.

## 10. Clean up and fail softly

- `setEnabled(false)` stops everything the plugin is doing. `dispose()` removes every listener, timer, WebGL context and
  pending request. Switching a plugin off and on must leave nothing running behind.
- Core catches an error thrown by `process()` or while drawing a screen, but the plugin handles its own network and data
  errors and reports them with a `LocalizedError` (words from `text.json`).
- Keep a plugin small: one file under 200 lines if it can be.

## 11. Before it counts as done

`python run.py test` passes, the plugin builds, and with stereo on the two eyes are identical when you press, drag, hover,
open a modal, rotate and switch between mono and stereo. Switch it off and on again and nothing is left running.

# AiRA workout starter

A local browser harness derived from AiRA API and AiRA client code. Read the short assignment in [docs/EXERCISE.md](docs/EXERCISE.md).

## Run

Requires Node.js 22.18 or later and npm. From this directory:

```sh
npm ci --ignore-scripts
npm start
```

Open http://127.0.0.1:4319. Stop with Ctrl+C. Change `PORT` in a local `.env` if needed.

The app starts in Mock and needs no account or key. **Load wiring sample** displays generic component examples. Mock accepts `/demo`, `next`, `back`, and `change value to 6`; it does not interpret the skill or arbitrary messages. Use your editor to change files. Prompt/skill edits load on the next request; source changes need a restart and browser reload.

## Files

- `skills/workout.md`: your interaction instructions.
- `prompts/`: output protocol and current-turn context.
- `src/shared/openui/`: parser, component registry, validation, navigation, timers and serialization.
- `src/web/`: browser renderers and presentation.
- `src/server/`: prompt loading, local HTTP server, mock and model adapters.
- `examples/wiring.openui`: generic offline fixture.

See [AiRA harness](docs/HARNESS.md) for the included plumbing and [runtime setup](docs/RUNTIMES.md) for optional model adapters.

## Check and package

```sh
npm run check
npx playwright install chromium
npm run test:ui
npm run package
```

The browser checks start a mock server on port 4320 from the current `dist/` build, so run `npm run check` (or `npm run build`) first. They need either Playwright's bundled Chromium (`npx playwright install chromium`, a one-time download) or an installed Chrome. To use an installed Chrome instead, set `PLAYWRIGHT_CHROME_PATH` to its absolute executable path; on macOS:

```sh
PLAYWRIGHT_CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" npm run test:ui
```

If the variable points to a missing or non-executable file, the run stops with a configuration error instead of falling back to another browser. Without the variable, an error mentioning `ms-playwright/.../headless_shell` means the bundled Chromium is not installed; install it or set `PLAYWRIGHT_CHROME_PATH`.

Packaging writes `output/workout-source.zip` locally. It includes source and records changes against this starter's baseline; it excludes `.env`, dependencies, build output and repository history. It does not submit anything. Builder tools can export a local run; optional run JSON files can be placed in `runs/`. Keep credentials out of source and exports.

The supplied tests exercise local harness behavior with fake transports. Live OpenAI and Claude requests have not been verified. The optional Ollama RunQuest narration is described in [runtime setup](docs/RUNTIMES.md): copy `.env.example` to `.env`, set `ALLOW_OLLAMA=true`, run `npm start` and select Ollama. Ollama is only checked or started when you select it; models are never downloaded. This browser slice is not the production AiRA application.

# AiRA workout starter

A local browser harness derived from AiRA API and AiRA client code. Read the short assignment in [docs/EXERCISE.md](docs/EXERCISE.md).

**RunQuest** is the experience built on this starter: a five-screen fictional story about fitting running into a busy week, with two decisions and four fixed endings. Trusted app code owns every screen and transition. With the optional local Ollama runtime you can answer in your own words, and story passages are lightly reworded. See [the submission summary](docs/SUBMISSION.md) for what was built and what was tested.

## Run

Requires Node.js 22.18 or later and npm. From this directory:

```sh
npm ci --ignore-scripts
npm start
```

Open http://127.0.0.1:4319. Stop with Ctrl+C. Change `PORT` in a local `.env` if needed.

The app starts in Mock and needs no account or key. **Start RunQuest** (or `/runquest`) plays the full journey with the on-screen buttons; typing a button's exact label works too. **Load wiring sample** displays generic component examples. Mock accepts `/demo`, `next`, `back`, and `change value to 6`; it makes no model calls and does not interpret the skill or other messages. Answering in your own words needs the Ollama runtime. Use your editor to change files. Prompt/skill edits load on the next request. With `npm start`, source changes need a restart and browser reload; `npm run dev` does both for you.

## Optional: RunQuest with local Ollama

Mock is the default and needs nothing beyond the steps above. Ollama is an optional extra that lets you answer RunQuest in your own words and lightly rewords story passages. Nothing in `npm ci`, `npm start`, `npm run dev` or `npm run package` installs Ollama or downloads a model.

1. Install Ollama yourself from [ollama.com/download](https://ollama.com/download).
2. Download the default model once and confirm it is listed:

   ```sh
   ollama pull llama3.2:3b
   ollama list
   ```

3. Copy `.env.example` to `.env` (ignored by Git) and set:

   ```sh
   ALLOW_OLLAMA=true
   # Optional; these are the defaults.
   OLLAMA_MODEL=llama3.2:3b
   OLLAMA_URL=http://localhost:11434
   # Optional; blank checks /opt/homebrew/bin, /usr/local/bin and the Ollama.app bundle.
   OLLAMA_CLI_PATH=
   ```

   `OLLAMA_URL` must be a local `http` address (`localhost`, `127.0.0.1` or `[::1]`). `OLLAMA_CLI_PATH`, if set, must be the absolute path of the `ollama` executable. `llama3.2:3b` is the model this project was built and manually checked with; other models can be named but have not been verified.

4. Start the Ollama service, or let the app do it. Open the Ollama app or run `ollama serve`, then check that it responds:

   ```sh
   curl http://localhost:11434/api/version
   ```

   If nothing is responding when you select Ollama, the app starts `ollama serve` itself on macOS and stops it again when the app exits. On other platforms, start Ollama yourself first.

5. Run `npm start` (or `npm run dev`); both load `.env`. Open http://127.0.0.1:4319, choose **Ollama** in **Run with** and wait for *Ollama ready*. Tick the consent box, then choose **Start RunQuest**. Restart the app after editing `.env` with `npm start`; `npm run dev` restarts on its own.

Troubleshooting (the selector shows what is wrong):

- *Set ALLOW_OLLAMA=true in local .env*: the variable is missing or the app was not restarted. `.env` is only read by `npm start` and `npm run dev`.
- *Ollama is not responding* or *did not become ready*: start the Ollama app or `ollama serve`, check `curl http://localhost:11434/api/version` (or your `OLLAMA_URL`), then select Ollama again.
- *The Ollama executable was not found*: install Ollama, or set `OLLAMA_CLI_PATH` to its absolute path and restart.
- *Model … is not installed*: run `ollama pull` with the model named in `OLLAMA_MODEL`, check `ollama list`, then select Ollama again.

Inference runs entirely on your machine; no cloud fallback is used. Speed depends on your hardware, and the first request after Ollama starts includes loading the model. If a rewrite is slow or rejected, the original story text is shown and the journey still advances. See [runtime setup](docs/RUNTIMES.md) for details.

## Develop

```sh
npm run dev
```

Leave it running and edit in your editor. It runs one TypeScript watcher and one server (same `.env` handling as `npm start`, plus a development-only refresh channel that `npm start` never enables):

- `src/server/**` or `src/shared/**` `.ts` changes: rebuild, restart the server, then open pages reload.
- `src/web/*.ts` or `src/web/index.html` changes: rebuild or copy, open pages reload; the server keeps running.
- `src/web/styles.css` changes: the stylesheet is replaced in place without a reload.
- `.env` changes: the server restarts automatically with the new values. If you change `PORT`, open the new address yourself.
- `prompts/` and `skills/` edits need nothing; they load on the next request.

A page reload or server restart clears the in-browser run (conversation, screens and the Ollama selection), as a manual reload would; select Ollama again after a restart. A running Ollama service is reused, not started twice. TypeScript errors are printed in the terminal; the last emitted output still runs. Stop with Ctrl+C. `npm run dev` and `npm start` both use `PORT` (default 4319), so run one at a time or set a different `PORT`.

## Files

- `skills/workout.md`: the RunQuest design brief (audience, voice, conversational behavior, safety).
- `src/server/runquest.ts`: the RunQuest state machine: screens, choices, transitions and endings.
- `src/server/ollama.ts`, `src/server/ollama-runtime.ts`: local Ollama classification, narration and service readiness.
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

Packaging writes `output/workout-source.zip`, `output/submission-manifest.json` and `output/SHA256.txt` locally. The ZIP holds the listed top-level files and the `src`, `skills`, `tests`, `scripts`, `docs`, `runs`, `evidence`, `prompts` and `examples` folders, plus a manifest of changes against this starter's baseline. It excludes `.env` and other dotfiles, dependencies, build output, test reports and repository history, and refuses symbolic links and likely credentials. It does not build, test or submit anything, so run the checks first. Builder tools can export a local run; optional run JSON files can be placed in `runs/`. Keep credentials out of source and exports.

The automated tests exercise local behavior with fake transports, including the Ollama adapter; they do not call a real model. Live OpenAI and Claude requests have not been verified. The optional Ollama RunQuest runtime (typed decisions and narration) is described in [runtime setup](docs/RUNTIMES.md): copy `.env.example` to `.env`, set `ALLOW_OLLAMA=true`, run `npm start` and select Ollama. Ollama is only checked or started when you select it; models are never downloaded. This browser slice is not the production AiRA application.

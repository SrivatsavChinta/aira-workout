# Runtime setup

Every browser session starts in Mock. Selecting a provider alone does not invoke it. A live request needs local enablement, provider selection, usage consent and Send or Retry. There is no automatic provider fallback.

## OpenAIAPI

Copy `.env.example` to `.env`. Set `ALLOW_LIVE_API=true`, add a permitted `OPENAI_API_KEY`, and set `OPENAI_MODEL` to a model available to your account. Restart the app, select OpenAIAPI and consent to usage before sending. Keys stay on the server. This adapter uses the Responses endpoint with a structured reply envelope.

## ClaudeCLI

This adapter requires an installed official `claude` executable and an existing Claude-plan login. The implementation requires Claude Code 2.1.211 or later within major version 2, and checks its required flags and login before each request. Unsupported installations are rejected.

In `.env`, set `ALLOW_CLAUDE_CLI=true`, `CLAUDE_CLI_PATH` to the absolute executable path, and `CLI_PROFILE_ACKNOWLEDGED=true` after reviewing the restrictions below. `CLAUDE_MODEL` may be blank to use the CLI default. Restart, select ClaudeCLI and consent before sending. The app does not install the CLI or perform login.

The runner disables action tools, user MCP configuration, slash commands, browser integration and session persistence. It checks reported tools and rejects unexpected tool activity. These restrictions are not an operating-system sandbox; managed host policy or hooks may still apply. Review the host before enabling this mode. Auth files and tokens are not extracted by the app.

## CodexCLI

The in-app response runtime is disabled because its required restriction profile has not been verified. Codex can still be used separately as a coding tool.

## Ollama

Optional local decision matching and narration for RunQuest only.

1. Install Ollama and pull the model yourself once (`ollama pull llama3.2:3b`). The app never downloads models.
2. Copy `.env.example` to `.env` (ignored by Git) and set `ALLOW_OLLAMA=true`. `OLLAMA_MODEL` (default `llama3.2:3b`), `OLLAMA_URL` (default `http://localhost:11434`, local http addresses only) and `OLLAMA_CLI_PATH` (absolute path; blank checks `/opt/homebrew/bin`, `/usr/local/bin` and the Ollama.app bundle) are optional.
3. Run `npm start`. It loads `.env` with Node's `--env-file-if-exists`; variables already set in your shell take precedence. Running `node dist/server/main.js` directly does not read `.env`.
4. Select Ollama. Loading the page or using Mock never contacts Ollama. On selection the server checks `OLLAMA_URL`, reuses a responding service, or on macOS starts `ollama serve` in the background (no shell, minimal environment, at most one instance) and waits up to 15 seconds. It then checks that the model is installed. The selector shows Starting Ollama…, Checking model…, Ollama ready, or Ollama unavailable / Model missing with what to do next. Send and **Start RunQuest** stay disabled, and the server refuses Ollama turns, until it is ready. Switching to Mock is immediate; switching back reuses the service.
5. Consent, then choose **Start RunQuest**. After that you can press the buttons or type your decision in your own words.

If the app started `ollama serve`, it stops with the app when you press Ctrl+C in that terminal. A service you started yourself (for example the Ollama menu-bar app) is left running.

The RunQuest state machine still builds every screen, choice, transition, ending and restart.

Button presses and exact button labels (and `/runquest`) go straight to the state machine. Any other message typed while a RunQuest screen is showing makes one separate classification request to `/api/generate`. It contains only the current screen's question, the labels and short descriptions of that screen's buttons, `UNCLEAR`, `UNRELATED` and your latest message (first 500 characters). It uses temperature 0, at most 16 output tokens and a 15-second timeout. The app accepts the reply only if, after trimming quotes, a trailing full stop, case and spacing, it is exactly one of those labels. An accepted button label becomes the same command the button sends and goes through the state machine, so typed choices cannot skip a step, reach another screen's choice or change an earlier decision. `UNCLEAR`, `UNRELATED`, any other text (including OpenUI), HTTP errors, timeouts, connection failures and malformed responses leave the current screen unchanged; the app replies from fixed templates built from the current screen's question, where you are in the story (including decisions already made) and its buttons, with no further model call. `UNCLEAR` asks which option you meant, `UNRELATED` steers back to the current question and explains each option, and failures ask you to choose again. A 3B local model can still misread a message, so check the screen and use the buttons if needed. Without a RunQuest screen, typed messages are not sent to Ollama.

After the state machine accepts a command, only the story paragraphs and the ending passage are sent, one at a time, to `/api/generate` with a fixed rewriting instruction and conservative settings. Choices, prompts, labels, calendar data, your messages and app state are never sent for rewriting. Each reply is treated as untrusted: it must be plain second-person prose of at most two sentences and 40 words, without code, markup, digits or obvious exercise, medical or instruction wording. Rejected replies, HTTP errors, timeouts (20 seconds per passage), connection failures and malformed responses keep the original passage, and the transcript says how many passages were rewritten. These checks are basic; they do not guarantee that a rewrite is faithful or safe. There is no fallback to another provider. The server log records each classification outcome but not your message.

## Verification status

The adapter tests use fake transports. No live OpenAI or subscription CLI model request has been verified for this release. Actual account access, model behavior and usage costs need a live check with permitted credentials. Cancelling locally may not prevent usage for a request already accepted by a provider.

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

Optional local narration for RunQuest only.

1. Install Ollama and pull the model yourself once (`ollama pull llama3.2:3b`). The app never downloads models.
2. Copy `.env.example` to `.env` (ignored by Git) and set `ALLOW_OLLAMA=true`. `OLLAMA_MODEL` (default `llama3.2:3b`), `OLLAMA_URL` (default `http://localhost:11434`, local http addresses only) and `OLLAMA_CLI_PATH` (absolute path; blank checks `/opt/homebrew/bin`, `/usr/local/bin` and the Ollama.app bundle) are optional.
3. Run `npm start`. It loads `.env` with Node's `--env-file-if-exists`; variables already set in your shell take precedence. Running `node dist/server/main.js` directly does not read `.env`.
4. Select Ollama. Loading the page or using Mock never contacts Ollama. On selection the server checks `OLLAMA_URL`, reuses a responding service, or on macOS starts `ollama serve` in the background (no shell, minimal environment, at most one instance) and waits up to 15 seconds. It then checks that the model is installed. The selector shows Starting Ollama…, Checking model…, Ollama ready, or Ollama unavailable / Model missing with what to do next. Send and **Start RunQuest** stay disabled, and the server refuses Ollama turns, until it is ready. Switching to Mock is immediate; switching back reuses the service.
5. Consent, then choose **Start RunQuest**.

If the app started `ollama serve`, it stops with the app when you press Ctrl+C in that terminal. A service you started yourself (for example the Ollama menu-bar app) is left running.

The RunQuest state machine still builds every screen, choice, transition, ending and restart. Only the story paragraphs and the ending passage are sent, one at a time, to `/api/generate` with a fixed rewriting instruction and conservative settings. Choices, prompts, labels, calendar data and app state are never sent. Each reply is treated as untrusted: it must be plain second-person prose of at most two sentences and 40 words, without code, markup, digits or obvious exercise, medical or instruction wording. Rejected replies, HTTP errors, timeouts (20 seconds per passage), connection failures and malformed responses keep the original passage, and the transcript says how many passages were rewritten. These checks are basic; they do not guarantee that a rewrite is faithful or safe. Other messages are not sent to Ollama, and there is no fallback to another provider.

## Verification status

The adapter tests use fake transports. No live OpenAI or subscription CLI model request has been verified for this release. Actual account access, model behavior and usage costs need a live check with permitted credentials. Cancelling locally may not prevent usage for a request already accepted by a provider.

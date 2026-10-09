# RunQuest submission summary

## What it is

RunQuest is a five-screen fictional story about fitting running into a busy week. You make two
decisions (Plan Ahead or Stay Flexible, then Reconsider the Approach or Leave It for Another Time),
which lead to one of four fixed endings, and you can restart with **Try Another Journey**. It is
simulated and non-prescriptive: no exercise plans, medical advice or physical-exertion instructions.
The design brief (audience, scenario, voice, safety) is [`skills/workout.md`](../skills/workout.md).

## How it works

- **Trusted state machine.** `src/server/runquest.ts` owns every screen, choice, transition and
  ending, and emits validated OpenUI data. The browser renders it through the existing registry,
  prop validation and renderers. Mock and Ollama produce identical screens, choices and endings.
- **Own-words choices (Ollama only).** A message that is not an exact button label makes one
  closed-label classification request. The model may only answer with a label offered on the
  current screen, `UNCLEAR` or `UNRELATED`. An accepted label becomes the same command the button
  sends; anything else leaves the screen unchanged and the app replies from fixed templates that
  name the real buttons. The model cannot navigate, skip steps or invent options.
- **Narration (Ollama only).** After a transition, story passages are reworded one at a time
  within a shared 20-second budget. Each reply is validated (second person, short, no markup,
  digits or exercise/medical wording); anything rejected, failed or out of time keeps the
  canonical text, and the screen always advances.
- **Local runtime management.** Ollama is checked or started only when selected, the model is
  never downloaded, and actions stay disabled until it is ready. Details: [RUNTIMES.md](RUNTIMES.md).

## Runtime modes tested

| Mode | How it was tested |
| --- | --- |
| Mock | Automated: unit tests (`npm run check`) and Playwright browser tests with installed Chrome (`npm run test:ui`), including the full button journey. |
| Ollama, fake/stub transport | Automated: unit tests with a fake `fetch` (classification, narration, validation, timeouts, HTTP/connection failures, sequential budget) and browser tests with stubbed `/api/runtime/ollama` and `/api/turn` routes. |
| Ollama, live local (`llama3.2:3b`) | Manual only. Server logs from the author's sessions show live classifications (action, unclear, unrelated, rejected) and narration rewrites. Those sessions ran before narration became sequential; the sequential budget has only been tested with the fake transport. No automated live test exists. |
| OpenAI, Claude | Not tested with RunQuest; no live requests were made. |
| Codex CLI | Blocked in this build. |

## Limitations

- How reliably `llama3.2:3b` picks the right label or produces acceptable rewrites has not been
  measured; the validation checks are basic word and pattern filters.
- A cold model can make the first Ollama turn slow (worst case about 35 seconds).
- Narration reliability depends on the local machine; passages that do not fit the budget keep the
  original text.

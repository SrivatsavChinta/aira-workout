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
| Mock, automated | Unit tests (`npm run check`, 95 passing) and Playwright browser tests with installed Chrome (`npm run test:ui`, 19 passing), including the full button journey and recovery with Retry after a simulated invalid-schema or failed request on a RunQuest choice. |
| Mock, manual | One complete button journey (Plan Ahead, then Reconsider the Approach), exported as [`runs/mock-after.json`](../runs/mock-after.json). The author also tried a local Builder-tools patch and the simulated schema and request faults by hand. |
| Ollama, fake/stub transport | Automated: unit tests with a fake `fetch` (classification, narration, validation, timeouts, HTTP/connection failures, the sequential shared budget) and browser tests with stubbed `/api/runtime/ollama` and `/api/turn` routes. |
| Ollama, live local (`llama3.2:3b`) | Manual only. One complete journey on the current build, exported as [`runs/ollama-live.json`](../runs/ollama-live.json). The two decisions were typed in the author's own words, were classified as Plan Ahead and Reconsider the Approach, and reached the matching ending. The server log reported all 9 narrated passages rewritten, with no timeouts or skipped passages. Earlier manual sessions, before narration became sequential, also produced unclear, unrelated and rejected classifications; those outcomes were not repeated on the current build. Timeouts and skipped passages are covered only by the fake-transport tests. No automated live test exists. |
| OpenAI, Claude | Not tested with RunQuest; no live requests were made. |
| Codex CLI | Blocked in this build. |

Both run files use the export's fixed "after" label; it does not refer to a before/after comparison.

## Limitations

- How reliably `llama3.2:3b` picks the right label or produces acceptable rewrites has not been
  measured; the validation checks are basic word and pattern filters. In the live run some accepted
  rewrites shifted the wording's nuance slightly while keeping the facts.
- A cold model can make the first Ollama turn slow (worst case about 35 seconds).
- Narration reliability depends on the local machine; passages that do not fit the budget keep the
  original text.

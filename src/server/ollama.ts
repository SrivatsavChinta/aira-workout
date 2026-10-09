import type { RequestData, Turn } from '../shared/contracts.js';
import { ScreenDocument } from '../shared/openui/document.js';
import { currentActions, runQuestTurn, type Narrate, type RunQuestAction, type RunQuestChoice } from './runquest.js';

// Ollama maps a typed message to one button on the current RunQuest screen and rewrites canonical
// passages. The RunQuest state machine still builds every screen, choice, transition and ending;
// rejected or failed classifications change nothing, and rejected or failed rewrites keep the canonical text.
export type OllamaConfig = { enabled: boolean; url: string; model: string; timeoutMs: number; binary: string; startTimeoutMs: number };
export const OLLAMA_OPTIONS = { temperature: 0.2, top_p: 0.8, num_predict: 90 };
export const NARRATION_LIMITS = { words: 40, sentences: 2, characters: 300 };
export const NARRATION_SYSTEM = [
  'You lightly rewrite one passage from a fictional interactive story.',
  'The reader is the main character and is addressed as "you". Story context: you started running two weeks ago and are trying to fit it into a busy week of work and everyday responsibilities.',
  'Rules:',
  '- Rewrite only the passage given. Keep its meaning, facts, day of the week and tense.',
  '- Stay close to the original: change the phrasing, not the content. Do not add feelings, details or events that the passage does not mention.',
  '- Use concise, natural second-person language ("you", "your").',
  `- Use at most ${NARRATION_LIMITS.sentences} sentences and ${NARRATION_LIMITS.words} words.`,
  '- Do not add events, decisions, outcomes, numbers, distances, times, exercise details, health or medical content, advice or instructions.',
  '- Output only the rewritten passage as plain text, with no quotes, labels, lists, markdown or code.',
].join('\n');

export type NarrationOutcome = 'rewritten' | 'rejected' | 'malformed' | 'http' | 'timeout' | 'unavailable';
const PROHIBITED = /\b(doctors?|medical|medicine|injur\w*|pain\w*|heart|pulse|calori\w*|diet\w*|weight|stretch\w*|warm[- ]?up|cool[- ]?down|pace|intervals?|sprint\w*|tempo|kilomet\w*|km|miles?|minutes?|hours?|reps?|training plan|workout plan|you should|you must|make sure|be sure to|aim for|push yourself|hydrat\w*)\b/i;
const MALFORMED = /[`<>{}[\]=#*_|\\\d]|openui|\b[A-Z]\w*\(|^(here|sure|rewritten|passage|output)\b/i;
const FIRST_PERSON = /\b(I|I'm|I've|I'll|me|my|mine|myself)\b/;
const SECOND_PERSON = /\byou(r|rs|rself|'re|'ve|'ll|'d)?\b/i;

/** Returns the cleaned passage, or null if it fails these basic checks. Passing does not guarantee semantic safety. */
export function validateNarration(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^["“'](.*)["”']$/s, '$1').trim().replace(/[’]/g, "'");
  if (!text || /\n/.test(text) || text.length > NARRATION_LIMITS.characters) return null;
  if (text.split(/\s+/).length > NARRATION_LIMITS.words) return null;
  if (!/[.!?]$/.test(text) || text.split(/[.!?]+(?:\s|$)/).filter(Boolean).length > NARRATION_LIMITS.sentences) return null;
  if (MALFORMED.test(text) || PROHIBITED.test(text) || FIRST_PERSON.test(text) || !SECOND_PERSON.test(text)) return null;
  return text;
}

export async function rewritePassage(passage: string, config: OllamaConfig, signal: AbortSignal, transport: typeof fetch = fetch): Promise<{ text: string; outcome: NarrationOutcome; model: string | null }> {
  const keep = (outcome: NarrationOutcome) => ({ text: passage, outcome, model: null });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), config.timeoutMs);
  const stopped = () => timeout.signal.aborted || signal.aborted;
  try {
    let response: Response;
    try {
      response = await transport(`${config.url}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([signal, timeout.signal]),
        body: JSON.stringify({ model: config.model, system: NARRATION_SYSTEM, prompt: `Passage:\n${passage}`, stream: false, options: OLLAMA_OPTIONS }),
      });
    } catch { return keep(stopped() ? 'timeout' : 'unavailable'); }
    if (!response.ok) return keep('http');
    let data: { model?: unknown; response?: unknown; done?: unknown; done_reason?: unknown };
    try { data = await response.json() as typeof data; } catch { return keep(stopped() ? 'timeout' : 'malformed'); }
    if (!data || typeof data !== 'object' || typeof data.response !== 'string' || data.done !== true) return keep('malformed');
    if (data.done_reason === 'length') return keep('rejected');
    const text = validateNarration(data.response);
    return text ? { text, outcome: 'rewritten', model: typeof data.model === 'string' ? data.model : null } : keep('rejected');
  } finally { clearTimeout(timer); }
}

/** Developer-facing narration summary for server logs; never part of the user-facing reply. */
export function narrationSummary(outcomes: NarrationOutcome[], config: OllamaConfig): string {
  const count = (outcome: NarrationOutcome) => outcomes.filter(o => o === outcome).length;
  const kept = outcomes.length - count('rewritten');
  const reasons = (['rejected', 'malformed', 'http', 'timeout', 'unavailable'] as const).filter(o => count(o)).map(o => `${o} ${count(o)}`).join(', ');
  return `[ollama] ${config.model} at ${config.url}: ${count('rewritten')}/${outcomes.length} passages rewritten${kept ? `; ${kept} kept canonical text (${reasons})` : ''}`;
}

export const UNCLEAR = 'UNCLEAR';
export const UNRELATED = 'UNRELATED';
type Classification = RunQuestAction | typeof UNCLEAR | typeof UNRELATED;
export type ClassificationOutcome = 'action' | 'unclear' | 'unrelated' | 'rejected' | 'malformed' | 'http' | 'timeout' | 'unavailable';
// No num_ctx here: a context size different from the narration calls would make Ollama reload the model.
export const CLASSIFY_OPTIONS = { temperature: 0, seed: 0, num_predict: 16 };
export const CLASSIFY_TIMEOUT_MS = 15_000;
export const CLASSIFY_MESSAGE_LIMIT = 500;
export const CLASSIFY_SYSTEM = [
  'You read one message from the reader of a fictional interactive story and match it to one of the listed options.',
  'Reply with exactly one label from the list, copied exactly, and nothing else.',
  `Reply ${UNCLEAR} if the message could fit more than one option or its meaning is uncertain.`,
  `Reply ${UNRELATED} if the message does not answer the question.`,
].join('\n');

export function classificationPrompt(message: string, choice: RunQuestChoice): string {
  return [`Question: ${choice.question}`, 'Options:', ...choice.actions.map(a => `- ${a.label}: ${a.description}`), `- ${UNCLEAR}`, `- ${UNRELATED}`,
    `Message: ${message.slice(0, CLASSIFY_MESSAGE_LIMIT).replace(/\s+/g, ' ')}`, 'Label:'].join('\n');
}

/** The current-screen action, UNCLEAR or UNRELATED named by the reply, or null for anything else. */
export function validateClassification(value: unknown, choice: RunQuestChoice): Classification | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().replace(/^["“'](.*)["”']$/s, '$1').trim().replace(/\.$/, '');
  if (!text || /\n/.test(text)) return null;
  const key = text.replace(/\s+/g, ' ').toLowerCase();
  if (key === UNCLEAR.toLowerCase()) return UNCLEAR;
  if (key === UNRELATED.toLowerCase()) return UNRELATED;
  return choice.actions.find(a => a.label.toLowerCase() === key) ?? null;
}

export async function classifyChoice(message: string, choice: RunQuestChoice, config: OllamaConfig, signal: AbortSignal, transport: typeof fetch = fetch): Promise<{ result: Classification | null; outcome: ClassificationOutcome; model: string | null }> {
  const fail = (outcome: ClassificationOutcome) => ({ result: null, outcome, model: null });
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), Math.min(config.timeoutMs, CLASSIFY_TIMEOUT_MS));
  const stopped = () => timeout.signal.aborted || signal.aborted;
  try {
    let response: Response;
    try {
      response = await transport(`${config.url}/api/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.any([signal, timeout.signal]),
        body: JSON.stringify({ model: config.model, system: CLASSIFY_SYSTEM, prompt: classificationPrompt(message, choice), stream: false, options: CLASSIFY_OPTIONS }),
      });
    } catch { return fail(stopped() ? 'timeout' : 'unavailable'); }
    if (!response.ok) return fail('http');
    let data: { model?: unknown; response?: unknown; done?: unknown; done_reason?: unknown };
    try { data = await response.json() as typeof data; } catch { return fail(stopped() ? 'timeout' : 'malformed'); }
    if (!data || typeof data !== 'object' || typeof data.response !== 'string' || data.done !== true) return fail('malformed');
    if (data.done_reason === 'length') return fail('rejected');
    const result = validateClassification(data.response, choice);
    if (!result) return fail('rejected');
    return { result, outcome: result === UNCLEAR ? 'unclear' : result === UNRELATED ? 'unrelated' : 'action', model: typeof data.model === 'string' ? data.model : null };
  } finally { clearTimeout(timer); }
}

/** App-written reply for a message that did not select a current action; it has no OpenUI fence, so the screen stays as it is. */
export function unchangedReply(choice: RunQuestChoice, outcome: ClassificationOutcome): string {
  const labels = choice.actions.map(a => `“${a.label}”`);
  const options = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} or ${labels.at(-1)}` : labels[0];
  const explained = choice.actions.map(a => `“${a.label}”: ${a.description}`).join(' ');
  const decision = choice.actions.length > 1;
  const single = `If so, choose ${options}, or say so in your own words.`;
  if (outcome === 'unclear') return decision
    ? `I couldn't tell which option you meant, so nothing has changed yet. ${choice.question} You can choose ${options}. Which one is closer to what you'd like?`
    : `I wasn't sure what you'd like to do, so the story is staying where it is. ${choice.context} ${choice.question} ${single}`;
  if (outcome === 'unrelated') return `That doesn't seem to be about this part of the story, so let's come back to it. ${choice.context} ${choice.question} `
    + (decision ? `${explained} Type the one you prefer, or use the buttons.` : single);
  return `I couldn't interpret that message, so the screen was not changed. ${choice.question} Choose ${options} with the buttons, or say which one you want in your own words.`;
}

export async function ollamaTurn(request: RequestData, config: OllamaConfig, signal: AbortSignal, transport: typeof fetch = fetch, log: (line: string) => void = line => console.info(line)): Promise<{ turn: Turn; returnedModel: string | null }> {
  const message = request.messages.at(-1)?.content.trim() ?? '';
  let command = message.toLowerCase();
  const doc = new ScreenDocument();
  if (request.state.ui_state) doc.apply('```openui\n' + request.state.ui_state + '\n```');
  const passages = new Set<string>();
  const collect: Narrate = passage => { passages.add(passage); return passage; };
  let draft = runQuestTurn(command, doc, collect);
  let classifiedBy: string | null = null;
  if (!draft) {
    const choice = currentActions(doc);
    if (!choice) return { turn: { reply: 'Ollama mode only narrates RunQuest. Choose Start RunQuest or type /runquest.' }, returnedModel: null };
    const classified = await classifyChoice(message, choice, config, signal, transport);
    log(`[ollama] ${config.model} at ${config.url}: classification ${classified.outcome}`);
    const selected = classified.result;
    if (typeof selected !== 'object' || selected === null) return { turn: { reply: unchangedReply(choice, classified.outcome) }, returnedModel: classified.model };
    command = selected.command; classifiedBy = classified.model;
    draft = runQuestTurn(command, doc, collect);
    if (!draft) return { turn: { reply: unchangedReply(choice, 'rejected') }, returnedModel: classifiedBy };
  }
  if (!passages.size) return { turn: draft, returnedModel: classifiedBy };
  const results = await Promise.all([...passages].map(passage => rewritePassage(passage, config, signal, transport)));
  const rewrites = new Map([...passages].map((passage, i) => [passage, results[i].text]));
  const turn = runQuestTurn(command, doc, passage => rewrites.get(passage) ?? passage)!;
  log(narrationSummary(results.map(r => r.outcome), config));
  return { turn, returnedModel: results.find(r => r.model)?.model ?? classifiedBy };
}

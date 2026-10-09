import type { RequestData, Turn } from '../shared/contracts.js';
import { ScreenDocument } from '../shared/openui/document.js';
import { runQuestTurn } from './runquest.js';

// Ollama only rewrites canonical RunQuest passages. The RunQuest state machine still builds
// every screen, choice, transition and ending; rejected or failed rewrites keep the canonical text.
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

export async function ollamaTurn(request: RequestData, config: OllamaConfig, signal: AbortSignal, transport: typeof fetch = fetch, log: (line: string) => void = line => console.info(line)): Promise<{ turn: Turn; returnedModel: string | null }> {
  const command = request.messages.at(-1)?.content.trim().toLowerCase() ?? '';
  const doc = new ScreenDocument();
  if (request.state.ui_state) doc.apply('```openui\n' + request.state.ui_state + '\n```');
  const passages = new Set<string>();
  const draft = runQuestTurn(command, doc, passage => { passages.add(passage); return passage; });
  if (!draft) return { turn: { reply: 'Ollama mode only narrates RunQuest. Choose Start RunQuest or type /runquest.' }, returnedModel: null };
  if (!passages.size) return { turn: draft, returnedModel: null };
  const results = await Promise.all([...passages].map(passage => rewritePassage(passage, config, signal, transport)));
  const rewrites = new Map([...passages].map((passage, i) => [passage, results[i].text]));
  const turn = runQuestTurn(command, doc, passage => rewrites.get(passage) ?? passage)!;
  log(narrationSummary(results.map(r => r.outcome), config));
  return { turn, returnedModel: results.find(r => r.model)?.model ?? null };
}

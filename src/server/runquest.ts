import { serializeStatement } from '../shared/openui/serialize.js';
import type { ScreenDocument } from '../shared/openui/document.js';
import type { StatementNode } from '../shared/openui/openui-model.js';
import type { Turn } from '../shared/contracts.js';

// RunQuest: a fictional, deterministic story for Mock. Story state lives in ui_state:
// the stage is which rq_s* screens exist, and the first decision is the rq_c1 Keyword on screen 3.
export const RUNQUEST_HISTORY = [
  { day: 'Mon', km: 2 }, { day: 'Tue', km: 0 }, { day: 'Wed', km: 0 }, { day: 'Thu', km: 3 },
  { day: 'Fri', km: 0 }, { day: 'Sat', km: 2.5 }, { day: 'Sun', km: 0 },
] as const;
export const FIRST_CHOICES = ['Plan Ahead', 'Stay Flexible'] as const;
export const SECOND_CHOICES = ['Reconsider the Approach', 'Leave It for Another Time'] as const;
type First = typeof FIRST_CHOICES[number];
type Second = typeof SECOND_CHOICES[number];
export const RUNQUEST_ENDINGS: Record<First, Record<Second, string>> = {
  'Plan Ahead': {
    'Reconsider the Approach': 'Your plans changed when an unexpected commitment appeared. You explored how reconsidering your approach can help you think about consistency when circumstances change.',
    'Leave It for Another Time': "You made an initial plan, but unexpected commitments disrupted it. The challenge remains unresolved, and you can revisit your approach when you're ready.",
  },
  'Stay Flexible': {
    'Reconsider the Approach': 'Your flexible approach left the week open to changing priorities. You explored how reconsidering your approach can help you think about making room for running amid everyday responsibilities.',
    'Leave It for Another Time': 'The week became busy before you found an opportunity to think about running. You recognized that the challenge of consistency remains unresolved.',
  },
};
export const RUNQUEST_COMMANDS = ['/runquest', 'start runquest'];
const SCREENS = ['rq_s1', 'rq_s2', 'rq_s3', 'rq_s4', 'rq_s5'];
const RESTART = 'Try Another Journey';

type Part = { name: string; lines: string[] };
const part = (name: string, component: string, ...args: unknown[]): Part => ({ name, lines: [serializeStatement(name, component, args)] });
const paragraphs = (prefix: string, texts: string[]): Part[] => texts.map((text, i) => part(`${prefix}_p${i + 1}`, 'Text', text));
const km = (value: number) => `${value.toFixed(1)} km`;
const NO_RUN = '—';
const match = <T extends string>(options: readonly T[], input: string) => options.find(option => option.toLowerCase() === input);
const fence = (code: string) => '```openui\n' + code + '\n```';

function calendar(): Part {
  const items = RUNQUEST_HISTORY.map((entry, i) => serializeStatement(`rq_day${i + 1}`, 'ListItem', [`${entry.day}\n${entry.km > 0 ? km(entry.km) : NO_RUN}`, entry.km > 0 ? 'plus' : 'minus']));
  return { name: 'rq_week', lines: [`rq_week = List([${RUNQUEST_HISTORY.map((_, i) => `rq_day${i + 1}`).join(', ')}])`, ...items] };
}
function choiceParts(prefix: string, choices: readonly string[], descriptions: string[]): Part[] {
  return choices.flatMap((choice, i) => [part(`${prefix}_opt${i + 1}`, 'Text', choice, 'subtitle'), part(`${prefix}_opt${i + 1}_text`, 'Text', descriptions[i])]);
}
function screen(index: number, title: string, parts: Part[]): string[] {
  const id = SCREENS[index - 1];
  const all = [part(`${id}_step`, 'Text', `RunQuest · Step ${index} of 5`, 'body', '#666666'), part(`${id}_title`, 'Text', title, 'title'), ...parts];
  return [`${id} = Screen([${all.map(p => p.name).join(', ')}])`, ...all.flatMap(p => p.lines)];
}
function step(index: number, title: string, parts: Part[]): Turn {
  const root = `root = Screens([${SCREENS.slice(0, index).join(', ')}], ${SCREENS[index - 1]})`;
  return { reply: `RunQuest · Step ${index} of 5: ${title}.\n` + fence([root, ...screen(index, title, parts)].join('\n')) };
}

function introduction(): Turn {
  const runDays = RUNQUEST_HISTORY.filter(entry => entry.km > 0).length;
  const total = RUNQUEST_HISTORY.reduce((sum, entry) => sum + entry.km, 0);
  const turn = step(1, 'Your Running Journey', [
    ...paragraphs('rq_s1', [
      'Two weeks ago, you decided to start running.',
      'Initially, you felt motivated. But lately, work and everyday responsibilities have made it difficult to stay consistent.',
      "It's Monday, and you're about to start another week. You want to keep running, but you're still figuring out how to make it part of your routine.",
      "Let's see how your decisions shape the week ahead.",
    ]),
    part('rq_s1_history', 'Text', 'Your Running History', 'subtitle'),
    part('rq_s1_period', 'Text', 'Your previous seven days', 'body', '#666666'),
    calendar(),
    part('rq_s1_totals', 'Text', `Running days: ${runDays} · Total distance: ${km(total)}`),
    part('rq_s1_note', 'Alert', 'info', 'Example running history for this interactive journey. These numbers are not targets or recommendations.'),
    part('rq_s1_actions', 'FollowUps', ['Start your journey']),
  ]);
  return { reply: fence('root = Screens([])') + '\n' + turn.reply };
}
const newWeek = () => step(2, 'A New Week', [
  ...paragraphs('rq_s2', ["You look at your calendar. It's going to be a busy week, and you're not sure how running will fit into it.", 'How do you want to approach the week?']),
  ...choiceParts('rq_s2', FIRST_CHOICES, ['You look at your existing commitments and consider when running might fit into your schedule.', 'You decide to see how the week unfolds and figure things out as you go.']),
  part('rq_s2_actions', 'FollowUps', [...FIRST_CHOICES]),
]);
export const RUNQUEST_CONSEQUENCES: Record<First, { title: string; story: string[] }> = {
  'Plan Ahead': { title: 'An Unexpected Change', story: ["It's Wednesday. An unexpected work commitment disrupts your plans for the week.", 'You had considered when running might fit into your schedule, but now things have changed.'] },
  'Stay Flexible': { title: 'Where Did the Week Go?', story: ["It's Wednesday. Work has been busier than expected, and you haven't found an opportunity to think about running.", 'You wanted to make it part of your routine, but other priorities have taken over.'] },
};
function consequence(first: First): Turn {
  const { title, story } = RUNQUEST_CONSEQUENCES[first];
  return step(3, title, [...paragraphs('rq_s3', story), part('rq_c1', 'Keyword', first, 'Your first decision'), part('rq_s3_actions', 'FollowUps', ['Continue'])]);
}
const reflect = () => step(4, 'A Moment to Reflect', [
  ...paragraphs('rq_s4', ["It's Wednesday evening. Your week hasn't gone as expected.", "You still want to make running part of your life, but your current approach hasn't worked out as you imagined.", 'What would you like to do?']),
  ...choiceParts('rq_s4', SECOND_CHOICES, ['Take another look at your commitments and reflect on how running could fit into your everyday life.', "Accept that this week hasn't worked out as expected and revisit the idea later."]),
  part('rq_s4_actions', 'FollowUps', [...SECOND_CHOICES]),
]);
function conclusion(first: First, second: Second): Turn {
  return step(5, 'Your Reflection', [
    part('rq_s5_p1', 'Text', RUNQUEST_ENDINGS[first][second], 'description'),
    { name: 'rq_s5_choices', lines: ['rq_s5_choices = List([rq_s5_first, rq_c2])', serializeStatement('rq_s5_first', 'ListItem', [`First decision: ${first}`]), serializeStatement('rq_c2', 'ListItem', [`Second decision: ${second}`])] },
    part('rq_s5_note', 'Alert', 'info', "RunQuest is a fictional journey about habits and everyday decisions. It isn't advice, a running plan or a recommendation."),
    part('rq_s5_actions', 'FollowUps', [RESTART]),
  ]);
}
const outOfOrder = (): Turn => ({ reply: `RunQuest needs each decision in order before it can continue, so the screen was not changed. Use the buttons on the latest RunQuest screen, or choose ${RESTART} to start again.` });

const hasScreen = (doc: ScreenDocument, key: string) => doc.screens.some(s => s.key === key);
function recordedFirst(doc: ScreenDocument): First | undefined {
  const node = (doc.screens.find(s => s.key === 'rq_s3')?.props.children as StatementNode[] | undefined)?.find(n => n.key === 'rq_c1');
  return node?.name === 'Keyword' && typeof node.props.text === 'string' ? match(FIRST_CHOICES, node.props.text.toLowerCase()) : undefined;
}

/** A RunQuest reply for a lowercased command, or null when the command is not RunQuest's. */
export function runQuestTurn(command: string, doc: ScreenDocument): Turn | null {
  if (RUNQUEST_COMMANDS.includes(command) || command === RESTART.toLowerCase()) return introduction();
  const first = match(FIRST_CHOICES, command), second = match(SECOND_CHOICES, command);
  if (command !== 'start your journey' && command !== 'continue' && !first && !second) return null;
  if (!hasScreen(doc, 'rq_s1')) return null;
  if (command === 'start your journey') return newWeek();
  if (first) return hasScreen(doc, 'rq_s2') ? consequence(first) : outOfOrder();
  const recorded = recordedFirst(doc);
  if (command === 'continue') return recorded && hasScreen(doc, 'rq_s3') ? reflect() : outOfOrder();
  return recorded && second && hasScreen(doc, 'rq_s4') ? conclusion(recorded, second) : outOfOrder();
}

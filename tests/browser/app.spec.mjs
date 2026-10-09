import { test,expect } from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const shots='evidence/screenshots';
async function send(page,text){await page.locator('#message').fill(text);await page.locator('#send').click();await expect(page.locator('#pending')).toBeHidden();}
async function demo(page){await page.locator('#sample').click();await expect(page.locator('[data-statement="count1"]')).toContainText('8');}
test.beforeEach(async({page})=>{await page.goto('/');await expect(page.locator('#mode')).toHaveText('MOCK · NO MODEL CALLS');});
test('source stepper, text cues, value patch and local timer continuity',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));await mkdir(shots,{recursive:true});await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:shots+'/01-start.png',fullPage:true});await demo(page);
 await expect(page.locator('#spoken')).toContainText('current screen');await send(page,'next');await expect(page.locator('#position')).toHaveText('2 / 4');await page.getByRole('button',{name:'Start simulation',exact:true}).click();
 await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('3 / 4');await page.locator('#back').click();await expect(page.locator('.timer-status')).toHaveText('running');
 await page.locator('#pause').click();await expect(page.locator('.timer-status')).toHaveText('paused');await expect(page.locator('#next')).toBeDisabled();await page.locator('#pause').click();await expect(page.locator('.timer-status')).toHaveText('running');
 await page.getByRole('button',{name:'Simulate finish',exact:true}).click();await expect(page.locator('.timer-status')).toHaveText('done');await expect(page.locator('#position')).toHaveText('2 / 4');
 await send(page,'change value to 6');await expect(page.locator('#position')).toHaveText('2 / 4');await send(page,'next');await expect(page.locator('[data-statement="count2"]')).toContainText('6');await page.screenshot({path:shots+'/02-workout-state.png',fullPage:true});expect(errors).toEqual([]);
});
test('repeated sends, interruption, reset while pending and post-reset navigation',async({page})=>{
 await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#fault').selectOption('slow');await page.locator('#message').fill('/demo');await page.locator('#send').click();await page.locator('#message').fill('/demo');await page.locator('#send').click();await expect(page.locator('.message.user')).toHaveCount(1);await page.locator('#reset').click();await page.waitForTimeout(2500);await expect(page.locator('#screen')).toContainText('Your workout starts here');await demo(page);await page.locator('#next').click();await page.locator('#reset').click();await demo(page);await page.locator('#next').click();await expect(page.locator('#position')).toHaveText('2 / 4');
 await page.locator('#fault').selectOption('slow');await page.locator('#message').fill('next');await page.locator('#send').click();await send(page,'back');await expect(page.locator('#position')).toHaveText('1 / 4');
});
for(const fault of ['schema','request'])test(`${fault} failure preserves screen and retry recovers`,async({page})=>{await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#fault').selectOption(fault);await send(page,'next');await expect(page.locator('#error')).toBeVisible();await expect(page.locator('[data-statement="count1"]')).toContainText('8');await page.locator('#retry').click();await expect(page.locator('#position')).toHaveText('2 / 4');await expect(page.locator('#error')).toBeHidden();});
test('local valid/invalid patches are data and candidate component can be registered',async({page})=>{
 await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#patch').fill('count1 = Keyword("<img src=x onerror=alert(1)>", "inert")');await page.locator('#apply-patch').click();await expect(page.locator('[data-statement="count1"]')).toContainText('<img src=x');await expect(page.locator('#screen img')).toHaveCount(0);
 await page.locator('#patch').fill('count1 = Function("evil")');await page.locator('#apply-patch').click();await expect(page.locator('#patch-status')).toContainText('Invalid patch');
 // Trusted test code registers a candidate component in all three local seams.
 await page.evaluate(async()=>{const {OPENUI_LIBRARY}=await import('/shared/openui/openui-library.js');const {propValidators}=await import('/shared/openui/validate.js');const {renderers}=await import('/web/components.js');OPENUI_LIBRARY.StatusPill={args:['label','value'],required:2};propValidators.StatusPill=p=>typeof p.label==='string'&&typeof p.value==='string';renderers.StatusPill=({props:p})=>{const n=document.createElement('div');n.textContent=p.label+': '+p.value;return n;};});
 await page.locator('#patch').fill('page1 = Screen([heading1, custom1])\ncustom1 = StatusPill("Sample", "A")');await page.locator('#apply-patch').click();await expect(page.locator('[data-statement="custom1"]')).toHaveText('Sample: A');
});
test('manual export contains screen/events/versions and no token; mobile fits',async({page})=>{
 await page.setViewportSize({width:390,height:844});await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#note').fill('Tested mock only. TOKEN=do-not-export');const download=page.waitForEvent('download');await page.locator('#export').click();const d=await download;const stream=await d.createReadStream();let content='';for await(const chunk of stream)content+=chunk;const json=JSON.parse(content);expect(json.state.ui_state).toContain('root = Screens');expect(json.events.find(e=>e.result).result.versions.protocolHash).toHaveLength(64);expect(content).not.toContain('do-not-export');expect(content).not.toContain('X-Local-Token');await page.locator('.builder').evaluate(e=>e.open=false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:shots+'/03-mobile.png',fullPage:true});
});
test('RunQuest: calendar, both decisions, ending and restart through Mock buttons',async({page})=>{
 const errors=[];page.on('pageerror',e=>errors.push(e.message));const click=async name=>{await page.locator('#screen').getByRole('button',{name,exact:true}).click();await expect(page.locator('#pending')).toBeHidden();};
 await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');
 await expect(page.locator('[data-statement="rq_s1_p1"]')).toHaveText('Two weeks ago, you decided to start running.');await expect(page.locator('[data-statement="rq_s1_history"]')).toHaveText('Your Running History');await expect(page.locator('[data-statement="rq_s1_period"]')).toHaveText('Your previous seven days');await expect(page.locator('[data-statement="rq_s1_note"]')).toContainText('Example running history for this interactive journey.');await expect(page.locator('#screen')).not.toContainText('Alex');
 const days=page.locator('[data-statement="rq_week"] li');await expect(days).toHaveCount(7);await expect(page.locator('[data-statement="rq_week"] li.marker-plus')).toHaveCount(3);await expect(page.locator('[data-statement="rq_week"] li.marker-minus')).toHaveText(['Tue\n—','Wed\n—','Fri\n—','Sun\n—'],{useInnerText:true});await expect(page.locator('[data-statement="rq_week"] li.marker-plus')).toHaveText(['Mon\n2.0 km','Thu\n3.0 km','Sat\n2.5 km'],{useInnerText:true});
 await expect(page.locator('[data-statement="rq_s1_totals"]')).toHaveText('Running days: 3 · Total distance: 7.5 km');expect(await page.locator('[data-statement="rq_week"]').evaluate(e=>getComputedStyle(e).display)).toBe('grid');
 await click('Start your journey');await expect(page.locator('#screen h3')).toHaveText('A New Week');await expect(page.locator('#navigation')).toBeHidden();await expect(page.locator('#progress span')).toHaveCount(0);
 await click('Stay Flexible');await expect(page.locator('#screen h3')).toHaveText('Where Did the Week Go?');
 await click('Continue');await expect(page.locator('#screen h3')).toHaveText('A Moment to Reflect');
 await click('Leave It for Another Time');await expect(page.locator('#screen h3')).toHaveText('Your Reflection');await expect(page.locator('#navigation')).toBeHidden();await expect(page.locator('[data-statement="rq_s5_p1"]')).toContainText('The week became busy before you found an opportunity');await expect(page.locator('[data-statement="rq_s5_choices"]')).toContainText('First decision: Stay Flexible');
 await click('Try Another Journey');await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');await expect(page.locator('#navigation')).toBeHidden();expect(await page.locator('#state-json').textContent()).not.toContain('rq_c1');expect(errors).toEqual([]);
});
test('non-RunQuest lists with plus/minus markers keep default rendering and fixture stepper',async({page})=>{
 await demo(page);await page.locator('.builder').evaluate(e=>e.open=true);await page.locator('#patch').fill('page1 = Screen([heading1, count1, note1, cue1, pros1])\npros1 = List([pro1, con1])\npro1 = ListItem("Upside", "plus")\ncon1 = ListItem("Downside", "minus")');await page.locator('#apply-patch').click();
 const list=page.locator('[data-statement="pros1"]');await expect(list.locator('li')).toHaveCount(2);expect(await list.evaluate(e=>getComputedStyle(e).display)).toBe('block');expect(await list.locator('li').first().evaluate(e=>getComputedStyle(e).display)).toBe('list-item');
 await expect(page.locator('#navigation')).toBeVisible();await expect(page.locator('#progress span')).toHaveCount(4);await expect(page.locator('#position')).toHaveText('1 / 4');
});
test('runtime starts mock; Codex blocked; selecting never calls model endpoint',async({page})=>{let turns=0;page.on('request',r=>{if(r.url().includes('/api/turn'))turns++;});await page.locator('#provider').selectOption('codex-cli');await expect(page.locator('#send')).toBeDisabled();await expect(page.locator('#provider-description')).toContainText('no-command/no-private-read');expect(turns).toBe(0);});
test('configured CLI needs explicit consent and records fake provider identity',async({page})=>{
 await page.route('**/api/config',async route=>{const response=await route.fetch();const cfg=await response.json();cfg.providers.find(p=>p.id==='claude-cli').enabled=true;await route.fulfill({json:cfg});});await page.reload();await page.locator('#provider').selectOption('claude-cli');await expect(page.locator('#send')).toBeDisabled();await page.locator('#consent').check();await page.route('**/api/turn',route=>route.fulfill({json:{turn:{reply:'Transport fixture, not a live CLI request.'},versions:{provider:'claude-cli',mode:'live',model:'fixture-only'}}}));await send(page,'hello');await expect(page.locator('#spoken')).toContainText('Transport fixture');
});
async function enableOllama(page){await page.route('**/api/config',async route=>{const response=await route.fetch();const cfg=await response.json();cfg.providers.find(p=>p.id==='ollama').enabled=true;await route.fulfill({json:cfg});});await page.reload();}
// Fakes the backend runtime endpoint; each status waits until the test releases it.
async function fakeRuntime(page,states){const calls=[],waiting=[],queue=[...states];
 await page.route('**/api/runtime/ollama',async route=>{calls.push(route.request().method());const next=queue.length>1?queue.shift():queue[0];await new Promise(r=>waiting.push(r));await route.fulfill({json:next});});
 return {calls,step:async()=>{await expect.poll(()=>waiting.length).toBeGreaterThan(0);waiting.shift()();}};}
test('Mock never initializes Ollama; unconfigured Ollama stays blocked without a runtime request',async({page})=>{
 const runtime=[];page.on('request',r=>{if(r.url().includes('/api/runtime'))runtime.push(r.url());});
 await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');
 await page.locator('#provider').selectOption('ollama');await expect(page.locator('#mode')).toHaveText('SETUP / BLOCKED');await expect(page.locator('#provider-description')).toContainText('ALLOW_OLLAMA=true');await expect(page.locator('#send')).toBeDisabled();await expect(page.locator('#runquest')).toBeDisabled();
 await page.locator('#provider').selectOption('mock');await expect(page.locator('#mode')).toHaveText('MOCK · NO MODEL CALLS');await expect(page.locator('#runquest')).toBeEnabled();await send(page,'/demo');await expect(page.locator('[data-statement="count1"]')).toContainText('8');
 expect(runtime).toEqual([]);
});
test('selecting Ollama shows starting, checking model and ready; actions stay disabled until ready; switching is immediate and reuses the service',async({page})=>{
 await enableOllama(page);const runtime=await fakeRuntime(page,[{state:'starting',message:'Starting Ollama…'},{state:'checking-model',message:'Checking model llama3.2:3b…'},{state:'ready',message:'Ollama ready · llama3.2:3b'}]);
 let sent;await page.route('**/api/turn',async route=>{sent=route.request().postDataJSON();const mock=await (await route.fetch({postData:JSON.stringify({...sent,provider:'mock',consent:false})})).json();await route.fulfill({json:{turn:{reply:mock.turn.reply.replaceAll('Two weeks ago, you decided to start running.','Two weeks ago, you chose to start running.')},versions:{...mock.versions,provider:'ollama',mode:'live',model:'llama3.2:3b'}}});});
 await page.locator('#provider').selectOption('ollama');
 await expect(page.locator('#mode')).toHaveText('STARTING OLLAMA…');await expect(page.locator('#runquest')).toBeDisabled();await page.locator('#consent').check();await expect(page.locator('#send')).toBeDisabled();
 await page.locator('#message').fill('typing stays responsive');await expect(page.locator('#message')).toHaveValue('typing stays responsive');await page.locator('#message').fill('');
 await runtime.step();await expect(page.locator('#mode')).toHaveText('STARTING OLLAMA…');
 await runtime.step();await expect(page.locator('#mode')).toHaveText('CHECKING MODEL…');await expect(page.locator('#provider-description')).toHaveText('Checking model llama3.2:3b…');await expect(page.locator('#runquest')).toBeDisabled();
 await runtime.step();await expect(page.locator('#mode')).toHaveText('OLLAMA READY');await expect(page.locator('#runquest')).toBeEnabled();
 expect(runtime.calls).toEqual(['POST','GET','GET']);
 await expect(page.locator('#consent-label')).toHaveText('Send RunQuest story passages and my typed messages to my local Ollama model on Send/Retry.');await page.locator('#consent').check();
 await page.locator('#runquest').click();await expect(page.locator('#pending')).toBeHidden();expect(sent.provider).toBe('ollama');expect(sent.consent).toBe(true);expect(sent.messages.at(-1).content).toBe('/runquest');
 await expect(page.locator('[data-statement="rq_s1_p1"]')).toHaveText('Two weeks ago, you chose to start running.');await expect(page.locator('#transcript .message.assistant p').last()).toHaveText('RunQuest · Step 1 of 5: Your Running Journey.');await expect(page.locator('#spoken')).toHaveText(await screenNarrative(page));await expect(page.locator('#spoken')).toContainText('Two weeks ago, you chose to start running.');
 for(const lane of ['#transcript','#spoken'])await expect(page.locator(lane)).not.toContainText(/Narrated by|passages rewritten|llama3\.2|The app decided/);
 await page.locator('#provider').selectOption('mock');await expect(page.locator('#mode')).toHaveText('MOCK · NO MODEL CALLS');await expect(page.locator('#runquest')).toBeEnabled();await expect(page.locator('#send')).toBeEnabled();
 await page.locator('#provider').selectOption('ollama');await runtime.step();await expect(page.locator('#mode')).toHaveText('OLLAMA READY');expect(runtime.calls).toEqual(['POST','GET','GET','POST']);
});
test('missing model or unavailable runtime keeps Ollama actions disabled with the actionable message',async({page})=>{
 await enableOllama(page);let turns=0;page.on('request',r=>{if(r.url().includes('/api/turn'))turns++;});
 const runtime=await fakeRuntime(page,[{state:'missing-model',message:'Model llama3.2:3b is not installed in Ollama. The app never downloads models; run `ollama pull llama3.2:3b` in a terminal, then select Ollama again.'}]);
 await page.locator('#provider').selectOption('ollama');await runtime.step();await expect(page.locator('#mode')).toHaveText('MODEL MISSING');await expect(page.locator('#provider-description')).toContainText('ollama pull llama3.2:3b');
 await page.locator('#consent').check();await expect(page.locator('#runquest')).toBeDisabled();await expect(page.locator('#send')).toBeDisabled();
 await page.unroute('**/api/runtime/ollama');await page.route('**/api/runtime/ollama',route=>route.fulfill({status:403,json:{error:'Set ALLOW_OLLAMA=true in local .env, then restart.'}}));
 await page.locator('#provider').selectOption('mock');await page.locator('#provider').selectOption('ollama');await expect(page.locator('#mode')).toHaveText('OLLAMA UNAVAILABLE');await expect(page.locator('#provider-description')).toContainText('ALLOW_OLLAMA=true');await expect(page.locator('#runquest')).toBeDisabled();
 expect(turns).toBe(0);
});
const box=(page,selector)=>page.locator(selector).evaluate(e=>{const r=e.getBoundingClientRect();return {top:r.top,bottom:r.bottom,height:r.height,scrolls:e.scrollHeight>e.clientHeight+1,atEnd:e.scrollTop+e.clientHeight>=e.scrollHeight-2};});
test('desktop: conversation history fills the column, composer stays anchored, long history and preview scroll inside a viewport-fitting workspace',async({page})=>{
 await page.setViewportSize({width:1440,height:900});await page.reload();await expect(page.locator('#provider')).toBeEnabled();
 const layout=async()=>({ws:await box(page,'.workspace'),conv:await box(page,'.conversation'),tr:await box(page,'#transcript'),composer:await box(page,'#composer'),preview:await box(page,'.preview'),screen:await box(page,'#screen'),spoken:await box(page,'.spoken')});
 const first=await layout();
 expect(first.ws.height).toBeLessThanOrEqual(900);expect(Math.abs(first.composer.top-first.tr.bottom)).toBeLessThanOrEqual(2);expect(first.tr.height).toBeGreaterThan(first.conv.height*0.45);
 expect(Math.abs(first.preview.bottom-first.spoken.bottom)).toBeLessThanOrEqual(2);
 for(let i=0;i<8;i++)await send(page,'/demo');await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');
 const after=await layout();
 expect(after.tr.scrolls).toBe(true);expect(after.tr.atEnd).toBe(true);expect(after.ws.height).toBeCloseTo(first.ws.height,0);expect(after.tr.height).toBeCloseTo(first.tr.height,0);
 expect(Math.abs(after.composer.top-after.tr.bottom)).toBeLessThanOrEqual(2);expect(after.composer.bottom).toBeLessThanOrEqual(after.ws.bottom);
 expect(after.screen.scrolls).toBe(true);expect(Math.abs(after.preview.bottom-after.spoken.bottom)).toBeLessThanOrEqual(2);
 await page.locator('.workspace').evaluate(e=>e.scrollIntoView({block:'end'}));
 for(const selector of ['.conversation .panel-heading','#transcript','#composer','#send','.preview .panel-heading','.spoken'])await expect(page.locator(selector)).toBeInViewport({ratio:1});
 await page.locator('#screen').getByRole('button',{name:'Start your journey',exact:true}).click();await expect(page.locator('#screen h3')).toHaveText('A New Week');
});
test('narrow viewport: stacked layout stays usable with a scrolling history directly above the composer',async({page})=>{
 await page.setViewportSize({width:390,height:844});await page.reload();await expect(page.locator('#provider')).toBeEnabled();
 for(let i=0;i<5;i++)await send(page,'/demo');
 const tr=await box(page,'#transcript'),composer=await box(page,'#composer');expect(tr.scrolls).toBe(true);expect(tr.atEnd).toBe(true);expect(tr.height).toBeGreaterThan(200);expect(Math.abs(composer.top-tr.bottom)).toBeLessThanOrEqual(2);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.locator('#composer').scrollIntoViewIfNeeded();await expect(page.locator('#send')).toBeInViewport();await expect(page.locator('#message')).toBeInViewport();
 await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');expect((await box(page,'#screen')).scrolls).toBe(false);await expect(page.locator('[data-statement="rq_week"] li')).toHaveCount(7);
});
const DIAGNOSTICS=/Narrated by|passages? rewritten|llama3\.2|Ollama|canonical|The app decided|RunQuest · Step/;
const screenNarrative=page=>page.locator('#screen [data-statement]').evaluateAll(nodes=>nodes.filter(n=>/^rq_s\d_p\d+$/.test(n.dataset.statement)).map(n=>n.textContent).join(' '));
async function expectSpokenIsScreen(page,includes){const narrative=await screenNarrative(page);expect(narrative.length).toBeGreaterThan(0);await expect(page.locator('#spoken')).toHaveText(narrative);if(includes)await expect(page.locator('#spoken')).toContainText(includes);await expect(page.locator('#spoken')).not.toContainText(DIAGNOSTICS);}
test('Mock: spoken-text lane reads the current RunQuest screen narrative, follows every screen and never shows stale text',async({page})=>{
 const lane=page.locator('#spoken'),placeholder='Current-screen Cues appear here as text. No audio is produced.';
 const click=async name=>{await page.locator('#screen').getByRole('button',{name,exact:true}).click();await expect(page.locator('#pending')).toBeHidden();};
 await expect(lane).toHaveText(placeholder);await expect(page.locator('.spoken h2')).toContainText('TEXT ONLY');await expect(page.locator('.spoken')).toContainText('No microphone, audio, TTS or physical exertion.');
 await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');await expectSpokenIsScreen(page,'Two weeks ago, you decided to start running.');await expect(lane).not.toHaveText('RunQuest · Step 1 of 5: Your Running Journey.');
 await click('Start your journey');await expectSpokenIsScreen(page,'How do you want to approach the week?');await expect(lane).not.toContainText('Two weeks ago');
 await send(page,'Continue');await expect(page.locator('#transcript')).toContainText('in order');await expect(page.locator('#screen h3')).toHaveText('A New Week');await expectSpokenIsScreen(page,'How do you want to approach the week?');
 await click('Plan Ahead');await expectSpokenIsScreen(page,'unexpected work commitment');
 await click('Continue');await expectSpokenIsScreen(page,'What would you like to do?');
 await click('Reconsider the Approach');await expectSpokenIsScreen(page,'Your plans changed when an unexpected commitment appeared.');await expect(lane).not.toContainText('First decision');
 await click('Try Another Journey');await expectSpokenIsScreen(page,'Two weeks ago, you decided to start running.');
 await page.locator('#reset').click();await expect(lane).toHaveText(placeholder);
 await send(page,'/demo');await expect(lane).toHaveText('Text associated with the current screen.');
});
test('Ollama: spoken-text lane uses the accepted rewrites rendered on each screen and contains no diagnostics',async({page})=>{
 await enableOllama(page);const runtime=await fakeRuntime(page,[{state:'ready',message:'Ollama ready · llama3.2:3b'}]);
 const rewrites=[['Two weeks ago, you decided to start running.','Two weeks ago, you chose to start running.'],["You look at your calendar. It's going to be a busy week, and you're not sure how running will fit into it.","You glance at your calendar and see a busy week, unsure where running fits."]];
 await page.route('**/api/turn',async route=>{const sent=route.request().postDataJSON();const mock=await (await route.fetch({postData:JSON.stringify({...sent,provider:'mock',consent:false})})).json();let reply=mock.turn.reply;for(const [from,to] of rewrites)reply=reply.replaceAll(from,to);await route.fulfill({json:{turn:{reply},versions:{...mock.versions,provider:'ollama',mode:'live',model:'llama3.2:3b'}}});});
 await page.locator('#provider').selectOption('ollama');await runtime.step();await expect(page.locator('#mode')).toHaveText('OLLAMA READY');await page.locator('#consent').check();
 await page.locator('#runquest').click();await expect(page.locator('#screen h3')).toHaveText('Your Running Journey');await expectSpokenIsScreen(page,'Two weeks ago, you chose to start running.');await expect(page.locator('#spoken')).not.toContainText('you decided to start running');
 await page.locator('#screen').getByRole('button',{name:'Start your journey',exact:true}).click();await expect(page.locator('#screen h3')).toHaveText('A New Week');await expectSpokenIsScreen(page,'You glance at your calendar and see a busy week, unsure where running fits.');await expect(page.locator('#spoken')).not.toContainText('Two weeks ago');
 await expect(page.locator('#transcript')).not.toContainText(/Narrated by|passages? rewritten|llama3\.2|The app decided/);
});

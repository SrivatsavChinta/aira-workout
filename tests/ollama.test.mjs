import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ollamaTurn,rewritePassage,rewritePassages,validateNarration,validateClassification,NARRATION_SYSTEM,OLLAMA_OPTIONS,CLASSIFY_SYSTEM,CLASSIFY_OPTIONS,NARRATION_MIN_ATTEMPT_MS} from '../dist/server/ollama.js';
import {mockTurn} from '../dist/server/mock.js';
import {FIRST_CHOICES,SECOND_CHOICES,RUNQUEST_ENDINGS,RUNQUEST_CONSEQUENCES,currentActions} from '../dist/server/runquest.js';
import {ScreenDocument,splitReply} from '../dist/shared/openui/document.js';
import {createApp,readConfig} from '../dist/server/app.js';
import {providerStatuses} from '../dist/server/config.js';
const fixture=await readFile(new URL('../examples/wiring.openui',import.meta.url),'utf8');
const config={enabled:true,url:'http://localhost:11434',model:'llama3.2:3b',timeoutMs:2000};
const req=(text,ui_state='')=>({messages:[{role:'user',content:text}],state:{ui_state,client_events:[]},provider:'ollama',consent:true,fault:'none'});
const ollamaReply=(body,init)=>new Response(typeof body==='string'?body:JSON.stringify(body),init);
const passageOf=init=>JSON.parse(init.body).prompt.replace(/^Passage:\n/,'');
const PREFIX='In short, ';
const rewriting=calls=>async(url,init)=>{calls?.push({url,body:JSON.parse(init.body)});return ollamaReply({model:'llama3.2:3b',response:PREFIX+passageOf(init),done:true,done_reason:'stop'});};
const signal=()=>new AbortController().signal;
const JOURNEY=(first,second)=>['/runquest','Start your journey',first,'Continue',second];
const DIAGNOSTIC=/Narrated by|passages? rewritten|llama3\.2|ollama|canonical|could not be reached|The app decided/i;
async function play(commands,transport){const doc=new ScreenDocument(),mock=new ScreenDocument(),replies=[],mockReplies=[],logs=[];for(const text of commands){const {turn}=await ollamaTurn(req(text,doc.echo()),config,signal(),transport,line=>logs.push(line));replies.push(turn.reply);doc.apply(turn.reply);const m=mockTurn({...req(text,mock.echo()),provider:'mock'},fixture).reply;mockReplies.push(m);mock.apply(m);}return {doc,mock,replies,mockReplies,logs};}
const child=(doc,key)=>doc.current.props.children.find(n=>n.key===key);

test('validateNarration accepts short second-person prose and strips wrapping quotes',()=>{
 assert.equal(validateNarration('  "Two weeks ago, you chose to start running."  '),'Two weeks ago, you chose to start running.');
 assert.equal(validateNarration('It’s Monday, and your week is about to begin.'),"It's Monday, and your week is about to begin.");
});
test('validateNarration rejects empty, long, malformed, prescriptive and off-perspective output',()=>{
 const long='You '+'really '.repeat(40)+'tried.';
 for(const bad of [undefined,null,42,'','   ','You tried. You paused. You stopped.',long,'You tried and then','You started.\nYou stopped.','```openui\nroot = Screens([])\n```','rq_s1_p1 = Text("You won.")','<b>You</b> tried.','Here is the rewrite: you tried.','You ran 5 km on Monday.','You should run every morning.','Warm up and stretch before you run.','See a doctor if you feel pain.','I decided to start running.','Alex decided to start running.','You {choice} today.'])
  assert.equal(validateNarration(bad),null,String(bad));
});
test('rewritePassage sends only the passage to the local generate endpoint with conservative settings',async()=>{
 const calls=[];const result=await rewritePassage('Two weeks ago, you decided to start running.',config,signal(),rewriting(calls));
 assert.deepEqual(result,{text:PREFIX+'Two weeks ago, you decided to start running.',outcome:'rewritten',model:'llama3.2:3b'});
 assert.equal(calls[0].url,'http://localhost:11434/api/generate');
 assert.deepEqual(calls[0].body,{model:'llama3.2:3b',system:NARRATION_SYSTEM,prompt:'Passage:\nTwo weeks ago, you decided to start running.',stream:false,options:OLLAMA_OPTIONS});
 assert(OLLAMA_OPTIONS.temperature<=0.3&&OLLAMA_OPTIONS.num_predict<=100);assert(/40 words/.test(NARRATION_SYSTEM));
});
test('rewritePassage keeps the canonical passage for empty, malformed, HTTP, timeout, connection and invalid failures',async()=>{
 const passage="It's Wednesday evening. Your week hasn't gone as expected.";
 const hang=(_u,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 const cases={
  empty:[async()=>ollamaReply({response:'',done:true}),'rejected'],
  whitespace:[async()=>ollamaReply({response:'   ',done:true}),'rejected'],
  invalid:[async()=>ollamaReply({response:'Run 3 km at an easy pace tonight.',done:true}),'rejected'],
  openui:[async()=>ollamaReply({response:'root = Screens([rq_s5])',done:true}),'rejected'],
  truncated:[async()=>ollamaReply({response:'Your week has not gone as expected.',done:true,done_reason:'length'}),'rejected'],
  notJson:[async()=>ollamaReply('not json'),'malformed'],
  noResponseField:[async()=>ollamaReply({message:{content:'You paused.'},done:true}),'malformed'],
  notDone:[async()=>ollamaReply({response:'Your week paused.',done:false}),'malformed'],
  nullBody:[async()=>ollamaReply('null'),'malformed'],
  http404:[async()=>ollamaReply({error:'model not found'},{status:404}),'http'],
  http500:[async()=>ollamaReply('boom',{status:500}),'http'],
  connection:[async()=>{throw new TypeError('fetch failed');},'unavailable'],
  timeout:[hang,'timeout'],
 };
 for(const [name,[transport,outcome]] of Object.entries(cases)){const result=await rewritePassage(passage,{...config,timeoutMs:50},signal(),transport);assert.deepEqual(result,{text:passage,outcome,model:null},name);}
});
test('Ollama narrates every step while the app keeps screens, choices, state and endings identical to Mock',async()=>{
 for(const first of FIRST_CHOICES)for(const second of SECOND_CHOICES){
  const calls=[];const {doc,mock,replies,mockReplies,logs}=await play(JOURNEY(first,second),rewriting(calls));
  assert.equal(doc.echo().replaceAll(PREFIX,''),mock.echo());assert.equal(doc.cursor,'rq_s5');
  assert.equal(child(doc,'rq_s5_p1').props.text,PREFIX+RUNQUEST_ENDINGS[first][second]);
  assert.deepEqual(child(doc,'rq_s5_choices').props.items.map(i=>i.props.text),[`First decision: ${first}`,`Second decision: ${second}`]);
  assert.deepEqual(child(doc,'rq_s5_actions').props.prompts,['Try Another Journey']);
  replies.forEach((reply,i)=>{const prose=splitReply(reply).prose;assert.doesNotMatch(prose,DIAGNOSTIC);assert.equal(prose,splitReply(mockReplies[i]).prose);});
  assert.equal(doc.screens.length,5);for(const screen of doc.screens){const kids=screen.props.children,narrative=kids.filter(n=>/^rq_s\d_p\d+$/.test(n.key)).map(n=>n.props.text).join(' '),cue=kids.find(n=>n.name==='Cue');assert.equal(cue.props.text,narrative,screen.key);assert.doesNotMatch(cue.props.text,DIAGNOSTIC);}
  assert(doc.current.props.children.find(n=>n.name==='Cue').props.text.startsWith(PREFIX));
  assert.equal(logs.length,5);for(const line of logs)assert.match(line,/^\[ollama\] llama3\.2:3b at http:\/\/localhost:11434: (\d+)\/\1 passages rewritten$/);
  for(const call of calls){assert(!/openui|Screens|FollowUps|rq_/.test(call.body.prompt));assert.equal(call.url,'http://localhost:11434/api/generate');}
 }
});
test('choices, prompts and labels are never sent for rewriting',async()=>{
 const calls=[];await play(['/runquest','Start your journey','Plan Ahead','Continue'],rewriting(calls));const sent=calls.map(c=>c.body.prompt).join('\n');
 for(const fixed of ["Let's see how your decisions shape the week ahead.",'Plan Ahead','Stay Flexible','Reconsider the Approach','How do you want to approach the week?','What would you like to do?','Your Running History','Running days','Continue'])assert(!sent.includes(fixed),fixed);
});
test('Ollama unavailable: the journey continues with canonical text; the failure goes to the server log, not the reply',async()=>{
 let attempts=0;const down=async()=>{attempts++;throw new TypeError('connect ECONNREFUSED');};
 const {doc,mock,replies,mockReplies,logs}=await play(JOURNEY('Plan Ahead','Leave It for Another Time'),down);
 assert.equal(doc.echo(),mock.echo());assert.equal(attempts,5);assert.deepEqual(replies,mockReplies);for(const reply of replies)assert.doesNotMatch(reply,DIAGNOSTIC);
 assert.match(logs[0],/0\/3 passages rewritten; 3 kept canonical text \(unavailable 1, skipped 2\)$/);
 for(const line of logs.slice(1))assert.match(line,/0\/(\d+) passages rewritten; \1 kept canonical text \(unavailable 1(, skipped \d+)?\)$/);
});
test('invalid model output falls back per passage without affecting the screen',async()=>{
 let n=0;const mixed=async(_u,init)=>ollamaReply({response:n++%2?'```openui\nrq_c1 = Keyword("Stay Flexible")\n```':PREFIX+passageOf(init),done:true});
 const {doc,mock,replies,logs}=await play(['/runquest','Start your journey','Plan Ahead'],mixed);
 assert.equal(doc.echo().replaceAll(PREFIX,''),mock.echo());assert.equal(child(doc,'rq_c1').props.text,'Plan Ahead');assert.doesNotMatch(splitReply(replies[0]).prose,DIAGNOSTIC);assert.match(logs[0],/2\/3 passages rewritten; 1 kept canonical text \(rejected 1\)$/);
});
test('restart, out-of-order and non-RunQuest messages never let the model drive state',async()=>{
 let calls=0;const counting=async(u,init)=>{calls++;return rewriting()(u,init);};
 const restarted=await play([...JOURNEY('Stay Flexible','Reconsider the Approach'),'Try Another Journey'],counting);assert.equal(restarted.doc.cursor,'rq_s1');assert.equal(restarted.doc.screens.length,1);assert(!restarted.doc.echo().includes('rq_c1'));
 calls=0;const skipped=await ollamaTurn(req('Reconsider the Approach',restarted.doc.echo()),config,signal(),counting);assert.equal(calls,0);assert(skipped.turn.reply.includes('in order'));assert(!skipped.turn.reply.includes('```'));
 const other=await ollamaTurn(req('/demo'),config,signal(),counting);assert.equal(calls,0);assert.equal(other.turn.reply,'Ollama mode only narrates RunQuest. Choose Start RunQuest or type /runquest.');assert.equal(other.returnedModel,null);
});
test('Ollama config defaults to local llama3.2:3b, stays off unless enabled and rejects non-local endpoints',()=>{
 const off=readConfig({},process.cwd());assert.deepEqual(off.ollama,{enabled:false,url:'http://localhost:11434',model:'llama3.2:3b',timeoutMs:20000,binary:'',startTimeoutMs:15000});
 const statuses=providerStatuses(off);assert.deepEqual(statuses.map(p=>p.id),['mock','openai-api','claude-cli','codex-cli','ollama']);assert.equal(statuses[4].enabled,false);assert.match(statuses[4].message,/ALLOW_OLLAMA=true/);
 const on=readConfig({ALLOW_OLLAMA:'true',OLLAMA_URL:'http://127.0.0.1:11500',OLLAMA_MODEL:'llama3.2:1b'},process.cwd());assert.deepEqual(on.ollama,{enabled:true,url:'http://127.0.0.1:11500',model:'llama3.2:1b',timeoutMs:20000,binary:'',startTimeoutMs:15000});assert.equal(providerStatuses(on)[4].enabled,true);
 for(const url of ['https://localhost:11434','http://example.com:11434','http://10.0.0.5:11434','http://localhost:11434/api','http://user:pw@localhost:11434','not a url'])assert.throws(()=>readConfig({OLLAMA_URL:url},process.cwd()),/OLLAMA_URL/,url);
 assert.throws(()=>readConfig({OLLAMA_MODEL:'llama3 --verbose'},process.cwd()),/OLLAMA_MODEL/);
 for(const path of ['ollama','./bin/ollama','/usr/local/bin/sh'])assert.throws(()=>readConfig({OLLAMA_CLI_PATH:path},process.cwd()),/OLLAMA_CLI_PATH/,path);
 assert.equal(readConfig({OLLAMA_CLI_PATH:'/usr/local/bin/ollama'},process.cwd()).ollama.binary,'/usr/local/bin/ollama');
});
test('HTTP: Ollama runtime requires enablement, readiness and consent, records the model and never calls a cloud provider',async()=>{
 const urls=[];let generateUp=true;
 const transport=async(url,init={})=>{const path=new URL(String(url)).pathname;urls.push(String(url));
  if(path==='/api/version')return ollamaReply({version:'test'});if(path==='/api/tags')return ollamaReply({models:[{name:'llama3.2:3b'}]});
  if(!generateUp)throw new TypeError('fetch failed');return rewriting()(url,init);};
 const open=async env=>{const server=createApp(readConfig(env,process.cwd()),transport);await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;const {token}=await (await fetch(url+'/api/config')).json();
  const call=(path,method,body)=>fetch(url+path,{method,headers:{'Content-Type':'application/json','X-Local-Token':token},body:body&&JSON.stringify(body)});
  const ready=async()=>{await call('/api/runtime/ollama','POST');for(let i=0;i<100;i++){const s=await (await call('/api/runtime/ollama','GET')).json();if(s.state==='ready')return;await new Promise(r=>setTimeout(r,10));}throw new Error('not ready');};
  return {call,ready,close:()=>new Promise(r=>server.close(r))};};
 let a=await open({});try{assert.equal((await a.call('/api/turn','POST',req('/runquest'))).status,403);}finally{await a.close();}
 a=await open({ALLOW_OLLAMA:'true'});try{assert.equal((await a.call('/api/turn','POST',req('/runquest'))).status,409);await a.ready();assert.equal((await a.call('/api/turn','POST',{...req('/runquest'),consent:false})).status,403);}finally{await a.close();}
 assert(!urls.some(u=>u.endsWith('/api/generate')));
 const info=console.info,logged=[];console.info=line=>logged.push(line);
 a=await open({ALLOW_OLLAMA:'true',ALLOW_LIVE_API:'true',OPENAI_API_KEY:'fake-unused'});
 try{await a.ready();const response=await a.call('/api/turn','POST',req('/runquest'));assert.equal(response.status,200);const data=await response.json();
  assert.equal(data.versions.provider,'ollama');assert.equal(data.versions.mode,'live');assert.equal(data.versions.model,'llama3.2:3b');assert.equal(data.versions.returnedModel,'llama3.2:3b');
  const doc=new ScreenDocument();doc.apply(data.turn.reply);assert.equal(doc.cursor,'rq_s1');assert.equal(child(doc,'rq_week').props.items.length,7);
  assert.doesNotMatch(splitReply(data.turn.reply).prose,DIAGNOSTIC);assert.equal(child(doc,'rq_s1_p1').props.text,PREFIX+'Two weeks ago, you decided to start running.');
  generateUp=false;const r=await a.call('/api/turn','POST',req('/runquest'));assert.equal(r.status,200);const fallback=new ScreenDocument();fallback.apply((await r.json()).turn.reply);assert.equal(child(fallback,'rq_s1_p1').props.text,'Two weeks ago, you decided to start running.');assert.doesNotMatch(fallback.prose,DIAGNOSTIC);
  assert.equal(logged.length,2);assert.match(logged[0],/3\/3 passages rewritten$/);assert.match(logged[1],/0\/3 passages rewritten; 3 kept canonical text \(unavailable 1, skipped 2\)$/);
 }finally{await a.close();console.info=info;}
 assert(urls.length>0&&urls.every(u=>u.startsWith('http://localhost:11434/api/')));
});

// Natural-language decisions: a separate closed-label classification call picks a current button; runQuestTurn still drives state.
const LABELS={
 "Sounds good, let's begin.":'Start your journey',
 "I'd rather keep things flexible this week.":'Stay Flexible',
 'I want to map out my schedule and see where running fits.':'Plan Ahead',
 'Okay, keep going.':'Continue',
 'Let me rethink how I handle this.':'Reconsider the Approach',
 "Maybe I'll come back to it some other time.":'Leave It for Another Time',
 "Let's do it all over again.":'Try Another Journey',
};
const SAID={'Plan Ahead':'I want to map out my schedule and see where running fits.','Stay Flexible':"I'd rather keep things flexible this week.",'Reconsider the Approach':'Let me rethink how I handle this.','Leave It for Another Time':"Maybe I'll come back to it some other time."};
const messageOf=body=>body.prompt.match(/^Message: (.*)$/m)[1];
/** Fake Ollama: classification calls answer from `answer(message)`, narration calls rewrite with PREFIX. */
const conversing=(answer,calls=[])=>async(url,init)=>{const body=JSON.parse(init.body);calls.push({url,body});
 if(body.system===CLASSIFY_SYSTEM){const reply=answer(messageOf(body));return typeof reply==='function'?reply(url,init):ollamaReply({model:'llama3.2:3b',response:reply,done:true,done_reason:'stop'});}
 return rewriting()(url,init);};
const byLabel=calls=>conversing(message=>LABELS[message]??'UNRELATED',calls);
async function talk(commands,transport,cfg=config){const doc=new ScreenDocument(),replies=[],logs=[];for(const text of commands){const {turn}=await ollamaTurn(req(text,doc.echo()),cfg,signal(),transport,line=>logs.push(line));replies.push(turn.reply);doc.apply(turn.reply);}return {doc,replies,logs};}
const exactMock=commands=>{const doc=new ScreenDocument();for(const text of commands)doc.apply(mockTurn({...req(text,doc.echo()),provider:'mock'},fixture).reply);return doc;};
const classifyCalls=calls=>calls.filter(c=>c.body.system===CLASSIFY_SYSTEM);
const optionsOf=body=>body.prompt.split('\n').filter(l=>l.startsWith('- ')).map(l=>l.slice(2).split(':')[0]);
const TO_FIRST_DECISION=['/runquest',"Sounds good, let's begin."];

test('validateClassification accepts only an exact current label, UNCLEAR or UNRELATED after minimal normalization',()=>{
 const choice={question:'How do you want to approach the week?',actions:[{label:'Plan Ahead',command:'plan ahead',description:''},{label:'Stay Flexible',command:'stay flexible',description:''}]};
 for(const ok of ['Stay Flexible',' stay flexible ','"Stay Flexible"','Stay Flexible.','STAY  FLEXIBLE'])assert.equal(validateClassification(ok,choice)?.command,'stay flexible',ok);
 assert.equal(validateClassification('UNCLEAR',choice),'UNCLEAR');assert.equal(validateClassification(' unrelated. ',choice),'UNRELATED');
 for(const bad of [undefined,null,7,'','  ','Stay Flexible because they said flexible.','Stay Flexible\nThey want flexibility.','**Stay Flexible**','`Stay Flexible`','Label: Stay Flexible','Reconsider the Approach','Continue','Try Another Journey','Plan Ahead or Stay Flexible','```openui\nroot = Screens([rq_s1, rq_s2, rq_s3], rq_s3)\n```','rq_c1 = Keyword("Stay Flexible")'])
  assert.equal(validateClassification(bad,choice),null,String(bad));
});
test('currentActions exposes only the buttons of the RunQuest screen at the cursor',()=>{
 const labels=commands=>currentActions(exactMock(commands))?.actions.map(a=>a.label)??null;
 assert.equal(labels([]),null);assert.equal(labels(['/demo']),null);
 assert.deepEqual(labels(['/runquest']),['Start your journey']);
 assert.deepEqual(labels(['/runquest','Start your journey']),['Plan Ahead','Stay Flexible']);
 assert.deepEqual(labels(['/runquest','Start your journey','Plan Ahead']),['Continue']);
 assert.deepEqual(labels(['/runquest','Start your journey','Plan Ahead','Continue']),['Reconsider the Approach','Leave It for Another Time']);
 assert.deepEqual(labels(JOURNEY('Plan Ahead','Leave It for Another Time')),['Try Another Journey']);
 for(const commands of [['/runquest'],['/runquest','Start your journey','Stay Flexible','Continue']]){const doc=exactMock(commands);const buttons=doc.current.props.children.find(n=>n.name==='FollowUps').props.prompts;assert.deepEqual(currentActions(doc).actions.map(a=>a.label),buttons);}
});
test('typed Stay Flexible and Plan Ahead equivalents advance to the matching screen 3 exactly as the buttons do',async()=>{
 for(const first of FIRST_CHOICES){const {doc,replies}=await talk([...TO_FIRST_DECISION,SAID[first]],byLabel());
  assert.equal(doc.cursor,'rq_s3');assert.equal(child(doc,'rq_c1').props.text,first);assert.equal(child(doc,'rq_s3_title').props.text,first==='Plan Ahead'?'An Unexpected Change':'Where Did the Week Go?');
  assert.equal(doc.echo().replaceAll(PREFIX,''),exactMock(['/runquest','Start your journey',first]).echo());assert(replies.at(-1).includes('```openui'));}
});
test('typed equivalents of every step reach all four existing endings with the same state as the buttons',async()=>{
 for(const first of FIRST_CHOICES)for(const second of SECOND_CHOICES){const calls=[];
  const {doc,logs}=await talk([...TO_FIRST_DECISION,SAID[first],'Okay, keep going.',SAID[second]],byLabel(calls));
  assert.equal(doc.cursor,'rq_s5');assert.equal(doc.screens.length,5);assert.equal(child(doc,'rq_s5_p1').props.text,PREFIX+RUNQUEST_ENDINGS[first][second]);
  assert.deepEqual(child(doc,'rq_s5_choices').props.items.map(i=>i.props.text),[`First decision: ${first}`,`Second decision: ${second}`]);
  assert.equal(doc.echo().replaceAll(PREFIX,''),exactMock(JOURNEY(first,second)).echo());
  assert.equal(classifyCalls(calls).length,4);assert.equal(logs.filter(l=>/classification action$/.test(l)).length,4);}
});
test('the classifier sees only the current question, its permitted actions and the latest message, with deterministic small settings',async()=>{
 const calls=[];await talk([...TO_FIRST_DECISION,SAID['Plan Ahead'],'Okay, keep going.',SAID['Reconsider the Approach'],"Let's do it all over again."],byLabel(calls));
 const sent=classifyCalls(calls).map(c=>c.body);
 assert.deepEqual(sent.map(optionsOf),[['Start your journey','UNCLEAR','UNRELATED'],['Plan Ahead','Stay Flexible','UNCLEAR','UNRELATED'],['Continue','UNCLEAR','UNRELATED'],['Reconsider the Approach','Leave It for Another Time','UNCLEAR','UNRELATED'],['Try Another Journey','UNCLEAR','UNRELATED']]);
 assert(sent[1].prompt.startsWith('Question: How do you want to approach the week?\n'));assert.equal(messageOf(sent[1]),SAID['Plan Ahead']);
 for(const body of sent){assert.equal(body.model,'llama3.2:3b');assert.equal(body.stream,false);assert.deepEqual(body.options,CLASSIFY_OPTIONS);assert.doesNotMatch(body.prompt,/openui|Screens|FollowUps|Keyword|rq_|```/);}
 assert.equal(CLASSIFY_OPTIONS.temperature,0);assert(CLASSIFY_OPTIONS.num_predict<=16);assert(!('num_ctx' in CLASSIFY_OPTIONS));
 assert(classifyCalls(calls).every(c=>c.url==='http://localhost:11434/api/generate'));
});
test('exact commands and button labels bypass classification',async()=>{
 const calls=[];for(const first of FIRST_CHOICES)for(const second of SECOND_CHOICES)await talk([...JOURNEY(first,second),'Try Another Journey','start runquest'],byLabel(calls));
 await talk(['/runquest','Start your journey','Leave It for Another Time','CONTINUE'],byLabel(calls));
 assert.equal(classifyCalls(calls).length,0);assert(calls.length>0);
});
test('passage rewrites still receive only narrative passages, never typed messages, option lists or app state',async()=>{
 const calls=[];await talk([...TO_FIRST_DECISION,SAID['Stay Flexible'],'Okay, keep going.',SAID['Leave It for Another Time']],byLabel(calls));
 const rewrites=calls.filter(c=>c.body.system===NARRATION_SYSTEM);assert(rewrites.length>0);
 for(const {body} of rewrites){assert(body.prompt.startsWith('Passage:\n'));assert.doesNotMatch(body.prompt,/UNCLEAR|UNRELATED|Options:|Question:|Message:|openui|Screens|rq_/);
  for(const text of [...Object.keys(LABELS),...FIRST_CHOICES,...SECOND_CHOICES,'Try Another Journey'])assert(!body.prompt.includes(text),text);}
});
// Each RunQuest screen reached by typed choices, with the exact replies expected for UNCLEAR and UNRELATED there.
const SCREEN_SETUPS={
 rq_s1:['/runquest'],
 rq_s2:TO_FIRST_DECISION,
 rq_s3:[...TO_FIRST_DECISION,SAID['Plan Ahead']],
 rq_s4:[...TO_FIRST_DECISION,SAID['Stay Flexible'],'Okay, keep going.'],
 rq_s5:[...TO_FIRST_DECISION,SAID['Stay Flexible'],'Okay, keep going.',SAID['Reconsider the Approach']],
};
const CONTEXTUAL={
 rq_s1:{
  UNCLEAR:"I wasn't sure what you'd like to do, so the story is staying where it is. You're at the start of the story, looking back at your previous week. Are you ready to look at the week ahead? If so, choose “Start your journey”, or say so in your own words.",
  UNRELATED:"That doesn't seem to be about this part of the story, so let's come back to it. You're at the start of the story, looking back at your previous week. Are you ready to look at the week ahead? If so, choose “Start your journey”, or say so in your own words.",
 },
 rq_s2:{
  UNCLEAR:"I couldn't tell which option you meant, so nothing has changed yet. How do you want to approach the week? You can choose “Plan Ahead” or “Stay Flexible”. Which one is closer to what you'd like?",
  UNRELATED:"That doesn't seem to be about this part of the story, so let's come back to it. It's Monday, and a busy week is ahead of you. How do you want to approach the week? “Plan Ahead”: You look at your existing commitments and consider when running might fit into your schedule. “Stay Flexible”: You decide to see how the week unfolds and figure things out as you go. Type the one you prefer, or use the buttons.",
 },
 rq_s3:{
  UNCLEAR:"I wasn't sure what you'd like to do, so the story is staying where it is. You chose “Plan Ahead”, and now it's Wednesday. Are you ready to continue the story? If so, choose “Continue”, or say so in your own words.",
  UNRELATED:"That doesn't seem to be about this part of the story, so let's come back to it. You chose “Plan Ahead”, and now it's Wednesday. Are you ready to continue the story? If so, choose “Continue”, or say so in your own words.",
 },
 rq_s4:{
  UNCLEAR:"I couldn't tell which option you meant, so nothing has changed yet. What would you like to do? You can choose “Reconsider the Approach” or “Leave It for Another Time”. Which one is closer to what you'd like?",
  UNRELATED:"That doesn't seem to be about this part of the story, so let's come back to it. It's Wednesday evening, and your week hasn't gone as expected. What would you like to do? “Reconsider the Approach”: Take another look at your commitments and reflect on how running could fit into your everyday life. “Leave It for Another Time”: Accept that this week hasn't worked out as expected and revisit the idea later. Type the one you prefer, or use the buttons.",
 },
 rq_s5:{
  UNCLEAR:"I wasn't sure what you'd like to do, so the story is staying where it is. Your journey is complete: you chose “Stay Flexible” and then “Reconsider the Approach”. There are no more decisions to make, so take as long as you like with your reflection. Would you like to try another journey? If so, choose “Try Another Journey”, or say so in your own words.",
  UNRELATED:"That doesn't seem to be about this part of the story, so let's come back to it. Your journey is complete: you chose “Stay Flexible” and then “Reconsider the Approach”. There are no more decisions to make, so take as long as you like with your reflection. Would you like to try another journey? If so, choose “Try Another Journey”, or say so in your own words.",
 },
};
test('UNCLEAR and UNRELATED replies follow the current screen question, context and options, and change nothing',async()=>{
 for(const [screen,setup] of Object.entries(SCREEN_SETUPS))for(const label of ['UNCLEAR','UNRELATED']){
  const message=label==='UNCLEAR'?"Maybe, I'm not sure.":'What should I cook for dinner tonight?';
  const before=(await talk(setup,byLabel())).doc;assert.equal(before.cursor,screen);
  const calls=[];const {doc,replies,logs}=await talk([...setup,message],conversing(m=>m===message?label:LABELS[m],calls));
  const reply=replies.at(-1),name=`${screen} ${label}`;
  assert.equal(reply,CONTEXTUAL[screen][label],name);assert(!reply.includes('```'),name);assert.doesNotMatch(reply,/\d/,name);
  assert.equal(doc.echo(),before.echo(),name);assert.equal(doc.cursor,screen,name);assert.equal(doc.screens.length,before.screens.length,name);
  const turnCalls=calls.slice(calls.findLastIndex(c=>c.body.system===CLASSIFY_SYSTEM));assert.equal(turnCalls.length,1,name);assert.equal(turnCalls[0].body.system,CLASSIFY_SYSTEM,name);
  assert.match(logs.at(-1),new RegExp(`classification ${label.toLowerCase()}$`),name);}
});
test('after an unclear or unrelated reply, a typed choice and an exact command on the same screen still work',async()=>{
 const unsure=conversing(m=>m==="Maybe, I'm not sure."?'UNCLEAR':m==='What should I cook for dinner tonight?'?'UNRELATED':LABELS[m]);
 const typed=await talk([...SCREEN_SETUPS.rq_s4,"Maybe, I'm not sure.",'What should I cook for dinner tonight?',SAID['Leave It for Another Time']],unsure);
 assert.equal(typed.doc.cursor,'rq_s5');assert.equal(child(typed.doc,'rq_s5_p1').props.text,PREFIX+RUNQUEST_ENDINGS['Stay Flexible']['Leave It for Another Time']);
 const exact=await talk([...SCREEN_SETUPS.rq_s2,"Maybe, I'm not sure.",'Stay Flexible'],unsure);
 assert.equal(exact.doc.cursor,'rq_s3');assert.equal(child(exact.doc,'rq_c1').props.text,'Stay Flexible');
 const ended=await talk([...SCREEN_SETUPS.rq_s5,"Maybe, I'm not sure.",'What should I cook for dinner tonight?'],unsure);
 assert.equal(ended.doc.cursor,'rq_s5');assert.deepEqual(child(ended.doc,'rq_s5_choices').props.items.map(i=>i.props.text),['First decision: Stay Flexible','Second decision: Reconsider the Approach']);
 const restarted=await talk([...SCREEN_SETUPS.rq_s5,"Maybe, I'm not sure.",'Try Another Journey'],unsure);assert.equal(restarted.doc.cursor,'rq_s1');assert.equal(restarted.doc.screens.length,1);
});
test('a label for an action that is not on the current screen is rejected without changing state',async()=>{
 for(const [setup,label] of [[TO_FIRST_DECISION,'Reconsider the Approach'],[TO_FIRST_DECISION,'Try Another Journey'],[TO_FIRST_DECISION,'Continue'],[[...TO_FIRST_DECISION,SAID['Plan Ahead'],'Okay, keep going.'],'Stay Flexible'],[[...TO_FIRST_DECISION,SAID['Plan Ahead']],'Leave It for Another Time'],[['/runquest'],'Plan Ahead']]){
  const before=(await talk(setup,byLabel())).doc.echo();
  const {doc,replies,logs}=await talk([...setup,'Something else entirely.'],conversing(message=>LABELS[message]??label));
  assert.equal(doc.echo(),before,label);assert(!replies.at(-1).includes('```'),label);assert.match(replies.at(-1),/^I couldn't interpret that message, so the screen was not changed\./);assert.match(logs.at(-1),/classification rejected$/);}
});
test('extra prose, markup, empty, malformed, HTTP, connection and timeout failures cannot advance the journey',async()=>{
 const raw=(body,init)=>async()=>ollamaReply(body,init);
 const hang=(_u,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
 const cases={
  prose:['Stay Flexible, because the reader wants flexibility.','rejected'],
  twoLines:['Stay Flexible\nThe reader wants flexibility.','rejected'],
  openuiFence:['```openui\nroot = Screens([rq_s1, rq_s2, rq_s3], rq_s3)\nrq_c1 = Keyword("Stay Flexible", "Your first decision")\n```','rejected'],
  openuiStatement:['rq_c1 = Keyword("Stay Flexible")','rejected'],
  markdown:['**Stay Flexible**','rejected'],
  both:['Plan Ahead or Stay Flexible','rejected'],
  empty:['','rejected'],
  whitespace:['   ','rejected'],
  truncated:[raw({response:'Stay Flexible',done:true,done_reason:'length'}),'rejected'],
  notJson:[raw('not json'),'malformed'],
  noResponseField:[raw({message:{content:'Stay Flexible'},done:true}),'malformed'],
  nonString:[raw({response:['Stay Flexible'],done:true}),'malformed'],
  notDone:[raw({response:'Stay Flexible',done:false}),'malformed'],
  nullBody:[raw('null'),'malformed'],
  http404:[raw({error:'model not found'},{status:404}),'http'],
  http500:[raw('boom',{status:500}),'http'],
  connection:[async()=>{throw new TypeError('fetch failed');},'unavailable'],
  timeout:[hang,'timeout'],
 };
 const before=exactMock(['/runquest','Start your journey']).echo();
 for(const [name,[answer,outcome]] of Object.entries(cases)){const calls=[];
  const {doc,replies,logs}=await talk([...TO_FIRST_DECISION,SAID['Stay Flexible']],conversing(message=>message===SAID['Stay Flexible']?answer:LABELS[message],calls),{...config,timeoutMs:50});
  assert.equal(doc.echo().replaceAll(PREFIX,''),before,name);assert.equal(doc.cursor,'rq_s2',name);assert(!doc.echo().includes('rq_c1'),name);
  assert(!replies.at(-1).includes('```'),name);assert.match(replies.at(-1),/so the screen was not changed\./,name);assert.match(logs.at(-1),new RegExp(`classification ${outcome}$`),name);
  assert.equal(calls.at(-1).body.system,CLASSIFY_SYSTEM,name);}
});
test('typed restart on the final screen restarts cleanly; exact restart still works and other messages without a journey make no model call',async()=>{
 const {doc}=await talk([...TO_FIRST_DECISION,SAID['Plan Ahead'],'Okay, keep going.',SAID['Reconsider the Approach'],"Let's do it all over again."],byLabel());
 assert.equal(doc.cursor,'rq_s1');assert.equal(doc.screens.length,1);assert(!doc.echo().includes('rq_c1'));assert(!doc.echo().includes('rq_c2'));assert.equal(child(doc,'rq_week').props.items.length,7);
 const midway=await talk([...TO_FIRST_DECISION,SAID['Stay Flexible'],'Try Another Journey'],byLabel());assert.equal(midway.doc.cursor,'rq_s1');assert(!midway.doc.echo().includes('rq_c1'));
 let calls=0;const counting=async(u,init)=>{calls++;return byLabel()(u,init);};
 const none=await ollamaTurn(req("I'd rather keep things flexible this week."),config,signal(),counting);assert.equal(calls,0);assert.equal(none.turn.reply,'Ollama mode only narrates RunQuest. Choose Start RunQuest or type /runquest.');
 const demo=exactMock(['/demo']);const other=await ollamaTurn(req('Okay, keep going.',demo.echo()),config,signal(),counting);assert.equal(calls,0);assert(other.turn.reply.startsWith('Ollama mode only narrates RunQuest'));
});
test('Mock stays exact-command only: typed equivalents are not interpreted',()=>{
 const doc=exactMock(['/runquest','Start your journey']);const reply=mockTurn({...req(SAID['Stay Flexible'],doc.echo()),provider:'mock'},fixture).reply;
 assert(reply.includes('Mock only understands'));assert(!reply.includes('```'));
});

// Narration runs one request at a time within one shared budget per turn.
const PASSAGES=['Two weeks ago, you decided to start running.','Initially, you felt motivated.',"It's Monday, and you're about to start another week."];
const hang=(_u,init)=>new Promise((_,reject)=>init.signal.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError'))));
test('narration requests are sequential, in screen order, and never overlap',async()=>{
 let active=0,peak=0;const order=[];
 const slow=async(url,init)=>{active++;peak=Math.max(peak,active);order.push(passageOf(init));await new Promise(r=>setTimeout(r,15));active--;return rewriting()(url,init);};
 const results=await rewritePassages(PASSAGES,config,signal(),slow);
 assert.equal(peak,1);assert.deepEqual(order,PASSAGES);assert.deepEqual(results.map(r=>r.outcome),['rewritten','rewritten','rewritten']);assert.deepEqual(results.map(r=>r.text),PASSAGES.map(p=>PREFIX+p));
 const calls=[];const {doc}=await play(['/runquest'],async(url,init)=>{calls.push(passageOf(init));return rewriting()(url,init);});
 assert.deepEqual(calls,[child(doc,'rq_s1_p1').props.text,child(doc,'rq_s1_p2').props.text,child(doc,'rq_s1_p3').props.text].map(t=>t.replace(PREFIX,'')));
});
test('the shared budget limits the whole turn: passages that do not fit keep canonical text without a request',async()=>{
 let clock=0,calls=0;const ticking=async(url,init)=>{calls++;clock+=900;return rewriting()(url,init);};
 const results=await rewritePassages(PASSAGES,{...config,timeoutMs:2000},signal(),ticking,()=>clock);
 assert.equal(calls,2);assert.deepEqual(results.map(r=>r.outcome),['rewritten','rewritten','skipped']);assert.equal(results[2].text,PASSAGES[2]);
 assert(2000-1800<NARRATION_MIN_ATTEMPT_MS);
});
test('a narration timeout ends the turn at the shared budget and skips the remaining passages',async()=>{
 let calls=0;const counted=async(u,init)=>{calls++;return hang(u,init);};const started=Date.now();
 const results=await rewritePassages(PASSAGES,{...config,timeoutMs:900},signal(),counted);
 const elapsed=Date.now()-started;assert.equal(calls,1);assert(elapsed<1500,`took ${elapsed} ms`);
 assert.deepEqual(results.map(r=>r.outcome),['timeout','skipped','skipped']);assert.deepEqual(results.map(r=>r.text),PASSAGES);
});
test('HTTP and connection failures stop further narration requests; rejected output does not',async()=>{
 for(const [transport,first] of [[async()=>ollamaReply('boom',{status:500}),'http'],[async()=>{throw new TypeError('fetch failed');},'unavailable']]){
  let calls=0;const results=await rewritePassages(PASSAGES,config,signal(),async(u,init)=>{calls++;return transport(u,init);});
  assert.equal(calls,1,first);assert.deepEqual(results.map(r=>r.outcome),[first,'skipped','skipped']);assert.deepEqual(results.map(r=>r.text),PASSAGES);}
 let calls=0;const results=await rewritePassages(PASSAGES,config,signal(),async()=>{calls++;return ollamaReply({response:'Run 3 km at an easy pace tonight.',done:true});});
 assert.equal(calls,3);assert.deepEqual(results.map(r=>r.outcome),['rejected','rejected','rejected']);assert.deepEqual(results.map(r=>r.text),PASSAGES);
 const aborted=new AbortController();aborted.abort();let none=0;
 assert.deepEqual((await rewritePassages(PASSAGES,config,aborted.signal,async()=>{none++;return rewriting()();})).map(r=>r.outcome),['skipped','skipped','skipped']);assert.equal(none,0);
});
test('a valid typed or button choice still advances when narration times out',async()=>{
 const stalls=(u,init)=>JSON.parse(init.body).system===CLASSIFY_SYSTEM?byLabel()(u,init):hang(u,init);
 const budget={...config,timeoutMs:1000};
 for(const [first,message] of [['Stay Flexible',SAID['Stay Flexible']],['Plan Ahead','Plan Ahead']]){
  const {doc}=await talk(TO_FIRST_DECISION,byLabel());const logs=[];const started=Date.now();
  const {turn}=await ollamaTurn(req(message,doc.echo()),budget,signal(),stalls,line=>logs.push(line));doc.apply(turn.reply);
  assert(Date.now()-started<1600,first);assert.equal(doc.cursor,'rq_s3',first);assert.equal(child(doc,'rq_c1').props.text,first);
  assert.equal(child(doc,'rq_s3_p1').props.text,RUNQUEST_CONSEQUENCES[first].story[0]);assert.equal(child(doc,'rq_s3_p2').props.text,RUNQUEST_CONSEQUENCES[first].story[1]);
  assert.match(logs.at(-1),/0\/2 passages rewritten; 2 kept canonical text \(timeout 1, skipped 1\)$/,first);}
});

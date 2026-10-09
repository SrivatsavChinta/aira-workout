import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ollamaTurn,rewritePassage,validateNarration,NARRATION_SYSTEM,OLLAMA_OPTIONS} from '../dist/server/ollama.js';
import {mockTurn} from '../dist/server/mock.js';
import {FIRST_CHOICES,SECOND_CHOICES,RUNQUEST_ENDINGS} from '../dist/server/runquest.js';
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
 assert.equal(doc.echo(),mock.echo());assert(attempts>0);assert.deepEqual(replies,mockReplies);for(const reply of replies)assert.doesNotMatch(reply,DIAGNOSTIC);
 for(const line of logs)assert.match(line,/0\/(\d+) passages rewritten; \1 kept canonical text \(unavailable \1\)$/);
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
  assert.equal(logged.length,2);assert.match(logged[0],/3\/3 passages rewritten$/);assert.match(logged[1],/0\/3 passages rewritten; 3 kept canonical text \(unavailable 3\)$/);
 }finally{await a.close();console.info=info;}
 assert(urls.length>0&&urls.every(u=>u.startsWith('http://localhost:11434/api/')));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {OllamaRuntime,OLLAMA_BINARIES} from '../dist/server/ollama-runtime.js';
import {createApp,readConfig} from '../dist/server/app.js';
const config={enabled:true,url:'http://localhost:11434',model:'llama3.2:3b',timeoutMs:2000,binary:'',startTimeoutMs:1000};
const TAGS={models:[{name:'llama3.2:3b',model:'llama3.2:3b'},{name:'qwen3:4b',model:'qwen3:4b'}]};
// A fake Ollama: `up` controls whether /api/version answers; every URL is recorded.
function fakeOllama({up=false,tags=TAGS,tagsStatus=200,startOnSpawn=true,generate}={}){
 const state={up,urls:[],methods:[],spawns:[],children:[]};
 state.fetch=async(url,init={})=>{const path=new URL(String(url)).pathname;state.urls.push(path);state.methods.push(init.method??'GET');
  if(path==='/api/generate'&&generate)return generate(url,init);
  if(!state.up)throw new TypeError('fetch failed');
  if(path==='/api/version')return new Response(JSON.stringify({version:'0.0.0-test'}));
  if(path==='/api/tags')return new Response(typeof tags==='string'?tags:JSON.stringify(tags),{status:tagsStatus});
  return new Response('{}',{status:404});};
 state.spawn=(binary,args,options)=>{const child=Object.assign(new EventEmitter(),{unref(){}});state.spawns.push({binary,args,options});state.children.push(child);if(startOnSpawn)setTimeout(()=>{state.up=true;},20);return child;};
 return state;
}
const deps=(fake,extra={})=>({fetch:fake.fetch,spawn:fake.spawn,platform:'darwin',env:{PATH:'/usr/bin',HOME:'/tmp/home',OPENAI_API_KEY:'synthetic-secret',OLLAMA_MODELS:'/tmp/models',OLLAMA_URL:'http://localhost:11434'},exists:path=>path==='/usr/local/bin/ollama',pollMs:10,...extra});
async function run(runtime){const first=runtime.start();return {first,final:await runtime.settled()};}

test('reuses an already responding Ollama service without spawning and reports ready',async()=>{
 const fake=fakeOllama({up:true});const {first,final}=await run(new OllamaRuntime(config,deps(fake)));
 assert.equal(first.state,'starting');assert.equal(final.state,'ready');assert.match(final.message,/Ollama ready/);assert.equal(fake.spawns.length,0);
 assert.deepEqual([...new Set(fake.urls)],['/api/version','/api/tags']);assert(fake.methods.every(m=>m==='GET'));
});
test('starts ollama serve non-blocking with a minimal environment when the API is down, then becomes ready',async()=>{
 const fake=fakeOllama();const runtime=new OllamaRuntime(config,deps(fake));const {final}=await run(runtime);
 assert.equal(final.state,'ready');assert.equal(fake.spawns.length,1);const [spawned]=fake.spawns;
 assert.equal(spawned.binary,'/usr/local/bin/ollama');assert.deepEqual(spawned.args,['serve']);assert.equal(spawned.options.shell,false);assert.equal(spawned.options.stdio,'ignore');
 assert.equal(spawned.options.env.OLLAMA_HOST,'localhost:11434');assert.equal(spawned.options.env.OLLAMA_MODELS,'/tmp/models');assert.equal(spawned.options.env.OPENAI_API_KEY,undefined);assert.equal(spawned.options.env.OLLAMA_URL,undefined);
 assert(OLLAMA_BINARIES.includes('/usr/local/bin/ollama'));
});
test('concurrent and repeated starts never spawn duplicate service instances',async()=>{
 const fake=fakeOllama();const runtime=new OllamaRuntime(config,deps(fake));runtime.start();runtime.start();runtime.start();
 assert.equal((await runtime.settled()).state,'ready');assert.equal(fake.spawns.length,1);
 runtime.start();assert.equal((await runtime.settled()).state,'ready');assert.equal(fake.spawns.length,1);
 const slow=fakeOllama({startOnSpawn:false});const waiting=new OllamaRuntime({...config,startTimeoutMs:60},deps(slow));
 assert.equal((await run(waiting)).final.state,'unavailable');setTimeout(()=>{slow.up=true;},20);assert.equal((await run(waiting)).final.state,'ready');assert.equal(slow.spawns.length,1);
});
test('configured model must already be installed; a missing model is reported and never downloaded',async()=>{
 const fake=fakeOllama({up:true,tags:{models:[{name:'qwen3:4b'}]}});const {final}=await run(new OllamaRuntime(config,deps(fake)));
 assert.equal(final.state,'missing-model');assert.match(final.message,/not installed.*never downloads.*ollama pull llama3\.2:3b/);
 assert(!fake.urls.some(u=>u.includes('pull')));assert(fake.methods.every(m=>m==='GET'));
 const latest=fakeOllama({up:true,tags:{models:[{name:'llama3.2:latest'}]}});assert.equal((await run(new OllamaRuntime({...config,model:'llama3.2'},deps(latest)))).final.state,'ready');
});
test('unreadable model list and HTTP errors are reported as unavailable',async()=>{
 for(const opts of [{tags:'not json'},{tagsStatus:500},{tags:{models:'nope'}}]){const fake=fakeOllama({up:true,...opts});const {final}=await run(new OllamaRuntime(config,deps(fake)));assert.notEqual(final.state,'ready',JSON.stringify(opts));}
 assert.equal((await run(new OllamaRuntime(config,deps(fakeOllama({up:true,tagsStatus:500}))))).final.state,'unavailable');
});
test('startup failures give actionable errors: missing executable, spawn error, early exit, non-macOS',async()=>{
 const none=fakeOllama();let status=(await run(new OllamaRuntime(config,deps(none,{exists:()=>false})))).final;assert.equal(status.state,'unavailable');assert.match(status.message,/executable was not found.*OLLAMA_CLI_PATH/);assert.equal(none.spawns.length,0);
 const configured=fakeOllama();status=(await run(new OllamaRuntime({...config,binary:'/custom/ollama'},deps(configured,{exists:p=>p==='/custom/ollama'})))).final;assert.equal(status.state,'ready');assert.equal(configured.spawns[0].binary,'/custom/ollama');
 const throws=fakeOllama();status=(await run(new OllamaRuntime(config,deps(throws,{spawn:()=>{throw new Error('EACCES');}})))).final;assert.equal(status.state,'unavailable');assert.match(status.message,/could not be started/);
 const exits=fakeOllama({startOnSpawn:false});const spawnExit=(...a)=>{const child=exits.spawn(...a);setTimeout(()=>child.emit('exit'),15);return child;};
 status=(await run(new OllamaRuntime(config,deps(exits,{spawn:spawnExit})))).final;assert.equal(status.state,'unavailable');assert.match(status.message,/exited early/);
 const errors=fakeOllama({startOnSpawn:false});const spawnError=(...a)=>{const child=errors.spawn(...a);setTimeout(()=>child.emit('error',new Error('ENOENT')),15);return child;};
 status=(await run(new OllamaRuntime(config,deps(errors,{spawn:spawnError})))).final;assert.equal(status.state,'unavailable');assert.match(status.message,/could not be started or exited early/);
 const linux=fakeOllama();status=(await run(new OllamaRuntime(config,deps(linux,{platform:'linux'})))).final;assert.equal(status.state,'unavailable');assert.match(status.message,/only supported on macOS/);assert.equal(linux.spawns.length,0);
});
test('readiness wait is bounded by the startup timeout',async()=>{
 const fake=fakeOllama({startOnSpawn:false});const started=Date.now();const {final}=await run(new OllamaRuntime({...config,startTimeoutMs:120},deps(fake)));
 assert.equal(final.state,'unavailable');assert.match(final.message,/did not become ready within/);assert(Date.now()-started<1500);assert.equal(fake.spawns.length,1);
});

async function server(env,fake){const cfg=readConfig(env,process.cwd());const runtime=new OllamaRuntime(cfg.ollama,deps(fake));const app=createApp(cfg,fake.fetch,undefined,undefined,runtime);await new Promise(r=>app.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+app.address().port;const {token}=await (await fetch(url+'/api/config')).json();
 const call=(path,method='GET',body,t=token)=>fetch(url+path,{method,headers:{'X-Local-Token':t,...(body?{'Content-Type':'application/json'}:{})},body:body&&JSON.stringify(body)});
 return {call,runtime,close:()=>new Promise(r=>app.close(r))};}
const turn=(provider,text,consent=provider!=='mock')=>({provider,consent,fault:'none',messages:[{role:'user',content:text}],state:{ui_state:'',client_events:[]}});
const PREFIX='In short, ';
const generate=async(_u,init)=>new Response(JSON.stringify({model:'llama3.2:3b',response:PREFIX+JSON.parse(init.body).prompt.replace(/^Passage:\n/,''),done:true}));

test('HTTP: loading the app and using Mock never initializes, checks or starts Ollama',async()=>{
 const fake=fakeOllama();const s=await server({ALLOW_OLLAMA:'true'},fake);
 try{for(const text of ['/runquest','Start your journey','/demo']){const r=await s.call('/api/turn','POST',turn('mock',text));assert.equal(r.status,200);}
  assert.equal(fake.urls.length,0);assert.equal(fake.spawns.length,0);assert.equal(s.runtime.status.state,'idle');}finally{await s.close();}
});
test('HTTP: runtime endpoint is token-protected and requires ALLOW_OLLAMA',async()=>{
 const off=fakeOllama({up:true});const s=await server({},off);
 try{assert.equal((await s.call('/api/runtime/ollama','POST')).status,403);assert.equal(off.urls.length,0);assert.equal((await s.call('/api/runtime/ollama','POST',undefined,'wrong')).status,403);}finally{await s.close();}
 const on=fakeOllama({up:true});const t=await server({ALLOW_OLLAMA:'true'},on);
 try{assert.equal((await t.call('/api/runtime/ollama','POST',undefined,'x'.repeat(64))).status,403);assert.equal(on.urls.length,0);}finally{await t.close();}
});
test('HTTP: selecting Ollama starts the service, gates turns until ready, and switching back to Ollama reuses it',async()=>{
 const fake=fakeOllama({generate});const s=await server({ALLOW_OLLAMA:'true'},fake);
 try{
  assert.equal((await s.call('/api/turn','POST',turn('ollama','/runquest'))).status,409);
  const started=await (await s.call('/api/runtime/ollama','POST')).json();assert.equal(started.state,'starting');
  assert.equal((await s.call('/api/turn','POST',turn('mock','/runquest'))).status,200);
  let status=started;for(let i=0;i<100&&!['ready','missing-model','unavailable'].includes(status.state);i++){await new Promise(r=>setTimeout(r,20));status=await (await s.call('/api/runtime/ollama')).json();}
  assert.equal(status.state,'ready');assert.equal(fake.spawns.length,1);
  const info=console.info,logged=[];console.info=line=>logged.push(line);let reply;try{const ok=await s.call('/api/turn','POST',turn('ollama','/runquest'));assert.equal(ok.status,200);reply=(await ok.json()).turn.reply;}finally{console.info=info;}
  assert(reply.includes(PREFIX+'Two weeks ago, you decided to start running.'));assert(!/Narrated by|passages rewritten/.test(reply));assert.match(logged.join('\n'),/\[ollama\] llama3\.2:3b at http:\/\/localhost:11434: 3\/3 passages rewritten/);
  assert.equal((await s.call('/api/turn','POST',turn('ollama','/runquest',false))).status,403);
  assert.equal((await s.call('/api/turn','POST',turn('mock','/demo'))).status,200);
  await s.call('/api/runtime/ollama','POST');assert.equal((await s.runtime.settled()).state,'ready');assert.equal(fake.spawns.length,1);
  assert(fake.urls.every(u=>['/api/version','/api/tags','/api/generate'].includes(u)));
 }finally{await s.close();}
});
test('HTTP: a missing model keeps Ollama turns blocked with an actionable status',async()=>{
 const fake=fakeOllama({up:true,tags:{models:[]}});const s=await server({ALLOW_OLLAMA:'true'},fake);
 try{await s.call('/api/runtime/ollama','POST');await s.runtime.settled();const status=await (await s.call('/api/runtime/ollama')).json();assert.equal(status.state,'missing-model');assert.match(status.message,/ollama pull/);
  assert.equal((await s.call('/api/turn','POST',turn('ollama','/runquest'))).status,409);}finally{await s.close();}
});

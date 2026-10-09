import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp,readConfig} from '../dist/server/app.js';
import {DevReload} from '../dist/server/dev-reload.js';
import {OllamaRuntime} from '../dist/server/ollama-runtime.js';

async function open(devReload){const config=readConfig({},process.cwd());const server=createApp(config,fetch,undefined,undefined,new OllamaRuntime(config.ollama),devReload);await new Promise(r=>server.listen(0,'127.0.0.1',r));return {url:'http://127.0.0.1:'+server.address().port,close:()=>new Promise(r=>{server.closeAllConnections();server.close(r);})};}
const decoder=new TextDecoder();
async function readUntil(reader,pattern){let text='';while(!pattern.test(text)){const {value,done}=await reader.read();if(done)break;text+=decoder.decode(value);}return text;}

test('npm start mode: no refresh channel is exposed',async()=>{
 const a=await open();try{const cfg=await (await fetch(a.url+'/api/config')).json();assert.equal(cfg.devReload,false);assert.equal((await fetch(a.url+'/api/dev/events')).status,404);}finally{await a.close();}
});
test('dev mode: the refresh channel sends the server instance, then reload and stylesheet events',async()=>{
 const reload=new DevReload();const a=await open(reload);const controller=new AbortController();
 try{
  const cfg=await (await fetch(a.url+'/api/config')).json();assert.equal(cfg.devReload,true);
  const response=await fetch(a.url+'/api/dev/events',{signal:controller.signal});assert.equal(response.status,200);
  assert.equal(response.headers.get('content-type'),'text/event-stream');assert.equal(response.headers.get('x-content-type-options'),'nosniff');
  const reader=response.body.getReader();
  const hello=await readUntil(reader,/event: hello\ndata: \w+\n\n/);assert.match(hello,/^retry: 300\n/);assert(hello.includes(`data: ${reload.instance}\n`));assert.equal(reload.connected,1);
  reload.send('css');assert.match(await readUntil(reader,/event: css\n/),/event: css\ndata: \d+\n\n/);
  reload.send('reload');assert.match(await readUntil(reader,/event: reload\n/),/event: reload\ndata: \d+\n\n/);
  assert.equal((await fetch(a.url+'/api/dev/events',{method:'POST'})).status,405);
  assert.equal((await fetch(a.url+'/api/dev/events',{headers:{Origin:'https://example.org'}})).status,403);
  controller.abort();for(let i=0;i<50&&reload.connected;i++)await new Promise(r=>setTimeout(r,10));assert.equal(reload.connected,0);
 }finally{controller.abort();await a.close();}
 assert.notEqual(new DevReload().instance,reload.instance);
});

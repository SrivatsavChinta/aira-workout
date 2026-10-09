import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=new URL('..',import.meta.url);
// Prints only booleans derived from synthetic values, never the values themselves.
const probe=`import {readConfig} from ${JSON.stringify(new URL('../dist/server/config.js',import.meta.url).href)};const c=readConfig(process.env,process.cwd()).ollama;console.log(JSON.stringify({enabled:c.enabled,modelFromProcess:c.model==='process-model:2b',modelFromFile:c.model==='file-model:1b',urlFromFile:c.url==='http://127.0.0.1:12345',defaults:c.model==='llama3.2:3b'&&c.url==='http://localhost:11434'}));`;
function load(envFile,env={}){const clean=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(OLLAMA_|ALLOW_OLLAMA)/.test(k)));const out=execFileSync(process.execPath,[`--env-file-if-exists=${envFile}`,'--input-type=module','-e',probe],{env:{...clean,...env},encoding:'utf8'});return JSON.parse(out);}

test('npm start explicitly loads the local .env file',async()=>{
 const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));assert.match(pkg.scripts.start,/node --env-file-if-exists=\.env dist\/server\/main\.js/);
});
test('.env values reach the server configuration and process environment takes precedence',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'aira-env-'));const file=join(dir,'.env');
 try{await writeFile(file,'ALLOW_OLLAMA=true\nOLLAMA_MODEL=file-model:1b\nOLLAMA_URL=http://127.0.0.1:12345\n');
  assert.deepEqual(load(file),{enabled:true,modelFromProcess:false,modelFromFile:true,urlFromFile:true,defaults:false});
  assert.deepEqual(load(file,{OLLAMA_MODEL:'process-model:2b',ALLOW_OLLAMA:'false'}),{enabled:false,modelFromProcess:true,modelFromFile:false,urlFromFile:true,defaults:false});
  assert.deepEqual(load(join(dir,'missing.env')),{enabled:false,modelFromProcess:false,modelFromFile:false,urlFromFile:false,defaults:true});
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('.env is ignored by Git, .env.example stays tracked and keeps safe placeholders',async(t)=>{
 if(spawnSync('git',['rev-parse','--is-inside-work-tree'],{cwd:root}).status!==0){t.skip('not a git checkout');return;}
 assert.equal(spawnSync('git',['check-ignore','-q','.env'],{cwd:root}).status,0);
 assert.equal(spawnSync('git',['check-ignore','-q','.env.example'],{cwd:root}).status,1);
 assert.equal(spawnSync('git',['ls-files','--error-unmatch','.env.example'],{cwd:root}).status,0);
 assert.equal(spawnSync('git',['ls-files','--error-unmatch','.env'],{cwd:root}).status,1);
 const example=await readFile(new URL('.env.example',root),'utf8');
 for(const line of ['ALLOW_LIVE_API=false','OPENAI_API_KEY=','ALLOW_CLAUDE_CLI=false','ALLOW_OLLAMA=false','OLLAMA_MODEL=llama3.2:3b','OLLAMA_URL=http://localhost:11434','OLLAMA_CLI_PATH='])assert(example.split('\n').includes(line),line);
});

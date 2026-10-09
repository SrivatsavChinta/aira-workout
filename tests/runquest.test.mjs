import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {mockTurn} from '../dist/server/mock.js';
import {RUNQUEST_ENDINGS,FIRST_CHOICES,SECOND_CHOICES} from '../dist/server/runquest.js';
import {ScreenDocument} from '../dist/shared/openui/document.js';
import {validateProgram} from '../dist/shared/openui/validate.js';
import {createApp,readConfig} from '../dist/server/app.js';
const fixture=await readFile(new URL('../examples/wiring.openui',import.meta.url),'utf8');
const req=(text,ui_state='')=>({messages:[{role:'user',content:text}],state:{ui_state,client_events:[]},provider:'mock',consent:false,fault:'none'});
function play(...commands){const doc=new ScreenDocument();const replies=[];for(const text of commands){const turn=mockTurn(req(text,doc.echo()),fixture);replies.push(turn.reply);doc.apply(turn.reply);}return {doc,replies};}
const current=doc=>doc.current.props.children;
const child=(doc,key)=>current(doc).find(n=>n.key===key);
const texts=doc=>current(doc).flatMap(n=>n.name==='List'?n.props.items.map(i=>i.props.text):n.name==='FollowUps'?n.props.prompts:[n.props.text]).join('\n');
const buttons=doc=>current(doc).find(n=>n.name==='FollowUps').props.prompts;

test('RunQuest screen 1 introduces the journey in the second person with a valid single screen',()=>{
 const {doc}=play('/runquest');assert.equal(doc.cursor,'rq_s1');assert.equal(doc.screens.length,1);validateProgram(doc.program);
 assert.equal(child(doc,'rq_s1_title').props.text,'Your Running Journey');assert.equal(child(doc,'rq_s1_p1').props.text,'Two weeks ago, you decided to start running.');assert.match(texts(doc),/Let's see how your decisions shape the week ahead\./);
 assert.equal(child(doc,'rq_s1_history').props.text,'Your Running History');assert.equal(child(doc,'rq_s1_period').props.text,'Your previous seven days');assert.match(child(doc,'rq_s1_note').props.text,/^Example running history for this interactive journey\./);
 assert.deepEqual(buttons(doc),['Start your journey']);
});
test('RunQuest calendar shows seven fictional days, three running days and 7.5 km',()=>{
 const {doc}=play('/runquest');const days=child(doc,'rq_week').props.items;
 assert.deepEqual(days.map(d=>d.props.text),['Mon\n2.0 km','Tue\n—','Wed\n—','Thu\n3.0 km','Fri\n—','Sat\n2.5 km','Sun\n—']);
 assert.deepEqual(days.map(d=>d.props.marker),['plus','minus','minus','plus','minus','plus','minus']);
 assert.equal(days.filter(d=>d.props.marker==='plus').length,3);
 assert.equal(child(doc,'rq_s1_totals').props.text,'Running days: 3 · Total distance: 7.5 km');
});
test('Start your journey advances to the first decision',()=>{
 const {doc}=play('/runquest','Start your journey');assert.equal(doc.cursor,'rq_s2');assert.equal(child(doc,'rq_s2_title').props.text,'A New Week');assert.deepEqual(buttons(doc),['Plan Ahead','Stay Flexible']);
});
test('first decision selects the screen 3 consequence',()=>{
 const plan=play('/runquest','Start your journey','Plan Ahead').doc;assert.equal(plan.cursor,'rq_s3');assert.equal(child(plan,'rq_s3_title').props.text,'An Unexpected Change');assert.match(texts(plan),/unexpected work commitment disrupts your plans/);assert.equal(child(plan,'rq_c1').props.text,'Plan Ahead');
 const flex=play('/runquest','Start your journey','Stay Flexible').doc;assert.equal(child(flex,'rq_s3_title').props.text,'Where Did the Week Go?');assert.match(texts(flex),/other priorities have taken over/);assert.equal(child(flex,'rq_c1').props.text,'Stay Flexible');
});
test('first decision survives later transitions and the second decision is recorded',()=>{
 const {doc}=play('/runquest','Start your journey','Stay Flexible','Continue');assert.equal(doc.cursor,'rq_s4');assert.equal(child(doc,'rq_s4_title').props.text,'A Moment to Reflect');assert(doc.echo().includes('rq_c1 = Keyword("Stay Flexible"'));
 doc.apply(mockTurn(req('Reconsider the Approach',doc.echo()),fixture).reply);assert.equal(doc.cursor,'rq_s5');assert.equal(doc.screens.length,5);
 assert.deepEqual(child(doc,'rq_s5_choices').props.items.map(i=>i.props.text),['First decision: Stay Flexible','Second decision: Reconsider the Approach']);assert(doc.echo().includes('rq_c1 = Keyword("Stay Flexible"'));
});
test('all four decision combinations produce their exact ending',()=>{
 const expected={'Plan Ahead|Reconsider the Approach':'Your plans changed when an unexpected commitment appeared.','Plan Ahead|Leave It for Another Time':'You made an initial plan, but unexpected commitments disrupted it.','Stay Flexible|Reconsider the Approach':'Your flexible approach left the week open to changing priorities.','Stay Flexible|Leave It for Another Time':'The week became busy before you found an opportunity to think about running.'};
 for(const first of FIRST_CHOICES)for(const second of SECOND_CHOICES){const {doc}=play('/runquest','Start your journey',first,'Continue',second);const ending=child(doc,'rq_s5_p1').props.text;assert.equal(ending,RUNQUEST_ENDINGS[first][second]);assert(ending.startsWith(expected[`${first}|${second}`]));assert.match(texts(doc),/fictional journey/);assert.deepEqual(buttons(doc),['Try Another Journey']);}
 assert.equal(new Set(Object.values(RUNQUEST_ENDINGS).flatMap(Object.values)).size,4);
});
test('missing or invalid decisions never produce an ending',()=>{
 for(const steps of [['/runquest','Reconsider the Approach'],['/runquest','Start your journey','Leave It for Another Time'],['/runquest','Continue'],['/runquest','Plan Ahead']]){const {doc,replies}=play(...steps);assert(!replies.at(-1).includes('```'));assert(replies.at(-1).includes('in order'));assert(!doc.screens.some(s=>s.key==='rq_s5'));}
 const {doc}=play('/runquest','Start your journey','Plan Ahead','Continue');doc.apply('```openui\nrq_c1 = Keyword("Something else", "Your first decision")\n```');
 const reply=mockTurn(req('Reconsider the Approach',doc.echo()),fixture).reply;assert(!reply.includes('```'));doc.apply(reply);assert(!doc.screens.some(s=>s.key==='rq_s5'));
 assert(mockTurn(req('Reconsider the Approach'),fixture).reply.includes('Mock only understands'));
});
test('choosing again from an earlier screen re-branches and drops the later decision',()=>{
 const {doc}=play('/runquest','Start your journey','Plan Ahead','Continue','Leave It for Another Time','Stay Flexible');
 assert.equal(doc.cursor,'rq_s3');assert.equal(doc.screens.length,3);assert.equal(child(doc,'rq_c1').props.text,'Stay Flexible');assert(!doc.echo().includes('rq_c2'));
});
test('Try Another Journey clears both decisions and restores screen 1',()=>{
 const {doc}=play('/runquest','Start your journey','Plan Ahead','Continue','Reconsider the Approach','Try Another Journey');
 assert.equal(doc.cursor,'rq_s1');assert.equal(doc.screens.length,1);assert(!doc.echo().includes('rq_c1'));assert(!doc.echo().includes('rq_c2'));assert.equal(doc.clearVersion,2);assert.equal(child(doc,'rq_week').props.items.length,7);
 doc.apply(mockTurn(req('Start your journey',doc.echo()),fixture).reply);assert.equal(doc.cursor,'rq_s2');
});
test('existing Mock commands keep working alongside RunQuest',()=>{
 const {doc}=play('/runquest','/demo','next','change value to 6');assert.equal(doc.cursor,'page2');assert(doc.echo().includes('count1 = Keyword("6"'));assert(!doc.echo().includes('rq_'));
 assert.equal(play('/runquest','Load wiring sample','next','back').doc.cursor,'page1');
 assert(mockTurn(req('Start your journey'),fixture).reply.includes('does not read your skill'));
 assert(mockTurn(req('continue'),fixture).reply.includes('does not read your skill'));
});
test('HTTP: full RunQuest journey through /api/turn in Mock',async()=>{
 const server=createApp(readConfig({},process.cwd()));await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 try{const {token}=await (await fetch(url+'/api/config')).json();const doc=new ScreenDocument();const messages=[];
  for(const text of ['Start RunQuest','Start your journey','Plan Ahead','Continue','Leave It for Another Time']){messages.push({role:'user',content:text});
   const response=await fetch(url+'/api/turn',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify({provider:'mock',consent:false,fault:'none',messages,state:{ui_state:doc.echo(),client_events:[]}})});
   assert.equal(response.status,200);const data=await response.json();assert.equal(data.versions.mode,'mock');doc.apply(data.turn.reply);messages.push({role:'assistant',content:data.turn.reply});}
  assert.equal(doc.cursor,'rq_s5');assert.equal(child(doc,'rq_s5_p1').props.text,RUNQUEST_ENDINGS['Plan Ahead']['Leave It for Another Time']);
 }finally{await new Promise(r=>server.close(r));}
});

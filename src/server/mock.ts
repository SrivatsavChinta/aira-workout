import { serializeStatement } from '../shared/openui/serialize.js';
import type { RequestData, Turn } from '../shared/contracts.js';
import { ScreenDocument } from '../shared/openui/document.js';
export function mockTurn(request: RequestData, fixture: string): Turn {
  const last=request.messages.at(-1)?.content.trim().toLowerCase() ?? '';
  const fence=(code:string)=>'```openui\n'+code+'\n```';
  if(last==='load wiring sample' || last==='/demo')return {reply:'Wiring fixture loaded. This is deterministic, not a model interpreting your skill.\n'+fence('root = Screens([])')+'\n'+fence(fixture)};
  const doc=new ScreenDocument();if(request.state.ui_state)doc.apply(fence(request.state.ui_state));
  const screens=doc.screens;const index=screens.findIndex(s=>s.key===doc.cursor);
  if(['next','back'].includes(last) && screens.length){const target=screens[Math.max(0,Math.min(screens.length-1,index+(last==='back'?-1:1)))];return {reply:'Fixture cursor moved.\n'+fence(`root = Screens([${screens.map(s=>s.key).join(', ')}], ${target.key})`)};}
  if(/^change value to (\d{1,2})$/.test(last) && doc.program.includes('count1 =')){const value=Number(last.match(/\d+/)![0]);return {reply:'Fixture values patched under their existing names.\n'+fence(serializeStatement('count1','Keyword',[String(value),'Sample value'])+'\n'+serializeStatement('count2','Keyword',[String(value),'Second sample value']))};}
  return {reply:'Mock only understands /demo, next, back and “change value to 6”. It does not read your skill. Edit the fixture/mock, test a local OpenUI patch in Builder tools, or explicitly enable a live provider.'};
}

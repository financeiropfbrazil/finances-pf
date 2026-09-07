// Chrome headless com perfil descartável isolado; somente servidor Vite local.
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import assert from 'node:assert/strict';
const profile=await mkdtemp(join(process.env.TEMP,'multicc-visual-'));
const chrome=spawn('C:/Program Files/Google/Chrome/Application/chrome.exe',['--headless=new','--no-first-run','--disable-background-networking','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true});
const wsUrl=await new Promise((resolve,reject)=>{let text=''; const timer=setTimeout(()=>reject(Error('Chrome indisponível')),15000);chrome.stderr.on('data',d=>{text+=d;const m=text.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});chrome.on('error',reject);});
const ws=new WebSocket(wsUrl);await new Promise(r=>ws.addEventListener('open',r,{once:true}));
let seq=0;const pending=new Map();ws.addEventListener('message',({data})=>{const m=JSON.parse(data);if(m.method==='Runtime.exceptionThrown')console.error('BROWSER',JSON.stringify(m.params.exceptionDetails));if(m.id){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(m.error.message)):p.resolve(m.result);}});
const call=(method,params={},sessionId)=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});
const out='docs/aprovacao-multicc/tests/visual';await mkdir(out,{recursive:true});const results=[];
try {
 for(const theme of ['light','dark']) {
  const {targetId}=await call('Target.createTarget',{url:'about:blank'});
  const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
  await call('Runtime.enable',{},sessionId);
  await call('Page.bringToFront',{},sessionId);
  await call('Page.navigate',{url:`http://127.0.0.1:5173/docs/aprovacao-multicc/tests/visual-unidades.html?theme=${theme}`},sessionId);
  await call('Emulation.setDeviceMetricsOverride',{width:1000,height:1300,deviceScaleFactor:1,mobile:false},sessionId);
  const evaluate=async expression=>{const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},sessionId);if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
  for(let i=0;i<150;i++){if(await evaluate(`document.querySelector('[data-testid="quantidades"]')?.textContent`))break;await new Promise(r=>setTimeout(r,150));}
  assert.equal(await evaluate(`document.querySelector('[data-testid="quantidades"]').textContent`),'10 → 1 | 20 → 2');
  assert.equal(await evaluate(`document.querySelector('[data-testid="drypatch-quantidades"]').textContent`),'10 → 10 | 20 → 20');
  assert.equal(await evaluate(`document.querySelector('[role="combobox"]').disabled`),false);
  assert.match(await evaluate(`document.querySelector('[role="combobox"]').textContent`),/UNID.*posição 1/);
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Tentar novamente').click()`);
  assert.equal(await evaluate(`document.querySelector('[data-testid="retry"]').textContent`),'Tentativas: 1');
  const colors=await evaluate(`Array.from(document.querySelectorAll('[role="alert"],[role="status"],[role="combobox"]')).filter(e=>!e.disabled).map(e=>{const s=getComputedStyle(e);return {role:e.getAttribute('role'),text:e.textContent,foreground:s.color,background:s.backgroundColor}})`);
  const screenshot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true},sessionId);
  await writeFile(`${out}/${theme}.png`,Buffer.from(screenshot.data,'base64'));
  // Abre o seletor real e captura a superfície do menu no tema corrente.
  await evaluate(`document.querySelector('[role="combobox"]').focus()`);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},sessionId);
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowDown',code:'ArrowDown',windowsVirtualKeyCode:40},sessionId);
  await new Promise(r=>setTimeout(r,400));
  const menu=await evaluate(`document.querySelector('[role="listbox"]')?.textContent`);assert.ok(menu?.includes('UNID'));
  const menuColors=await evaluate(`{const e=document.querySelector('[role="listbox"]'),s=getComputedStyle(e),r=e.getBoundingClientRect();({role:'listbox',foreground:s.color,background:s.backgroundColor,width:r.width,height:r.height,x:r.x,y:r.y,opacity:s.opacity,visibility:s.visibility,parent:e.parentElement.getAttribute('style')})}`);
  assert.ok(menuColors.width>0 && menuColors.height>0);colors.push(menuColors);
  await evaluate(`new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const opened=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false},sessionId);
  await writeFile(`${out}/${theme}-menu.png`,Buffer.from(opened.data,'base64'));
  const luminance=color=>color.match(/[\d.]+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=0.04045?n/12.92:((n+0.055)/1.055)**2.4).reduce((sum,n,i)=>sum+n*[0.2126,0.7152,0.0722][i],0);
  for(const c of colors){const a=luminance(c.foreground),b=luminance(c.background);c.contrast=(Math.max(a,b)+0.05)/(Math.min(a,b)+0.05);assert.ok(c.contrast>=4.5);}
  results.push({theme,quantidades:'10→1;20→2',drypatch:'UNID/1 habilitada; 10→10;20→20; captura do Laboratório, não HTTP real do formulário',retry:true,menu,colors});
  await call('Target.closeTarget',{targetId});
 }
 await writeFile(`${out}/resultados.json`,JSON.stringify(results,null,2));console.log(JSON.stringify(results));
} finally {await call('Browser.close').catch(()=>{});ws.close();chrome.kill();}

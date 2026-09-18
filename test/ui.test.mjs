import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('shell uses SVG controls and accessible dialog semantics',async()=>{
  const html=await read('docs/index.html');
  assert.match(html,/id="back"[^>]*><svg><use href="#i-back"/);
  assert.match(html,/id="previewBtn"[^>]*aria-pressed="false"/);
  assert.match(html,/id="save"[^>]*><svg><use href="#i-save"/);
  assert.match(html,/id="drawer"[^>]*role="dialog"[^>]*aria-modal="true"[^>]*aria-hidden="true"/);
  assert.match(html,/id="close"[^>]*><svg><use href="#i-close"/);
  assert.match(html,/id="blockLabel"/);
  assert.doesNotMatch(html,/[‹×]/)
});

test('toolbar keeps 44px targets and scrolls instead of compressing',async()=>{
  const css=await read('docs/app.css');
  assert.match(css,/\.bar\{[\s\S]*overflow-x:auto/);
  assert.match(css,/\.bar button,\.blockPick\{[\s\S]*min-width:44px/);
  assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/:root\[data-host="telegram"\] \.top\{display:none\}/)
});

test('editor UI reports formatting and block state',async()=>{
  const app=await read('docs/app.js');
  assert.match(app,/function syncEditorUi\(\)/);
  assert.match(app,/core\.hasFormat\(tag,r\)/);
  assert.match(app,/blockLabel/);
  assert.match(app,/aria-pressed/);
  assert.doesNotMatch(app,/textContent='✕'/)
});

test('drawer manages focus, inert state and escape',async()=>{
  const app=await read('docs/app.js');
  assert.match(app,/app\.inert=true/);
  assert.match(app,/app\.inert=false/);
  assert.match(app,/e\.key==='Escape'/);
  assert.match(app,/aria-hidden','false'/);
  assert.match(app,/aria-expanded','true'/)
});

test('menu actions receive currentColor SVG iconography',async()=>{
  const [app,css]=await Promise.all([read('docs/app.js'),read('docs/app.css')]);
  assert.match(app,/const menuIcons=/);
  assert.match(app,/class="menuIcon"/);
  assert.match(css,/\.grid \.menuIcon/);
  assert.match(css,/stroke:currentColor/)
});

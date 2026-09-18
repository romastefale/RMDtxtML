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

test('toolbar keeps exactly six compact primary controls above the keyboard',async()=>{
  const [html,css]=await Promise.all([read('docs/index.html'),read('docs/app.css')]);
  const toolbar=html.match(/<nav id="toolbar"[\s\S]*?<\/nav>/)?.[0]||'';
  const controls=(toolbar.match(/<button\b|<label class="blockPick"/g)||[]).length;
  assert.equal(controls,6);
  assert.match(css,/\.bar\{[\s\S]*grid-template-columns:repeat\(6,44px\)/);
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
  assert.match(app,/\$\$\('\[data-cmd\]'\)\.forEach/);
  assert.match(app,/\$\$\('\[data-action\]'\)\.forEach/);
  assert.doesNotMatch(app,/(?<!\$)\$\('\[data-cmd\]'\)\.forEach|(?<!\$)\$\('\[data-action\]'\)\.forEach/);
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


test('every declared drawer action has an implementation',async()=>{
  const [html,app]=await Promise.all([read('docs/index.html'),read('docs/app.js')]);
  const declared=[...html.matchAll(/data-action="([^"]+)"/g)].map(m=>m[1]);
  const body=app.slice(app.indexOf('const actions={'),app.indexOf("$$('[data-action]').forEach"));
  for(const action of declared)assert.match(body,new RegExp('(?:^|\\n\\s*)'+action+':'),`missing action: ${action}`)
});

test('document bar exposes persistent name, save state and edit-preview tabs',async()=>{
  const [html,css]=await Promise.all([read('docs/index.html'),read('docs/app.css')]);
  assert.match(html,/class="documentBar"/);assert.match(html,/id="docName"/);assert.match(html,/id="saveState"/);
  assert.match(html,/role="tablist"/);assert.match(html,/id="editTab"[^>]*role="tab"/);assert.match(html,/id="previewTab"[^>]*role="tab"/);
  assert.match(css,/\.documentBar\{/);assert.match(css,/:root\[data-view="preview"\] \.bar\{display:none\}/)
});

test('H1 H2 H3 remain distinct actions and orange is the application accent',async()=>{
  const [html,app,css]=await Promise.all([read('docs/index.html'),read('docs/app.js'),read('docs/app.css')]);
  for(const level of ['h1','h2','h3']){assert.match(html,new RegExp('data-action="'+level+'"'));assert.match(app,new RegExp(level+':\\(\\)=>core\\.block\\(\''+level+'\'\\)'))}
  assert.match(css,/--app-accent:#ff7a00/);assert.match(css,/--accent:var\(--app-accent\)/)
});

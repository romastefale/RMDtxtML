import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('browser scripts compile and semantic editor bundle loads before application',async()=>{
  const [index,platform,bundle,app,transfer]=await Promise.all([
    read('docs/index.html'),read('docs/platform.js'),read('docs/editor.js'),read('docs/app.js'),read('docs/transfer.js')
  ]);
  assert.doesNotThrow(()=>new Function(platform));assert.doesNotThrow(()=>new Function(bundle));
  assert.doesNotThrow(()=>new Function(app));assert.doesNotThrow(()=>new Function(transfer));
  assert.ok(index.indexOf('./platform.js')<index.indexOf('./editor.js'));
  assert.ok(index.indexOf('./editor.js')<index.indexOf('./document.js'));
  assert.ok(index.indexOf('./document.js')<index.indexOf('./app.js'));
});

test('editor source uses ProseMirror schema state view transactions and history',async()=>{
  const source=await read('client/editor.mjs');
  for(const pkg of ['prosemirror-model','prosemirror-state','prosemirror-view','prosemirror-history','prosemirror-keymap','prosemirror-commands','prosemirror-schema-list','prosemirror-gapcursor'])
    assert.ok(source.includes("from '"+pkg+"'"),pkg);
  assert.match(source,/new Schema\(\{nodes,marks\}\)/);
  assert.match(source,/EditorState\.create/);assert.match(source,/dispatchTransaction/);
  assert.match(source,/history\(\)/);assert.match(source,/gapCursor\(\)/);
  assert.doesNotMatch(source,/this\.past=\[\]|this\.future=\[\]|pathMark\(|restoreText\(/);
});

test('semantic schema represents structural and inline Rich Message concepts',async()=>{
  const source=await read('client/editor.mjs');
  for(const node of ['paragraph','heading','footer','blockquote','pullquote','code_block','divider','bullet_list','ordered_list','list_item','math_block','image','video','audio','document','map','collage','slideshow','details','table','button_row'])
    assert.ok(source.includes(node+':'),node);
  for(const mark of ['strong','em','underline','strike','code','marked','spoiler','sub','sup','link','reference'])
    assert.ok(source.includes(mark+':'),mark);
});

test('application persists semantic model rather than editor HTML',async()=>{
  const app=await read('docs/app.js'),document=await read('docs/document.js');
  assert.match(app,/doc\.content\.model=core\.model\(\)/);
  assert.match(app,/core\.html\(\)/);assert.match(app,/core\.setModel\(doc\.content\.model/);
  assert.doesNotMatch(app,/doc\.content\.html/);
  assert.match(document,/SCHEMA=2/);assert.match(document,/format:'semantic'/);
  assert.doesNotMatch(document,/content:\{html/);
});

test('editor no longer uses execCommand or custom DOM undo stack',async()=>{
  const [source,app]=await Promise.all([read('client/editor.mjs'),read('docs/app.js')]);
  assert.doesNotMatch(source+'\n'+app,/execCommand|document\.execCommand/);
  assert.doesNotMatch(source,/past\.push|future\.push|cloneRange\(\)/);
});

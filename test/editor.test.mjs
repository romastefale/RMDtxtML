import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('browser scripts compile and editor core loads first',async()=>{
  const [index,platform,editor,app,transfer]=await Promise.all([read('docs/index.html'),read('docs/platform.js'),read('docs/editor.js'),read('docs/app.js'),read('docs/transfer.js')]);
  assert.doesNotThrow(()=>new Function(platform));
  assert.doesNotThrow(()=>new Function(editor));
  assert.doesNotThrow(()=>new Function(app));
  assert.doesNotThrow(()=>new Function(transfer));
  assert.ok(index.indexOf('./platform.js')<index.indexOf('./editor.js'));
  assert.ok(index.indexOf('./editor.js')<index.indexOf('./app.js'));
  assert.ok(index.indexOf('./app.js')<index.indexOf('./transfer.js'));
});

test('editor architecture has no legacy command or backend constants',async()=>{
  const [app,transfer]=await Promise.all([read('docs/app.js'),read('docs/transfer.js')]);
  const code=app+'\n'+transfer;
  assert.doesNotMatch(code,/document\.execCommand|APIKEY|DEFAULT_API|MAX_BYTES|m\.bytes|window\.Telegram\?\.WebApp|rmdtxtml\.up\.railway\.app/);
  assert.match(app,/new RMD\.Editor\(ed/);
  assert.match(transfer,/core\.setHtml\(/);
});

test('editor owns history and structural commands',async()=>{
  const editor=await read('docs/editor.js');
  assert.match(editor,/undo\(\)/);
  assert.match(editor,/redo\(\)/);
  assert.match(editor,/format\(tag,attrs=/);
  assert.match(editor,/block\(tag\)/);
  assert.match(editor,/list\(tag\)/);
  assert.match(editor,/pathMark\(/);
});

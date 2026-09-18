import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function runtime(){
  const source=await readFile(new URL('../docs/document.js',import.meta.url),'utf8');
  const map=new Map();
  const localStorage={
    getItem:k=>map.has(k)?map.get(k):null,
    setItem:(k,v)=>map.set(k,String(v)),
    removeItem:k=>map.delete(k)
  };
  const window={};
  const crypto={randomUUID:()=> '00000000-0000-4000-8000-000000000001'};
  const RMD=new Function('window','crypto','localStorage',source+';return window.RMD')(window,crypto,localStorage);
  return{RMD,map,localStorage}
}

test('document format is canonical and round-trips',async()=>{
  const{RMD}=await runtime();
  const doc=RMD.normalizeDocument({content:{html:'<p>Oi</p>'},options:{isRtl:true}});
  assert.equal(doc.schema,1);
  assert.equal(doc.format,'rich_html');
  assert.equal(doc.content.html,'<p>Oi</p>');
  assert.equal(doc.options.isRtl,true);
  const restored=RMD.importDocument(RMD.exportDocument(doc));
  assert.deepEqual(restored.content,doc.content);
  assert.deepEqual(restored.options,doc.options)
});

test('document store migrates legacy draft and keeps bounded checkpoints',async()=>{
  const{RMD,localStorage}=await runtime();
  localStorage.setItem('rmdtxtml-draft-v2',JSON.stringify({html:'<p>Legado</p>',rtl:true,skipEntityDetection:true}));
  const store=new RMD.DocumentStore();
  const loaded=await store.load();
  assert.equal(loaded.migrated,true);
  assert.equal(loaded.mode,'local');
  assert.equal(loaded.doc.content.html,'<p>Legado</p>');
  assert.equal(loaded.doc.options.isRtl,true);
  assert.equal(localStorage.getItem('rmdtxtml-draft-v2'),null);
  let doc=loaded.doc;
  for(let i=0;i<35;i++){doc.content.html='<p>'+i+'</p>';doc=await store.save(doc,{checkpoint:true})}
  assert.equal(doc.revisions.length,30);
  assert.equal(doc.meta.revision,35)
});

test('document restore creates a new revision from a checkpoint',async()=>{
  const{RMD}=await runtime();
  const store=new RMD.DocumentStore();
  let doc=(await store.load({initialHtml:'<p>A</p>'})).doc;
  doc=await store.save(doc,{checkpoint:true});
  const rev=doc.meta.revision;
  doc.content.html='<p>B</p>';
  doc=await store.save(doc,{checkpoint:true});
  const restored=await store.restore(doc,rev);
  assert.equal(restored.content.html,'<p>A</p>');
  assert.equal(restored.meta.revision,3)
});

test('application persists through DocumentStore, not the legacy draft key',async()=>{
  const [index,app,transfer]=await Promise.all([
    readFile(new URL('../docs/index.html',import.meta.url),'utf8'),
    readFile(new URL('../docs/app.js',import.meta.url),'utf8'),
    readFile(new URL('../docs/transfer.js',import.meta.url),'utf8')
  ]);
  assert.ok(index.indexOf('./document.js')<index.indexOf('./app.js'));
  assert.doesNotMatch(app+'\n'+transfer,/localStorage\.setItem\(KEY|rmdtxtml-draft-v2/);
  assert.match(app,/new RMD\.DocumentStore\(\)/);
  assert.match(app,/persistDocument/);
  assert.match(transfer,/await RMD\.ready/)
});

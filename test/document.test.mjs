import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const EMPTY={type:'doc',content:[{type:'paragraph'}]};
const model=text=>({type:'doc',content:[{type:'paragraph',content:text?[{type:'text',text}]:undefined}].map(x=>x.content?x:{type:'paragraph'})});
const migrateHtml=html=>model(String(html).replace(/<[^>]+>/g,'').trim());
const normalizeModel=value=>JSON.parse(JSON.stringify(value||EMPTY));

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

test('document format is semantic schema 2 and round-trips',async()=>{
  const{RMD}=await runtime();
  const doc=RMD.normalizeDocument({schema:2,format:'semantic',content:{model:model('Oi'),modelVersion:2},options:{isRtl:true}},{normalizeModel,migrateHtml});
  assert.equal(doc.schema,2);assert.equal(doc.format,'semantic');
  assert.deepEqual(doc.content.model,model('Oi'));assert.equal(doc.content.modelVersion,2);assert.equal(RMD.DOCUMENT_MODEL_VERSION,2);assert.equal(doc.options.isRtl,true);
  assert.equal('html' in doc.content,false);
  const restored=RMD.importDocument(RMD.exportDocument(doc),{normalizeModel,migrateHtml});
  assert.deepEqual(restored.content,doc.content);assert.deepEqual(restored.options,doc.options)
});

test('schema 1 rich_html migrates once into semantic model',async()=>{
  const{RMD,localStorage}=await runtime();
  localStorage.setItem('rmdtxtml-document-v1',JSON.stringify({
    schema:1,format:'rich_html',content:{html:'<p>Legado</p>'},options:{isRtl:true},
    meta:{revision:2},revisions:[{revision:1,at:'2026-01-01T00:00:00.000Z',html:'<p>Anterior</p>',options:{}}]
  }));
  const store=new RMD.DocumentStore(),loaded=await store.load({normalizeModel,migrateHtml});
  assert.equal(loaded.migrated,true);assert.equal(loaded.doc.schema,2);assert.equal(loaded.doc.format,'semantic');
  assert.deepEqual(loaded.doc.content.model,model('Legado'));assert.equal(loaded.doc.content.modelVersion,2);
  assert.equal(loaded.doc.migration.fromSchema,1);assert.equal(loaded.doc.migration.original.content.html,'<p>Legado</p>');
  assert.deepEqual(loaded.doc.revisions[0].model,model('Anterior'));
  assert.equal(localStorage.getItem('rmdtxtml-document-v1'),null);
  assert.ok(localStorage.getItem('rmdtxtml-document-v2'))
});

test('legacy draft migrates and checkpoints keep bounded semantic snapshots',async()=>{
  const{RMD,localStorage}=await runtime();
  localStorage.setItem('rmdtxtml-draft-v2',JSON.stringify({html:'<p>Legado</p>',rtl:true,skipEntityDetection:true}));
  const store=new RMD.DocumentStore(),loaded=await store.load({normalizeModel,migrateHtml});
  assert.equal(loaded.migrated,true);assert.equal(loaded.mode,'local');
  assert.deepEqual(loaded.doc.content.model,model('Legado'));assert.equal(loaded.doc.options.isRtl,true);
  assert.equal(localStorage.getItem('rmdtxtml-draft-v2'),null);
  let doc=loaded.doc;
  for(let i=0;i<35;i++){doc.content.model=model(String(i));doc=await store.save(doc,{checkpoint:true,normalizeModel,migrateHtml})}
  assert.equal(doc.revisions.length,30);assert.equal(doc.meta.revision,35);
  assert.equal('html' in doc.revisions.at(-1),false);assert.equal(doc.revisions.at(-1).modelVersion,2)
});

test('document restore creates a new revision from a semantic checkpoint',async()=>{
  const{RMD}=await runtime();const store=new RMD.DocumentStore();
  let doc=(await store.load({initialModel:model('A'),normalizeModel,migrateHtml})).doc;
  doc=await store.save(doc,{checkpoint:true,normalizeModel,migrateHtml});const rev=doc.meta.revision;
  doc.content.model=model('B');doc=await store.save(doc,{checkpoint:true,normalizeModel,migrateHtml});
  const restored=await store.restore(doc,rev,{normalizeModel,migrateHtml});
  assert.deepEqual(restored.content.model,model('A'));assert.equal(restored.meta.revision,3)
});

test('transfer adoption preserves identity while converting HTML to semantic model',async()=>{
  const{RMD}=await runtime();
  const current=RMD.normalizeDocument({schema:2,format:'semantic',id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',content:{model:model('Local'),modelVersion:2},meta:{revision:2}},{normalizeModel,migrateHtml});
  const semantic=model('Semântico');
  const adopted=RMD.adoptTransferDocument(current,{html:'<h2>HTML descartável</h2>',semantic:{schema:2,format:'semantic',modelVersion:2,model:semantic},isRtl:true,document:{id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',revision:7}},{normalizeModel,migrateHtml});
  assert.equal(adopted.id,'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');assert.equal(adopted.meta.revision,7);
  assert.deepEqual(adopted.content.model,semantic);assert.equal(adopted.options.isRtl,true);assert.deepEqual(adopted.revisions,[])
});

test('malformed semantic document fails closed without overwriting stored source',async()=>{
  const{RMD,localStorage}=await runtime();
  const raw=JSON.stringify({schema:2,format:'semantic',content:{},meta:{revision:4}});
  localStorage.setItem('rmdtxtml-document-v2',raw);
  const store=new RMD.DocumentStore();
  await assert.rejects(()=>store.load({normalizeModel,migrateHtml}),/invalid_document_model/);
  assert.equal(localStorage.getItem('rmdtxtml-document-v2'),raw)
});

test('unsupported semantic model version is rejected before adoption',async()=>{
  const{RMD}=await runtime();
  const current=RMD.normalizeDocument({schema:2,format:'semantic',content:{model:model('Local'),modelVersion:2}},{normalizeModel,migrateHtml});
  assert.throws(()=>RMD.adoptTransferDocument(current,{
    html:'<p>fallback</p>',
    semantic:{schema:2,format:'semantic',modelVersion:3,model:model('Novo')}
  },{normalizeModel,migrateHtml,migrateModel:()=>{throw new Error('unsupported_model_version')}}),/unsupported_model_version/)
});

test('application exposes an explicit transfer boundary instead of sharing lexical editor state',async()=>{
  const [index,app,transfer]=await Promise.all([
    readFile(new URL('../docs/index.html',import.meta.url),'utf8'),
    readFile(new URL('../docs/app.js',import.meta.url),'utf8'),
    readFile(new URL('../docs/transfer.js',import.meta.url),'utf8')
  ]);
  assert.ok(index.indexOf('./platform.js')<index.indexOf('./editor.js'));assert.ok(index.indexOf('./document.js')<index.indexOf('./app.js'));
  assert.doesNotMatch(app+'\n'+transfer,/rmdtxtml-draft-v2|content\.html/);
  assert.match(app,/RMD\.application=application/);
  assert.match(transfer,/RMD\.application/);
  assert.doesNotMatch(transfer,/\bcore\.|\bstore\.|\bsyncDoc\(|\bpersistDocument\(/)
});

test('schema 2 model version 1 migrates explicitly to model version 2',async()=>{
  const{RMD}=await runtime();
  const legacy={type:'doc',content:[{type:'details',attrs:{summary:'Resumo',body:'Corpo',open:false}}]};
  const migrated=RMD.normalizeDocument({schema:2,format:'semantic',content:{model:legacy,modelVersion:1}},{
    normalizeModel,migrateHtml,migrateModel:(value,version)=>{assert.equal(version,1);return model('migrado')}
  });
  assert.equal(migrated.content.modelVersion,2);assert.deepEqual(migrated.content.model,model('migrado'))
});

test('loading model version 1 persists the migrated model version 2 exactly once',async()=>{
  const{RMD,localStorage}=await runtime();
  localStorage.setItem('rmdtxtml-document-v2',JSON.stringify({schema:2,format:'semantic',content:{model:model('v1'),modelVersion:1},meta:{revision:0},revisions:[]}));
  const store=new RMD.DocumentStore();
  const loaded=await store.load({normalizeModel,migrateHtml,migrateModel:(value,version)=>{assert.equal(version,1);return model('v2')}});
  assert.equal(loaded.migrated,true);assert.equal(loaded.doc.content.modelVersion,2);assert.deepEqual(loaded.doc.content.model,model('v2'));
  const persisted=JSON.parse(localStorage.getItem('rmdtxtml-document-v2'));
  assert.equal(persisted.content.modelVersion,2);assert.deepEqual(persisted.content.model,model('v2'))
});

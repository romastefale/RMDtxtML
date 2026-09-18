(()=>{'use strict';
const DB='rmdtxtml',STORE='docs',KEY='current',SCHEMA=2,MAX_REVISIONS=30;
const EMPTY={type:'doc',content:[{type:'paragraph'}]};
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID?.()||('doc-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10));
const clone=x=>JSON.parse(JSON.stringify(x));
const defaultNormalize=x=>clone(x&&typeof x==='object'?x:EMPTY);
function base(model=EMPTY){
  const time=now();
  return{schema:SCHEMA,id:uid(),format:'semantic',content:{model:clone(model)},options:{isRtl:false,skipEntityDetection:false},meta:{createdAt:time,updatedAt:time,revision:0},revisions:[]};
}
function legacyHtml(src){
  if(typeof src?.content?.html==='string')return src.content.html;
  if(typeof src?.html==='string')return src.html;
  return null
}
function normalize(input,{normalizeModel=defaultNormalize,migrateHtml}={}){
  const src=input&&typeof input==='object'?input:{};
  const legacy=legacyHtml(src);
  let model=src?.schema===SCHEMA&&src?.format==='semantic'&&src?.content?.model
    ?normalizeModel(src.content.model)
    :legacy!==null&&typeof migrateHtml==='function'
      ?normalizeModel(migrateHtml(legacy))
      :normalizeModel(EMPTY);
  const doc=base(model);
  doc.id=typeof src.id==='string'&&src.id?src.id:doc.id;
  doc.options.isRtl=src.options?.isRtl===true||src.rtl===true;
  doc.options.skipEntityDetection=src.options?.skipEntityDetection===true||src.skipEntityDetection===true;
  const created=src.meta?.createdAt;doc.meta.createdAt=typeof created==='string'&&created?created:doc.meta.createdAt;
  const rev=Number(src.meta?.revision);doc.meta.revision=Number.isSafeInteger(rev)&&rev>=0?rev:0;
  if(Array.isArray(src.revisions))doc.revisions=src.revisions.slice(-MAX_REVISIONS).map(r=>{
    const oldHtml=typeof r?.html==='string'?r.html:null;
    const revisionModel=r?.model?normalizeModel(r.model):oldHtml!==null&&typeof migrateHtml==='function'?normalizeModel(migrateHtml(oldHtml)):normalizeModel(EMPTY);
    return{
      revision:Number.isSafeInteger(Number(r.revision))?Number(r.revision):0,
      at:typeof r.at==='string'?r.at:now(),
      model:revisionModel,
      options:{isRtl:r.options?.isRtl===true,skipEntityDetection:r.options?.skipEntityDetection===true}
    }
  });
  doc.meta.updatedAt=typeof src.meta?.updatedAt==='string'?src.meta.updatedAt:now();
  return doc
}
function snapshot(doc){return{revision:doc.meta.revision,at:now(),model:clone(doc.content.model),options:clone(doc.options)}}
class Store{
  constructor({legacyKey='rmdtxtml-draft-v2',fallbackKey='rmdtxtml-document-v2',previousKey='rmdtxtml-document-v1'}={}){
    this.legacyKey=legacyKey;this.fallbackKey=fallbackKey;this.previousKey=previousKey;this.db=null;this.mode='pending'
  }
  async open(){
    if(this.db||this.mode==='local')return this.db;
    if(!('indexedDB'in window)){this.mode='local';return null}
    try{
      this.db=await new Promise((resolve,reject)=>{
        const req=indexedDB.open(DB,1);
        req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(STORE))db.createObjectStore(STORE)};
        req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)
      });
      this.db.onversionchange=()=>{this.db?.close();this.db=null};this.mode='idb';return this.db
    }catch{this.mode='local';return null}
  }
  async get(){
    const db=await this.open();
    if(!db){
      for(const key of [this.fallbackKey,this.previousKey]){try{const raw=localStorage.getItem(key);if(raw)return JSON.parse(raw)}catch{}}
      return null
    }
    return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})
  }
  async put(doc){
    const value=clone(doc),db=await this.open();
    if(!db){localStorage.setItem(this.fallbackKey,JSON.stringify(value));try{localStorage.removeItem(this.previousKey)}catch{}return value}
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
    return value
  }
  legacy(){
    for(const key of [this.legacyKey,this.previousKey]){try{const raw=localStorage.getItem(key);if(raw)return JSON.parse(raw)}catch{}}
    return null
  }
  clearLegacy(){for(const key of [this.legacyKey,this.previousKey])try{localStorage.removeItem(key)}catch{}}
  async load({initialModel=EMPTY,normalizeModel,migrateHtml}={}){
    let raw=await this.get(),migrated=false;
    if(!raw){const old=this.legacy();if(old){raw=old;migrated=true}}
    if(raw&&(raw.schema!==SCHEMA||raw.format!=='semantic'))migrated=true;
    const doc=normalize(raw||{schema:SCHEMA,format:'semantic',content:{model:initialModel}},{normalizeModel,migrateHtml});
    if(migrated){await this.put(doc);this.clearLegacy()}
    return{doc,migrated,mode:this.mode}
  }
  async save(doc,{checkpoint=false,normalizeModel,migrateHtml}={}){
    const next=normalize(doc,{normalizeModel,migrateHtml});
    if(checkpoint){next.meta.revision+=1;next.revisions=[...next.revisions,snapshot(next)].slice(-MAX_REVISIONS)}
    next.meta.updatedAt=now();await this.put(next);return next
  }
  async restore(doc,revision,{normalizeModel,migrateHtml}={}){
    const next=normalize(doc,{normalizeModel,migrateHtml}),target=[...next.revisions].reverse().find(r=>r.revision===revision);
    if(!target)throw new Error('revision_not_found');
    next.content.model=clone(target.model);next.options=clone(target.options);next.meta.revision+=1;next.meta.updatedAt=now();
    next.revisions=[...next.revisions,snapshot(next)].slice(-MAX_REVISIONS);await this.put(next);return next
  }
  async reset({model=EMPTY,normalizeModel}={}){
    const doc=normalize({schema:SCHEMA,format:'semantic',content:{model}},{normalizeModel});await this.put(doc);this.clearLegacy();return doc
  }
}
function adoptTransfer(current,transfer,{normalizeModel,migrateHtml}={}){
  const meta=transfer?.document&&typeof transfer.document==='object'?transfer.document:{};
  const id=typeof meta.id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(meta.id)?meta.id:null;
  const same=!!id&&current?.id===id;
  const model=typeof migrateHtml==='function'?migrateHtml(transfer?.html||'<p></p>'):EMPTY;
  const next=normalize(same?current:{id:id||undefined,schema:SCHEMA,format:'semantic',content:{model},meta:{revision:0},revisions:[]},{normalizeModel,migrateHtml});
  next.content.model=normalizeModel?normalizeModel(model):clone(model);
  next.options.isRtl=transfer?.isRtl===true;next.options.skipEntityDetection=transfer?.skipEntityDetection===true;
  const revision=Number(meta.revision);if(!same&&Number.isSafeInteger(revision)&&revision>=0)next.meta.revision=revision;
  return next
}
function exportDocument(doc){const data=clone(doc);data.schema=SCHEMA;data.format='semantic';return JSON.stringify(data,null,2)}
function importDocument(text,{normalizeModel,migrateHtml}={}){
  const raw=JSON.parse(String(text));if(!raw||typeof raw!=='object')throw new Error('invalid_document');
  if(raw.schema!==1&&raw.schema!==SCHEMA)throw new Error('unsupported_schema');
  if(raw.schema===SCHEMA&&raw.format!=='semantic')throw new Error('unsupported_format');
  if(raw.schema===1&&raw.format!=='rich_html')throw new Error('unsupported_format');
  return normalize(raw,{normalizeModel,migrateHtml})
}
window.RMD=window.RMD||{};
Object.assign(window.RMD,{DocumentStore:Store,normalizeDocument:normalize,adoptTransferDocument:adoptTransfer,exportDocument,importDocument,DOCUMENT_SCHEMA:SCHEMA,EMPTY_DOCUMENT_MODEL:EMPTY});
})();
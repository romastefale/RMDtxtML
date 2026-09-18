(()=>{'use strict';
const DB='rmdtxtml',STORE='docs',KEY='current',SCHEMA=1,MAX_REVISIONS=30;
const now=()=>new Date().toISOString();
const uid=()=>crypto.randomUUID?.()||('doc-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10));
const clone=x=>JSON.parse(JSON.stringify(x));
function base(html='<p><br></p>'){
  const time=now();
  return{schema:SCHEMA,id:uid(),format:'rich_html',content:{html},options:{isRtl:false,skipEntityDetection:false},meta:{createdAt:time,updatedAt:time,revision:0},revisions:[]};
}
function normalize(input,{sanitize=x=>String(x??'').trim()}={}){
  const src=input&&typeof input==='object'?input:{};
  const doc=base();
  doc.id=typeof src.id==='string'&&src.id?src.id:doc.id;
  doc.content.html=sanitize(src.content?.html??src.html??doc.content.html)||'<p><br></p>';
  doc.options.isRtl=src.options?.isRtl===true||src.rtl===true;
  doc.options.skipEntityDetection=src.options?.skipEntityDetection===true||src.skipEntityDetection===true;
  const created=src.meta?.createdAt;doc.meta.createdAt=typeof created==='string'&&created?created:doc.meta.createdAt;
  const rev=Number(src.meta?.revision);doc.meta.revision=Number.isSafeInteger(rev)&&rev>=0?rev:0;
  if(Array.isArray(src.revisions))doc.revisions=src.revisions.slice(-MAX_REVISIONS).map(r=>({
    revision:Number.isSafeInteger(Number(r.revision))?Number(r.revision):0,
    at:typeof r.at==='string'?r.at:now(),
    html:sanitize(r.html)||'<p><br></p>',
    options:{isRtl:r.options?.isRtl===true,skipEntityDetection:r.options?.skipEntityDetection===true}
  }));
  doc.meta.updatedAt=typeof src.meta?.updatedAt==='string'?src.meta.updatedAt:now();
  return doc;
}
function snapshot(doc){
  return{revision:doc.meta.revision,at:now(),html:doc.content.html,options:clone(doc.options)};
}
class Store{
  constructor({legacyKey='rmdtxtml-draft-v2',fallbackKey='rmdtxtml-document-v1'}={}){
    this.legacyKey=legacyKey;this.fallbackKey=fallbackKey;this.db=null;this.mode='pending';
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
      this.db.onversionchange=()=>{this.db?.close();this.db=null};
      this.mode='idb';return this.db
    }catch{this.mode='local';return null}
  }
  async get(){
    const db=await this.open();
    if(!db){try{return JSON.parse(localStorage.getItem(this.fallbackKey)||'null')}catch{return null}}
    return await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readonly'),req=tx.objectStore(STORE).get(KEY);req.onsuccess=()=>resolve(req.result||null);req.onerror=()=>reject(req.error)})
  }
  async put(doc){
    const value=clone(doc),db=await this.open();
    if(!db){localStorage.setItem(this.fallbackKey,JSON.stringify(value));return value}
    await new Promise((resolve,reject)=>{const tx=db.transaction(STORE,'readwrite');tx.objectStore(STORE).put(value,KEY);tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error)});
    return value
  }
  legacy(){
    try{const raw=localStorage.getItem(this.legacyKey);return raw?JSON.parse(raw):null}catch{return null}
  }
  clearLegacy(){try{localStorage.removeItem(this.legacyKey)}catch{}}
  async load({initialHtml='<p><br></p>',sanitize}={}){
    let raw=await this.get(),migrated=false;
    if(!raw){const old=this.legacy();if(old){raw=old;migrated=true}}
    const doc=normalize(raw||{content:{html:initialHtml}},{sanitize});
    if(migrated){await this.put(doc);this.clearLegacy()}
    return{doc,migrated,mode:this.mode}
  }
  async save(doc,{checkpoint=false,sanitize}={}){
    const next=normalize(doc,{sanitize});
    if(checkpoint){
      next.meta.revision+=1;
      next.revisions=[...next.revisions,snapshot(next)].slice(-MAX_REVISIONS)
    }
    next.meta.updatedAt=now();
    await this.put(next);return next
  }
  async reset({html='<p><br></p>',sanitize}={}){
    const doc=normalize({content:{html}},{sanitize});await this.put(doc);this.clearLegacy();return doc
  }
}
function exportDocument(doc){
  const data=clone(doc);data.schema=SCHEMA;
  return JSON.stringify(data,null,2)
}
function importDocument(text,{sanitize}={}){
  const raw=JSON.parse(String(text));if(!raw||typeof raw!=='object')throw new Error('invalid_document');
  if(raw.schema!==SCHEMA)throw new Error('unsupported_schema');
  if(raw.format!=='rich_html')throw new Error('unsupported_format');
  return normalize(raw,{sanitize})
}
window.RMD=window.RMD||{};
Object.assign(window.RMD,{DocumentStore:Store,normalizeDocument:normalize,exportDocument,importDocument,DOCUMENT_SCHEMA:SCHEMA});
})();
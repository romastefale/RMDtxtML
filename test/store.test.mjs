import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Store} from '../src/store.mjs';

test('SQLite store claims a transfer exactly once',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    const semantic={schema:2,format:'semantic',model:{type:'doc',content:[{type:'paragraph'}]}};
    store.createTransfer({token:'a'.repeat(32),html:'<p>x</p>',semantic,expiresAt:Date.now()+60_000});
    const first=store.claimTransfer('a'.repeat(32));
    const second=store.claimTransfer('a'.repeat(32));
    assert.equal(first.html,'<p>x</p>');assert.deepEqual(first.semantic,semantic);
    assert.equal(second,null)
  }finally{store.close()}
});

test('SQLite survives Store reopen on disk',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'rmdtxtml-')),dbPath=path.join(dir,'state.sqlite'),token='b'.repeat(32);
  try{
    const first=new Store({env:{},dbPath});
    first.createTransfer({token,html:'<p>persistido</p>',document:{id:'doc_12345678',revision:4},expiresAt:Date.now()+60_000});
    const now=Date.now();
    first.beginSend('42','request-send-persist',{now});
    first.markUncertain('42','request-send-persist',{now:now+100});
    first.close();

    const second=new Store({env:{},dbPath});
    try{
      assert.equal(second.claimTransfer(token).html,'<p>persistido</p>');
      const state=second.sendState('42','request-send-persist');
      assert.equal(state.state,'uncertain');
      assert.equal(state.updatedAt,now+100)
    }finally{second.close()}
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('SQLite transfer table migrates semantic_json without data loss',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'rmdtxtml-migrate-')),dbPath=path.join(dir,'state.sqlite');
  try{
    const legacy=new DatabaseSync(dbPath);
    legacy.exec(`
      CREATE TABLE transfers(
        token TEXT PRIMARY KEY,
        html TEXT NOT NULL,
        is_rtl INTEGER NOT NULL DEFAULT 0,
        skip_entities INTEGER NOT NULL DEFAULT 0,
        document_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE TABLE rates(bucket TEXT PRIMARY KEY,count INTEGER NOT NULL,resets_at INTEGER NOT NULL);
      CREATE TABLE sends(user_id TEXT NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,response_json TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,request_id));
    `);
    legacy.close();
    const store=new Store({env:{},dbPath});
    try{
      const columns=store.db.prepare('PRAGMA table_info(transfers)').all().map(x=>x.name);
      assert.ok(columns.includes('semantic_json'));
      const semantic={schema:2,format:'semantic',model:{type:'doc',content:[{type:'paragraph'}]}};
      store.createTransfer({token:'c'.repeat(32),html:'<p>x</p>',semantic,expiresAt:Date.now()+60_000});
      assert.deepEqual(store.claimTransfer('c'.repeat(32)).semantic,semantic)
    }finally{store.close()}
  }finally{rmSync(dir,{recursive:true,force:true})}
});

test('SQLite rate window increments and resets',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    const a=store.rate('ip',{limit:2,windowMs:1000,now:1000});
    const b=store.rate('ip',{limit:2,windowMs:1000,now:1500});
    const c=store.rate('ip',{limit:2,windowMs:1000,now:1600});
    const d=store.rate('ip',{limit:2,windowMs:1000,now:2101});
    assert.equal(a.ok,true);assert.equal(b.ok,true);assert.equal(c.ok,false);assert.equal(d.ok,true);assert.equal(d.count,1)
  }finally{store.close()}
});

test('send idempotency persists terminal result',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    assert.equal(store.beginSend('42','request-send-0001',{now:1000}),true);
    assert.equal(store.beginSend('42','request-send-0001',{now:1001}),false);
    assert.equal(store.sendState('42','request-send-0001').state,'pending');
    store.completeSend('42','request-send-0001',{message_id:7},{now:1100});
    const state=store.sendState('42','request-send-0001');
    assert.equal(state.state,'done');assert.deepEqual(state.response,{message_id:7})
  }finally{store.close()}
});

test('uncertain send remains blocked',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    store.beginSend('42','request-send-uncertain',{now:1000});
    store.markUncertain('42','request-send-uncertain',{now:1100});
    assert.equal(store.sendState('42','request-send-uncertain').state,'uncertain');
    assert.equal(store.beginSend('42','request-send-uncertain',{now:1200}),false)
  }finally{store.close()}
});

test('confirmed failure can release a send id',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    store.beginSend('42','request-send-0002');
    store.releaseSend('42','request-send-0002');
    assert.equal(store.sendState('42','request-send-0002'),null);
    assert.equal(store.beginSend('42','request-send-0002'),true)
  }finally{store.close()}
});


test('stale pending send becomes uncertain and old send records are pruned',()=>{
  const store=new Store({env:{},dbPath:':memory:'});
  try{
    store.beginSend('42','request-send-stale',{now:1000});
    store.prune(1000+5*60_000+1);
    assert.equal(store.sendState('42','request-send-stale').state,'uncertain');
    store.prune(1000+8*86400_000);
    assert.equal(store.sendState('42','request-send-stale'),null)
  }finally{store.close()}
});

import path from 'node:path';
import {mkdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';

const clean=x=>String(x??'').trim();
const json=x=>JSON.stringify(x);
const parse=x=>{try{return JSON.parse(x)}catch{return null}};

export class Store{
  constructor({env=process.env,dbPath}={}){
    const mount=clean(env.RAILWAY_VOLUME_MOUNT_PATH);
    this.persistent=Boolean(mount)&&!dbPath;
    this.dir=mount||path.resolve('data');
    this.path=dbPath||path.join(this.dir,'rmdtxtml.sqlite');
    if(this.path!==':memory:')mkdirSync(path.dirname(this.path),{recursive:true});
    this.db=new DatabaseSync(this.path,{timeout:5000});
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS transfers(
        token TEXT PRIMARY KEY,
        html TEXT NOT NULL,
        is_rtl INTEGER NOT NULL DEFAULT 0,
        skip_entities INTEGER NOT NULL DEFAULT 0,
        document_json TEXT,
        semantic_json TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        claimed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS transfers_expiry ON transfers(expires_at);
      CREATE TABLE IF NOT EXISTS rates(
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        resets_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS rates_expiry ON rates(resets_at);
      CREATE TABLE IF NOT EXISTS sends(
        user_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        state TEXT NOT NULL,
        response_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id,request_id)
      );
      CREATE INDEX IF NOT EXISTS sends_created ON sends(created_at);
    `);
    const transferColumns=new Set(this.db.prepare('PRAGMA table_info(transfers)').all().map(row=>String(row.name)));
    if(!transferColumns.has('semantic_json'))this.db.exec('ALTER TABLE transfers ADD COLUMN semantic_json TEXT');
    this.q={
      addTransfer:this.db.prepare('INSERT INTO transfers(token,html,is_rtl,skip_entities,document_json,semantic_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)'),
      getTransfer:this.db.prepare('SELECT token,html,is_rtl,skip_entities,document_json,semantic_json,created_at,expires_at,claimed_at FROM transfers WHERE token=?'),
      claimTransfer:this.db.prepare('UPDATE transfers SET claimed_at=? WHERE token=? AND claimed_at IS NULL AND expires_at>?'),
      pruneTransfers:this.db.prepare('DELETE FROM transfers WHERE expires_at<=? OR (claimed_at IS NOT NULL AND claimed_at<=?)'),
      countTransfers:this.db.prepare('SELECT COUNT(*) AS n FROM transfers WHERE claimed_at IS NULL AND expires_at>?'),
      oldestTransfers:this.db.prepare('SELECT token FROM transfers WHERE claimed_at IS NULL AND expires_at>? ORDER BY created_at ASC LIMIT ?'),
      delTransfer:this.db.prepare('DELETE FROM transfers WHERE token=?'),
      getRate:this.db.prepare('SELECT count,resets_at FROM rates WHERE bucket=?'),
      putRate:this.db.prepare('INSERT INTO rates(bucket,count,resets_at) VALUES(?,?,?) ON CONFLICT(bucket) DO UPDATE SET count=excluded.count,resets_at=excluded.resets_at'),
      pruneRates:this.db.prepare('DELETE FROM rates WHERE resets_at<=?'),
      getSend:this.db.prepare('SELECT state,response_json,created_at,updated_at FROM sends WHERE user_id=? AND request_id=?'),
      beginSend:this.db.prepare("INSERT OR IGNORE INTO sends(user_id,request_id,state,created_at,updated_at) VALUES(?,?,'pending',?,?)"),
      doneSend:this.db.prepare("UPDATE sends SET state='done',response_json=?,updated_at=? WHERE user_id=? AND request_id=?"),
      failSend:this.db.prepare('DELETE FROM sends WHERE user_id=? AND request_id=?'),
      uncertainSend:this.db.prepare("UPDATE sends SET state='uncertain',updated_at=? WHERE user_id=? AND request_id=?"),
      stalePending:this.db.prepare("UPDATE sends SET state='uncertain',updated_at=? WHERE state='pending' AND updated_at<?"),
      pruneSends:this.db.prepare('DELETE FROM sends WHERE created_at<?')
    }
  }
  health(){return{driver:'sqlite',persistent:this.persistent}}
  close(){this.db.close()}
  prune(now=Date.now()){
    this.q.pruneTransfers.run(now,now-3600_000);
    this.q.pruneRates.run(now);
    this.q.stalePending.run(now,now-5*60_000);
    this.q.pruneSends.run(now-7*86400_000)
  }
  rate(bucket,{limit=20,windowMs=60_000,now=Date.now()}={}){
    const key=clean(bucket)||'unknown',row=this.q.getRate.get(key);
    let count=1,resetsAt=now+windowMs;
    if(row&&Number(row.resets_at)>now){count=Number(row.count)+1;resetsAt=Number(row.resets_at)}
    this.q.putRate.run(key,count,resetsAt);
    return{ok:count<=limit,count,limit,resetsAt}
  }
  createTransfer({token,html,isRtl=false,skipEntityDetection=false,document=null,semantic=null,expiresAt,now=Date.now()}){
    this.prune(now);
    const active=Number(this.q.countTransfers.get(now)?.n||0);
    if(active>=1000){
      for(const row of this.q.oldestTransfers.all(now,active-999))this.q.delTransfer.run(row.token)
    }
    this.q.addTransfer.run(token,html,isRtl?1:0,skipEntityDetection?1:0,document?json(document):null,semantic?json(semantic):null,now,expiresAt);
    return{token,expiresAt}
  }
  claimTransfer(token,{now=Date.now()}={}){
    this.prune(now);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const row=this.q.getTransfer.get(token);
      if(!row||row.claimed_at!==null||Number(row.expires_at)<=now){this.db.exec('ROLLBACK');return null}
      const result=this.q.claimTransfer.run(now,token,now);
      if(Number(result.changes)!==1){this.db.exec('ROLLBACK');return null}
      this.db.exec('COMMIT');
      return{
        html:row.html,
        isRtl:Boolean(row.is_rtl),
        skipEntityDetection:Boolean(row.skip_entities),
        document:row.document_json?parse(row.document_json):null,
        semantic:row.semantic_json?parse(row.semantic_json):null,
        expiresAt:Number(row.expires_at)
      }
    }catch(error){try{this.db.exec('ROLLBACK')}catch{}throw error}
  }
  sendState(userId,requestId){
    const row=this.q.getSend.get(String(userId),String(requestId));
    return row?{state:row.state,response:row.response_json?parse(row.response_json):null,createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}:null
  }
  beginSend(userId,requestId,{now=Date.now()}={}){
    const result=this.q.beginSend.run(String(userId),String(requestId),now,now);
    return Number(result.changes)===1
  }
  completeSend(userId,requestId,response,{now=Date.now()}={}){
    this.q.doneSend.run(json(response),now,String(userId),String(requestId))
  }
  markUncertain(userId,requestId,{now=Date.now()}={}){this.q.uncertainSend.run(now,String(userId),String(requestId))}
  releaseSend(userId,requestId){this.q.failSend.run(String(userId),String(requestId))}
}

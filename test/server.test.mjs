import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../src/server.mjs';
import {Store} from '../src/store.mjs';
import {signInitData} from '../src/telegram.mjs';

const token='123456:TEST_TOKEN';
const requestId='request-send-00000001';

async function withServer(fetchImpl,fn,overrides={}){
  const env={SEND_SCOPE:'self',INIT_DATA_MAX_AGE:'86400',ALLOWED_ORIGINS:'https://example.com',TRANSFER_TTL_SECONDS:'900',BOT_USERNAME:'rmdtxtml_test_bot',...overrides};
  const store=new Store({env,dbPath:':memory:'});
  const server=createServer({botToken:token,env,fetchImpl,store});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const address=server.address();
  try{return await fn(`http://127.0.0.1:${address.port}`,store)}
  finally{server.close();await once(server,'close');store.close()}
}
function initData(id=42){return signInitData({auth_date:Math.floor(Date.now()/1000),user:JSON.stringify({id,first_name:'Test'})},token)}
const post=(base,path,body,origin='https://example.com')=>fetch(base+path,{method:'POST',headers:{'content-type':'application/json',...(origin?{origin}:{})},body:JSON.stringify(body)});

test('health endpoint reports storage mode and bot configuration',async()=>{
  await withServer(fetch,async base=>{
    const response=await fetch(base+'/api/health'),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.botConfigured,true);
    assert.equal(body.storage.driver,'sqlite');assert.equal(body.storage.persistent,false)
  })
});

test('POST /api/send validates session, forwards Bot API payload and is idempotent',async()=>{
  let calls=0,captured;
  const telegramFetch=async(url,options)=>{calls++;captured={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({ok:true,result:{message_id:7}}),{status:200,headers:{'content-type':'application/json'}})};
  await withServer(telegramFetch,async base=>{
    const body={initData:initData(),requestId,chatId:'42',html:'<h2>Olá</h2>',isRtl:true,skipEntityDetection:true};
    const first=await post(base,'/api/send',body),a=await first.json();
    assert.equal(first.status,200);assert.equal(a.ok,true);assert.match(captured.url,/\/sendRichMessage$/);
    assert.equal(captured.body.chat_id,'42');assert.deepEqual(captured.body.rich_message,{html:'<h2>Olá</h2>',is_rtl:true,skip_entity_detection:true});
    const second=await post(base,'/api/send',body),b=await second.json();
    assert.equal(second.status,200);assert.equal(b.idempotent,true);assert.equal(calls,1)
  })
});

test('POST /api/send rejects a destination outside self scope',async()=>{
  let called=false;
  await withServer(async()=>{called=true;return new Response('{}',{status:500})},async base=>{
    const response=await post(base,'/api/send',{initData:initData(),requestId,chatId:'43',html:'<p>x</p>'},null);
    assert.equal(response.status,403);assert.equal(called,false)
  })
});

test('network uncertainty blocks an automatic duplicate send',async()=>{
  let calls=0;
  await withServer(async()=>{calls++;throw new Error('network down')},async base=>{
    const body={initData:initData(),requestId,chatId:'42',html:'<p>x</p>'};
    const first=await post(base,'/api/send',body),a=await first.json();
    assert.equal(first.status,502);assert.equal(a.uncertain,true);
    const second=await post(base,'/api/send',body),b=await second.json();
    assert.equal(second.status,409);assert.match(b.error,/já foi iniciado/);assert.equal(calls,1)
  })
});

test('confirmed Telegram rejection releases request id for retry',async()=>{
  let calls=0;
  const telegramFetch=async()=>{calls++;return new Response(JSON.stringify({ok:false,description:'Bad Request'}),{status:400,headers:{'content-type':'application/json'}})};
  await withServer(telegramFetch,async base=>{
    const body={initData:initData(),requestId,chatId:'42',html:'<p>x</p>'};
    const first=await post(base,'/api/send',body),a=await first.json();
    assert.equal(first.status,502);assert.equal(a.uncertain,false);
    const second=await post(base,'/api/send',body);
    assert.equal(second.status,502);assert.equal(calls,2)
  })
});

test('web transfer is durable-store backed, opaque, authenticated and one-time',async()=>{
  await withServer(fetch,async base=>{
    const created=await post(base,'/api/transfers',{html:'<h2>Web</h2>',isRtl:true,skipEntityDetection:true,document:{id:'00000000-0000-4000-8000-000000000001',revision:7}});
    assert.equal(created.status,201);const c=await created.json();
    assert.match(c.token,/^[A-Za-z0-9_-]{32}$/);assert.equal(c.telegramUrl,`https://t.me/rmdtxtml_test_bot?startapp=${c.token}`);
    const unauthorized=await post(base,'/api/transfers/claim',{token:c.token,initData:'bad'});
    assert.equal(unauthorized.status,401);
    const claimed=await post(base,'/api/transfers/claim',{token:c.token,initData:initData()}),body=await claimed.json();
    assert.equal(claimed.status,200);assert.equal(body.transfer.html,'<h2>Web</h2>');assert.equal(body.transfer.isRtl,true);
    assert.deepEqual(body.transfer.document,{id:'00000000-0000-4000-8000-000000000001',revision:7});assert.ok(body.transfer.expiresAt> Date.now());
    const again=await post(base,'/api/transfers/claim',{token:c.token,initData:initData()});
    assert.equal(again.status,404)
  })
});

test('browser API writes reject untrusted Origin',async()=>{
  await withServer(fetch,async base=>{
    const transfer=await post(base,'/api/transfers',{html:'<p>x</p>'},'https://evil.example');
    assert.equal(transfer.status,403);
    const send=await post(base,'/api/send',{initData:initData(),requestId,chatId:'42',html:'<p>x</p>'},'https://evil.example');
    assert.equal(send.status,403)
  })
});

test('transfer rate limiting is persisted in the store',async()=>{
  await withServer(fetch,async base=>{
    const a=await post(base,'/api/transfers',{html:'<p>a</p>'});
    const b=await post(base,'/api/transfers',{html:'<p>b</p>'});
    assert.equal(a.status,201);assert.equal(b.status,429);assert.ok(Number(b.headers.get('retry-after'))>=1)
  },{TRANSFER_RATE_LIMIT:'1'})
});

test('web transfer rejects invalid rich content',async()=>{
  await withServer(fetch,async base=>{
    const response=await post(base,'/api/transfers',{html:'<script>x</script>'});
    assert.equal(response.status,400)
  })
});

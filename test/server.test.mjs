import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtempSync,rmSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureTelegramBot,createServer} from '../src/server.mjs';
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

test('health and readiness distinguish liveness from production requirements',async()=>{
  await withServer(fetch,async base=>{
    const response=await fetch(base+'/api/health'),body=await response.json();
    assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.ready,true);assert.equal(body.botConfigured,true);
    assert.equal(body.version,'1.1.0-rc.1');assert.equal(body.storage.driver,'sqlite');assert.equal(body.storage.persistent,false);assert.equal(body.storage.ok,true)
  });
  await withServer(fetch,async base=>{
    const response=await fetch(base+'/api/ready'),body=await response.json();
    assert.equal(response.status,503);assert.equal(body.ok,false);assert.equal(body.ready,false);assert.equal(body.storage.persistent,false)
  },{REQUIRE_PERSISTENT_STORAGE:'true',REQUIRE_BOT_READY:'true'})
});

test('POST /api/bootstrap exposes only opaque authorized destinations',async()=>{
  await withServer(fetch,async base=>{
    const response=await post(base,'/api/bootstrap',{initData:initData()}),body=await response.json();
    assert.equal(response.status,200);assert.deepEqual(body.destinations,[{id:'self',label:'Minhas mensagens'}]);
    assert.equal(JSON.stringify(body).includes('"42"'),false)
  })
});

test('static shell emits release security headers and HEAD has no response body',async()=>{
  await withServer(fetch,async base=>{
    const response=await fetch(base+'/',{method:'HEAD'});
    assert.equal(response.status,200);assert.equal(response.headers.get('referrer-policy'),'no-referrer');
    assert.match(response.headers.get('permissions-policy')||'',/camera=\(\)/);
    assert.equal(response.headers.get('cache-control'),'no-cache');assert.equal(await response.text(),'');
    const js=await fetch(base+'/app.js');assert.equal(js.headers.get('cache-control'),'no-cache')
  })
});

test('POST /api/send validates session, forwards Bot API payload and is idempotent',async()=>{
  let calls=0,captured;
  const telegramFetch=async(url,options)=>{calls++;captured={url,body:JSON.parse(options.body)};return new Response(JSON.stringify({ok:true,result:{message_id:7}}),{status:200,headers:{'content-type':'application/json'}})};
  await withServer(telegramFetch,async base=>{
    const body={initData:initData(),requestId,destinationId:'self',html:'<h2>Olá</h2>',isRtl:true,skipEntityDetection:true};
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
    const response=await post(base,'/api/send',{initData:initData(),requestId,destinationId:'d_invalid',html:'<p>x</p>'},null);
    assert.equal(response.status,403);assert.equal(called,false)
  })
});

test('network uncertainty blocks an automatic duplicate send',async()=>{
  let calls=0;
  await withServer(async()=>{calls++;throw new Error('network down')},async base=>{
    const body={initData:initData(),requestId,destinationId:'self',html:'<p>x</p>'};
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
    const body={initData:initData(),requestId,destinationId:'self',html:'<p>x</p>'};
    const first=await post(base,'/api/send',body),a=await first.json();
    assert.equal(first.status,502);assert.equal(a.uncertain,false);
    const second=await post(base,'/api/send',body);
    assert.equal(second.status,502);assert.equal(calls,2)
  })
});

test('web transfer is durable-store backed, opaque, authenticated and one-time',async()=>{
  await withServer(fetch,async base=>{
    const semantic={schema:2,format:'semantic',modelVersion:2,model:{type:'doc',content:[{type:'heading',attrs:{level:2},content:[{type:'text',text:'Web'}]}]}};
    const created=await post(base,'/api/transfers',{html:'<h2>Web</h2>',isRtl:true,skipEntityDetection:true,document:{id:'00000000-0000-4000-8000-000000000001',revision:7},semantic});
    assert.equal(created.status,201);const c=await created.json();
    assert.match(c.token,/^[A-Za-z0-9_-]{32}$/);assert.equal(c.telegramUrl,`https://t.me/rmdtxtml_test_bot?startapp=${c.token}`);
    const unauthorized=await post(base,'/api/transfers/claim',{token:c.token,initData:'bad'});
    assert.equal(unauthorized.status,401);
    const claimed=await post(base,'/api/transfers/claim',{token:c.token,initData:initData()}),body=await claimed.json();
    assert.equal(claimed.status,200);assert.equal(body.transfer.html,'<h2>Web</h2>');assert.equal(body.transfer.isRtl,true);
    assert.deepEqual(body.transfer.document,{id:'00000000-0000-4000-8000-000000000001',revision:7});assert.deepEqual(body.transfer.semantic,semantic);assert.ok(body.transfer.expiresAt> Date.now());
    const again=await post(base,'/api/transfers/claim',{token:c.token,initData:initData()});
    assert.equal(again.status,404)
  })
});

test('web transfer rejects malformed semantic payload instead of storing it',async()=>{
  await withServer(fetch,async base=>{
    const response=await post(base,'/api/transfers',{html:'<p>x</p>',semantic:{schema:2,format:'wrong',model:{type:'doc'}}});
    assert.equal(response.status,400);const body=await response.json();assert.match(body.error,/semântico inválido/)
  })
});

test('web transfer preserves model version and rejects invalid version metadata',async()=>{
  await withServer(fetch,async base=>{
    const semantic={schema:2,format:'semantic',modelVersion:7,model:{type:'doc',content:[{type:'paragraph'}]}};
    const created=await post(base,'/api/transfers',{html:'<p>x</p>',semantic});
    assert.equal(created.status,201);const tokenValue=(await created.json()).token;
    const claimed=await post(base,'/api/transfers/claim',{token:tokenValue,initData:initData()}),body=await claimed.json();
    assert.equal(claimed.status,200);assert.equal(body.transfer.semantic.modelVersion,7);
    const invalid=await post(base,'/api/transfers',{html:'<p>x</p>',semantic:{schema:2,format:'semantic',modelVersion:0,model:{type:'doc'}}});
    assert.equal(invalid.status,400)
  })
});

test('browser API writes reject untrusted Origin',async()=>{
  await withServer(fetch,async base=>{
    const transfer=await post(base,'/api/transfers',{html:'<p>x</p>'},'https://evil.example');
    assert.equal(transfer.status,403);
    const send=await post(base,'/api/send',{initData:initData(),requestId,destinationId:'self',html:'<p>x</p>'},'https://evil.example');
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


test('expired Telegram session is rejected at the authenticated API boundary',async()=>{
  await withServer(fetch,async base=>{
    const expired=signInitData({auth_date:Math.floor(Date.now()/1000)-90000,user:JSON.stringify({id:42})},token);
    const response=await post(base,'/api/transfers/claim',{token:'a'.repeat(32),initData:expired});
    const body=await response.json();
    assert.equal(response.status,401);assert.match(body.error,/expired/)
  })
});

test('transfer survives a real server restart when SQLite path is durable',async()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'rmdtxtml-server-')),dbPath=path.join(dir,'state.sqlite');
  const env={SEND_SCOPE:'self',INIT_DATA_MAX_AGE:'86400',ALLOWED_ORIGINS:'https://example.com',TRANSFER_TTL_SECONDS:'900',BOT_USERNAME:'rmdtxtml_test_bot'};
  const start=async()=>{
    const store=new Store({env,dbPath}),server=createServer({botToken:token,env,fetchImpl:fetch,store});
    server.listen(0,'127.0.0.1');await once(server,'listening');
    return{store,server,base:`http://127.0.0.1:${server.address().port}`}
  };
  let first,second;
  try{
    first=await start();
    const created=await post(first.base,'/api/transfers',{html:'<p>restart</p>',document:{id:'restart_document_01',revision:3}});
    assert.equal(created.status,201);const tokenValue=(await created.json()).token;
    first.server.close();await once(first.server,'close');first.store.close();first=null;

    second=await start();
    const claimed=await post(second.base,'/api/transfers/claim',{token:tokenValue,initData:initData()});
    const body=await claimed.json();
    assert.equal(claimed.status,200);assert.equal(body.transfer.html,'<p>restart</p>');
    assert.deepEqual(body.transfer.document,{id:'restart_document_01',revision:3})
  }finally{
    if(first){first.server.close();await once(first.server,'close');first.store.close()}
    if(second){second.server.close();await once(second.server,'close');second.store.close()}
    rmSync(dir,{recursive:true,force:true})
  }
});

test('POST /api/send forwards validated Rich Message blocks without parallel representation',async()=>{
  let captured;
  const telegramFetch=async(url,options)=>{captured=JSON.parse(options.body);return new Response(JSON.stringify({ok:true,result:{message_id:91}}),{status:200,headers:{'content-type':'application/json'}})};
  await withServer(telegramFetch,async base=>{
    const richMessage={blocks:[{type:'heading',text:'Título',size:2},{type:'paragraph',text:{type:'bold',text:'Corpo'}}],skip_entity_detection:true};
    const response=await post(base,'/api/send',{initData:initData(),requestId:'request-blocks-000001',destinationId:'self',richMessage});
    assert.equal(response.status,200);assert.deepEqual(captured.rich_message,richMessage);assert.equal('html' in captured.rich_message,false)
  })
});
test('POST /api/send rejects multiple Rich Message representations',async()=>{
  await withServer(fetch,async base=>{
    const response=await post(base,'/api/send',{initData:initData(),requestId:'request-invalid-rich1',destinationId:'self',richMessage:{html:'<p>x</p>',blocks:[{type:'paragraph',text:'x'}]}});
    assert.equal(response.status,400);assert.match((await response.json()).error,/exactly_one_rich_representation_required/)
  })
});


test('same requestId cannot be replayed with a different payload',async()=>{
  let calls=0;
  const telegramFetch=async()=>{calls++;return new Response(JSON.stringify({ok:true,result:{message_id:22}}),{status:200,headers:{'content-type':'application/json'}})};
  await withServer(telegramFetch,async base=>{
    const first=await post(base,'/api/send',{initData:initData(),requestId:'request-fingerprint-0001',destinationId:'self',html:'<p>Primeiro</p>'});
    assert.equal(first.status,200);
    const second=await post(base,'/api/send',{initData:initData(),requestId:'request-fingerprint-0001',destinationId:'self',html:'<p>Outro</p>'}),body=await second.json();
    assert.equal(second.status,409);assert.equal(body.conflict,true);assert.equal(calls,1)
  })
});

test('configured destinations require explicit per-user ACL unless global access is enabled',async()=>{
  const configured=JSON.stringify([{chat_id:'-100123',label:'Equipe',user_ids:[42]},{chat_id:'-100999',label:'Outro',user_ids:[99]}]);
  await withServer(fetch,async base=>{
    const response=await post(base,'/api/bootstrap',{initData:initData(42)}),body=await response.json();
    assert.equal(response.status,200);assert.deepEqual(body.destinations.map(x=>x.label),['Minhas mensagens','Equipe']);
    const other=await post(base,'/api/bootstrap',{initData:initData(99)}),otherBody=await other.json();
    assert.deepEqual(otherBody.destinations.map(x=>x.label),['Minhas mensagens','Outro'])
  },{SEND_SCOPE:'all',AUTHORIZED_DESTINATIONS:configured})
});

test('Telegram startup preflight verifies bot identity and menu configuration',async()=>{
  const calls=[];
  const fetchImpl=async(url,options)=>{
    const method=new URL(url).pathname.split('/').at(-1);calls.push({method,body:JSON.parse(options.body)});
    if(method==='getMe')return new Response(JSON.stringify({ok:true,result:{username:'rmdtxtml_test_bot',has_main_web_app:true}}),{status:200,headers:{'content-type':'application/json'}});
    if(method==='setChatMenuButton')return new Response(JSON.stringify({ok:true,result:true}),{status:200,headers:{'content-type':'application/json'}});
    return new Response(JSON.stringify({ok:false,description:'unexpected'}),{status:400,headers:{'content-type':'application/json'}})
  };
  const result=await configureTelegramBot({token,appUrl:'https://example.com/',fetchImpl});
  assert.deepEqual(result,{username:'rmdtxtml_test_bot',mainMiniApp:true,appUrl:'https://example.com/'});
  assert.deepEqual(calls.map(x=>x.method),['getMe','setChatMenuButton']);
  assert.equal(calls[1].body.menu_button.web_app.url,'https://example.com/')
});

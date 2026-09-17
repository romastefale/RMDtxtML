import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../src/server.mjs';
import {signInitData} from '../src/telegram.mjs';

const token='123456:TEST_TOKEN';
async function withServer(fetchImpl,fn){
  const env={SEND_SCOPE:'self',INIT_DATA_MAX_AGE:'86400',ALLOWED_ORIGINS:'https://example.com'};
  const server=createServer({botToken:token,env,fetchImpl});
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const address=server.address();
  try{return await fn(`http://127.0.0.1:${address.port}`)}finally{server.close();await once(server,'close')}
}
function initData(id=42){return signInitData({auth_date:Math.floor(Date.now()/1000),user:JSON.stringify({id,first_name:'Test'})},token)}

test('health endpoint reports bot configured',async()=>{
  await withServer(fetch,async base=>{
    const response=await fetch(base+'/api/health');
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.ok,true);
    assert.equal(body.botConfigured,true);
  });
});

test('POST /api/send validates session and forwards Bot API 10.3 payload',async()=>{
  let captured;
  const telegramFetch=async(url,options)=>{
    captured={url,options,body:JSON.parse(options.body)};
    return new Response(JSON.stringify({ok:true,result:{message_id:7}}),{status:200,headers:{'content-type':'application/json'}});
  };
  await withServer(telegramFetch,async base=>{
    const response=await fetch(base+'/api/send',{method:'POST',headers:{'content-type':'application/json','origin':'https://example.com'},body:JSON.stringify({initData:initData(),chatId:'42',html:'<h2>Olá</h2>',isRtl:true,skipEntityDetection:true})});
    const body=await response.json();
    assert.equal(response.status,200);
    assert.equal(body.ok,true);
    assert.match(captured.url,/\/sendRichMessage$/);
    assert.equal(captured.body.chat_id,'42');
    assert.deepEqual(captured.body.rich_message,{html:'<h2>Olá</h2>',is_rtl:true,skip_entity_detection:true});
    assert.equal(response.headers.get('access-control-allow-origin'),'https://example.com');
  });
});

test('POST /api/send rejects a destination outside self scope',async()=>{
  let called=false;
  await withServer(async()=>{called=true;return new Response('{}',{status:500})},async base=>{
    const response=await fetch(base+'/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:initData(),chatId:'43',html:'<p>x</p>'})});
    assert.equal(response.status,403);
    assert.equal(called,false);
  });
});

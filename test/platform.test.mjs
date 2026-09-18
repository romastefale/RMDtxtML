import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

async function make({telegram=null,href='https://example.com/',stored=null,fetchImpl=fetch}={}){
  const source=await readFile(new URL('../docs/platform.js',import.meta.url),'utf8');
  const map=new Map(stored?[['rmdtxtml-api-v1',stored]]:[]);
  const localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))};
  const location=new URL(href);
  const history={replaceState:()=>{}};
  const document={documentElement:{dataset:{}}};
  const window={Telegram:telegram?{WebApp:telegram}:undefined,RMD:{}};
  const platform=new Function('window','localStorage','location','history','fetch','document',source+';return window.RMD.platform')(window,localStorage,location,history,fetchImpl,document);
  return{platform,document,map}
}

test('platform distinguishes normal web from Telegram Mini App',async()=>{
  const web=await make({href:'https://romastefale.github.io/RMDtxtML/'});
  assert.equal(web.platform.isTelegram(),false);
  assert.equal(web.platform.api(),'https://rmdtxtml.up.railway.app');
  const tg={initData:'auth_date=1&hash=x',initDataUnsafe:{user:{id:42},start_param:'token'},platform:'ios',version:'9.0',ready(){this.readyCalled=true},expand(){this.expandCalled=true}};
  const mini=await make({telegram:tg});
  assert.equal(mini.platform.isTelegram(),true);
  assert.equal(mini.platform.startParam(),'token');
  assert.equal(mini.platform.userId(),'42');
  mini.platform.boot();
  assert.equal(tg.readyCalled,true);
  assert.equal(tg.expandCalled,true);
  assert.equal(mini.document.documentElement.dataset.host,'telegram')
});

test('platform uses tgWebAppStartParam as launch fallback',async()=>{
  const env=await make({telegram:{initData:'signed',initDataUnsafe:{}},href:'https://example.com/?tgWebAppStartParam=abc_123'});
  assert.equal(env.platform.startParam(),'abc_123')
});

test('authenticated requests forward raw initData, not initDataUnsafe',async()=>{
  let captured;
  const telegram={initData:'signed-raw-data',initDataUnsafe:{user:{id:999}}};
  const env=await make({telegram,fetchImpl:async(url,options)=>{captured={url,options};return new Response(JSON.stringify({ok:true,value:1}),{status:200,headers:{'content-type':'application/json'}})}});
  const result=await env.platform.json('/api/test',{method:'POST',auth:true,body:{x:1}});
  assert.equal(result.value,1);
  assert.equal(captured.url,'https://example.com/api/test');
  assert.deepEqual(JSON.parse(captured.options.body),{x:1,initData:'signed-raw-data'})
});

test('custom backend override is centralized',async()=>{
  const env=await make({stored:'https://api.example.test///'});
  assert.equal(env.platform.api(),'https://api.example.test')
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

function button(){
  return{
    visible:false,active:true,progress:false,text:'',
    onClick(fn){this.handler=fn},offClick(){this.handler=null},
    show(){this.visible=true},hide(){this.visible=false},
    enable(){this.active=true},disable(){this.active=false},
    showProgress(){this.progress=true},hideProgress(){this.progress=false},
    setText(v){this.text=v}
  }
}
function telegram(overrides={}){
  const handlers=new Map(),BackButton=button(),MainButton=button();
  return{
    initData:'signed',initDataUnsafe:{user:{id:42}},platform:'ios',version:'10.3',
    viewportHeight:700,viewportStableHeight:680,isExpanded:true,isFullscreen:false,isActive:true,
    safeAreaInset:{top:8,right:2,bottom:6,left:2},contentSafeAreaInset:{top:4,right:3,bottom:10,left:3},
    BackButton,MainButton,
    onEvent(name,fn){handlers.set(name,fn)},emit(name,data){handlers.get(name)?.(data)},
    ready(){this.readyCalled=true},expand(){this.expandCalled=true},requestFullscreen(){this.fullscreenRequested=true},
    setHeaderColor(v){this.header=v},setBackgroundColor(v){this.background=v},setBottomBarColor(v){this.bottom=v},
    enableClosingConfirmation(){this.closing=true},disableClosingConfirmation(){this.closing=false},hideKeyboard(){this.keyboardHidden=true},close(){this.closed=true},
    colorScheme:'dark',HapticFeedback:{notificationOccurred(type){this.type=type}},
    ...overrides
  }
}
async function make({telegram:client=null,href='https://example.com/',stored=null,fetchImpl=fetch,viewHeight=640}={}){
  const source=await readFile(new URL('../docs/platform.js',import.meta.url),'utf8'),styles=new Map(),listeners=new Map();
  const map=new Map(stored?[['rmdtxtml-api-v1',stored]]:[]);
  const localStorage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v))};
  const location=new URL(href),history={replaceState:()=>{}};
  const document={documentElement:{dataset:{},style:{setProperty:(k,v)=>styles.set(k,v)}}};
  const visualViewport={height:viewHeight,addEventListener:(n,fn)=>listeners.set('visual:'+n,fn)};
  const window={Telegram:client?{WebApp:client}:undefined,RMD:{},innerHeight:viewHeight,visualViewport,addEventListener:(n,fn)=>listeners.set('window:'+n,fn)};
  const platform=new Function('window','localStorage','location','history','fetch','document',source+';return window.RMD.platform')(window,localStorage,location,history,fetchImpl,document);
  return{platform,document,map,styles,listeners}
}

test('platform distinguishes normal web from Telegram Mini App',async()=>{
  const web=await make({href:'https://romastefale.github.io/RMDtxtML/'});
  assert.equal(web.platform.isTelegram(),false);
  assert.equal(web.platform.api(),'https://rmdtxtml.up.railway.app');
  const tg=telegram({initDataUnsafe:{user:{id:42},start_param:'token'}});
  const mini=await make({telegram:tg});
  assert.equal(mini.platform.isTelegram(),true);assert.equal(mini.platform.startParam(),'token');assert.equal(mini.platform.userId(),'42')
});

test('boot uses stable viewport, safe areas and native fullscreen lifecycle',async()=>{
  const tg=telegram(),env=await make({telegram:tg});
  env.platform.boot();await Promise.resolve();
  assert.equal(tg.readyCalled,true);assert.equal(tg.expandCalled,true);assert.equal(tg.fullscreenRequested,true);
  assert.equal(env.document.documentElement.dataset.host,'telegram');
  assert.equal(env.document.documentElement.dataset.expanded,'true');
  assert.equal(env.styles.get('--rmd-app-height'),'680px');
  assert.equal(env.styles.get('--rmd-safe-top'),'8px');
  assert.equal(env.styles.get('--rmd-content-bottom'),'10px');
  assert.equal(tg.header,'bg_color');assert.equal(tg.background,'bg_color');assert.equal(tg.bottom,'bottom_bar_bg_color');
  tg.viewportStableHeight=590;tg.emit('viewportChanged',{isStateStable:true});
  assert.equal(env.styles.get('--rmd-app-height'),'590px');
  tg.isFullscreen=true;tg.emit('fullscreenChanged');
  assert.equal(env.document.documentElement.dataset.fullscreen,'true')
});

test('native back and main buttons are controlled by one platform boundary',async()=>{
  const tg=telegram(),env=await make({telegram:tg});env.platform.boot();
  let backs=0,mains=0;
  env.platform.setBack(()=>backs++);assert.equal(tg.BackButton.visible,true);tg.BackButton.handler();assert.equal(backs,1);
  env.platform.setBack(null);assert.equal(tg.BackButton.visible,false);
  env.platform.setMain({text:'Enviar',visible:true,enabled:false,busy:true,onClick:()=>mains++});
  assert.equal(tg.MainButton.text,'Enviar');assert.equal(tg.MainButton.visible,true);assert.equal(tg.MainButton.active,false);assert.equal(tg.MainButton.progress,true);
  tg.MainButton.active=true;tg.MainButton.handler();assert.equal(mains,1);
  env.platform.dirty(true);assert.equal(tg.closing,true);env.platform.dirty(false);assert.equal(tg.closing,false);
  env.platform.keyboard();assert.equal(tg.keyboardHidden,true);
  env.platform.haptic('success');assert.equal(tg.HapticFeedback.type,'success');
  assert.equal(env.platform.colorScheme(),'dark');env.platform.close();assert.equal(tg.closed,true)
});

test('web viewport tracks visualViewport without Telegram controls',async()=>{
  const env=await make({viewHeight:612});env.platform.boot();
  assert.equal(env.document.documentElement.dataset.host,'web');assert.equal(env.styles.get('--rmd-app-height'),'612px');
  assert.ok(env.listeners.has('visual:resize'))
});

test('platform uses tgWebAppStartParam as launch fallback',async()=>{
  const env=await make({telegram:telegram({initDataUnsafe:{}}),href:'https://example.com/?tgWebAppStartParam=abc_123'});
  assert.equal(env.platform.startParam(),'abc_123')
});

test('authenticated requests forward raw initData, not initDataUnsafe',async()=>{
  let captured;
  const tg=telegram({initData:'signed-raw-data',initDataUnsafe:{user:{id:999}}});
  const env=await make({telegram:tg,fetchImpl:async(url,options)=>{captured={url,options};return new Response(JSON.stringify({ok:true,value:1}),{status:200,headers:{'content-type':'application/json'}})}});
  const result=await env.platform.json('/api/test',{method:'POST',auth:true,body:{x:1}});
  assert.equal(result.value,1);assert.equal(captured.url,'https://example.com/api/test');
  assert.deepEqual(JSON.parse(captured.options.body),{x:1,initData:'signed-raw-data'})
});

test('custom backend override is centralized',async()=>{
  const env=await make({stored:'https://api.example.test///'});
  assert.equal(env.platform.api(),'https://api.example.test')
});

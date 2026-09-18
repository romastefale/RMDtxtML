(()=>{'use strict';
const tg=window.Telegram?.WebApp||null;
const root=document.documentElement;
const hasInit=()=>typeof tg?.initData==='string'&&tg.initData.length>0;
const isTelegram=()=>hasInit();
const api=()=>/^https?:$/.test(location.protocol)?location.origin:'https://rmdtxtml.up.railway.app';
const startParam=()=>{
  const unsafe=tg?.initDataUnsafe?.start_param;
  if(typeof unsafe==='string'&&unsafe)return unsafe;
  return new URLSearchParams(location.search).get('tgWebAppStartParam')||''
};
const userId=()=>{
  const id=tg?.initDataUnsafe?.user?.id;
  return id===undefined||id===null?'':String(id)
};
const launch=()=>({
  mode:isTelegram()?'telegram':'web',
  startParam:startParam(),
  userId:userId(),
  platform:String(tg?.platform||'web'),
  version:String(tg?.version||''),
  fullscreen:Boolean(tg?.isFullscreen),
  active:tg?.isActive!==false
});
const px=(name,value)=>root.style.setProperty(name,Math.max(0,Number(value)||0)+'px');
function syncInsets(){
  const safe=tg?.safeAreaInset||{},content=tg?.contentSafeAreaInset||{};
  px('--rmd-safe-top',safe.top);px('--rmd-safe-right',safe.right);px('--rmd-safe-bottom',safe.bottom);px('--rmd-safe-left',safe.left);
  px('--rmd-content-top',content.top);px('--rmd-content-right',content.right);px('--rmd-content-bottom',content.bottom);px('--rmd-content-left',content.left)
}
function syncViewport({stable=true}={}){
  let height=0;
  if(isTelegram()){if(stable)height=Number(tg?.viewportStableHeight)||Number(tg?.viewportHeight)}
  else height=Number(window.visualViewport?.height)||Number(window.innerHeight);
  if(height>0)px('--rmd-app-height',height);
  root.dataset.expanded=isTelegram()&&tg?.isExpanded?'true':'false';
  root.dataset.fullscreen=isTelegram()&&tg?.isFullscreen?'true':'false';
  root.dataset.active=!isTelegram()||tg?.isActive!==false?'true':'false'
}
const events=new Map();
function emit(name,detail){for(const fn of events.get(name)||[])try{fn(detail)}catch(error){console.error(error)}}
function on(name,fn){if(!events.has(name))events.set(name,new Set());events.get(name).add(fn);return()=>events.get(name)?.delete(fn)}
let backHandler=null,mainHandler=null;
function setBack(handler){
  backHandler=typeof handler==='function'?handler:null;
  if(!isTelegram())return;
  tg.BackButton?.offClick?.(handleBack);
  if(backHandler){tg.BackButton?.onClick?.(handleBack);tg.BackButton?.show?.()}else tg.BackButton?.hide?.()
}
function handleBack(){backHandler?.()}
function setMain({text='Enviar',visible=true,enabled=true,busy=false,onClick}={}){
  if(typeof onClick==='function')mainHandler=onClick;
  if(!isTelegram())return;
  const b=tg.MainButton;if(!b)return;
  b.offClick?.(handleMain);if(mainHandler)b.onClick?.(handleMain);
  b.setText?.(text);
  enabled?b.enable?.():b.disable?.();
  visible?b.show?.():b.hide?.();
  busy?b.showProgress?.(false):b.hideProgress?.()
}
function handleMain(){if(tg?.MainButton?.isActive===false)return;mainHandler?.()}
function dirty(value){
  if(!isTelegram())return;
  value?tg.enableClosingConfirmation?.():tg.disableClosingConfirmation?.()
}
function keyboard(){if(isTelegram())tg.hideKeyboard?.()}
function haptic(type='success'){if(isTelegram())tg.HapticFeedback?.notificationOccurred?.(type)}
function close(){if(isTelegram())tg.close?.();else history.back()}
function colorScheme(){return isTelegram()&&tg?.colorScheme?tg.colorScheme:(window.matchMedia?.('(prefers-color-scheme: dark)').matches?'dark':'light')}
function fullscreen(){
  if(!isTelegram())return;
  tg.expand?.();
  if(tg.isFullscreen)return;
  try{tg.requestFullscreen?.()}catch{}
}
function bindTelegram(){
  if(!isTelegram())return;
  tg.onEvent?.('themeChanged',()=>emit('theme',colorScheme()));
  tg.onEvent?.('viewportChanged',state=>{syncViewport({stable:state?.isStateStable!==false});emit('viewport',state)});
  tg.onEvent?.('safeAreaChanged',()=>{syncInsets();emit('safearea')});
  tg.onEvent?.('contentSafeAreaChanged',()=>{syncInsets();emit('safearea')});
  tg.onEvent?.('fullscreenChanged',()=>{syncViewport();emit('fullscreen',Boolean(tg.isFullscreen))});
  tg.onEvent?.('fullscreenFailed',error=>{syncViewport();emit('fullscreenfailed',error)});
  tg.onEvent?.('activated',()=>{syncViewport();emit('active',true)});
  tg.onEvent?.('deactivated',()=>{syncViewport();emit('active',false)})
}
function bindWeb(){
  if(isTelegram())return;
  const view=window.visualViewport;
  const resize=()=>{syncViewport();emit('viewport',{isStateStable:true})};
  view?.addEventListener?.('resize',resize);window.addEventListener?.('resize',resize)
}
let booted=false;
function boot(){
  if(booted)return;booted=true;
  root.dataset.host=isTelegram()?'telegram':'web';
  syncInsets();syncViewport();
  if(isTelegram()){
    tg.ready?.();tg.expand?.();bindTelegram();
    tg.setHeaderColor?.('bg_color');tg.setBackgroundColor?.('bg_color');tg.setBottomBarColor?.('bottom_bar_bg_color');
    queueMicrotask(fullscreen)
  }else bindWeb()
}
function cleanStartParam(){
  try{
    const url=new URL(location.href);url.searchParams.delete('tgWebAppStartParam');
    history.replaceState(null,'',url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'')+url.hash)
  }catch{}
}
async function json(path,{method='GET',body,auth=false}={}){
  const headers={};let payload=body;
  if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body)}
  if(auth){
    if(!isTelegram())throw new Error('telegram_session_required');
    payload=JSON.stringify({...body,initData:tg.initData});headers['content-type']='application/json'
  }
  const response=await fetch(api()+path,{method,headers,body:payload});
  const data=await response.json().catch(()=>null);
  if(!data){const error=new Error(`Resposta inválida do servidor (HTTP ${response.status})`);error.status=response.status;throw error}
  if(!response.ok||!data.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;error.info=data;throw error}
  return data
}
window.RMD=window.RMD||{};
window.RMD.platform={tg,isTelegram,api,startParam,userId,launch,boot,on,setBack,setMain,dirty,keyboard,haptic,close,colorScheme,fullscreen,syncViewport,syncInsets,cleanStartParam,json};
})();
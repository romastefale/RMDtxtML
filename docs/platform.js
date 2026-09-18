(()=>{'use strict';
const tg=window.Telegram?.WebApp||null;
const hasInit=()=>typeof tg?.initData==='string'&&tg.initData.length>0;
const isTelegram=()=>hasInit();
const api=()=>{
  const custom=localStorage.getItem('rmdtxtml-api-v1');
  if(custom)return custom.replace(/\/+$/,'');
  if(/^https?:$/.test(location.protocol)&&location.hostname!=='romastefale.github.io')return location.origin;
  return 'https://rmdtxtml.up.railway.app'
};
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
  version:String(tg?.version||'')
});
function boot(){
  document.documentElement.dataset.host=isTelegram()?'telegram':'web';
  if(!isTelegram())return;
  tg.ready?.();
  tg.expand?.()
}
function cleanStartParam(){
  try{
    const url=new URL(location.href);
    url.searchParams.delete('tgWebAppStartParam');
    history.replaceState(null,'',url.pathname+(url.searchParams.size?'?'+url.searchParams.toString():'')+url.hash)
  }catch{}
}
async function json(path,{method='GET',body,auth=false}={}){
  const headers={};
  let payload=body;
  if(body!==undefined){headers['content-type']='application/json';payload=JSON.stringify(body)}
  if(auth){
    if(!isTelegram())throw new Error('telegram_session_required');
    payload=JSON.stringify({...body,initData:tg.initData});
    headers['content-type']='application/json'
  }
  const response=await fetch(api()+path,{method,headers,body:payload});
  const data=await response.json().catch(()=>null);
  if(!data){const error=new Error(`Resposta inválida do servidor (HTTP ${response.status})`);error.status=response.status;throw error}
  if(!response.ok||!data.ok){const error=new Error(data.error||`HTTP ${response.status}`);error.status=response.status;error.info=data;throw error}
  return data
}
window.RMD=window.RMD||{};
window.RMD.platform={tg,isTelegram,api,startParam,userId,launch,boot,cleanStartParam,json};
})();
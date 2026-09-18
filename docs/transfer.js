(()=>{
  const tg=window.Telegram?.WebApp;
  const send=document.querySelector('#send');
  if(!send)return;
  const api=()=>{const custom=localStorage.getItem('rmdtxtml-api-v1');if(custom)return custom.replace(/\/+$/,'');if(/^https?:$/.test(location.protocol)&&location.hostname!=='romastefale.github.io')return location.origin;return 'https://rmdtxtml.up.railway.app'};
  const startParam=()=>tg?.initDataUnsafe?.start_param||new URLSearchParams(location.search).get('tgWebAppStartParam')||'';
  const setBusy=(busy,label)=>{send.disabled=busy;if(label)send.textContent=label};
  const persist=()=>{try{localStorage.setItem(KEY,JSON.stringify({html:currentHtml(),rtl,skipEntityDetection}))}catch{}};
  let saveTimer;
  ed.addEventListener('input',()=>{clearTimeout(saveTimer);saveTimer=setTimeout(persist,700)});
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persist()});
  window.addEventListener('pagehide',persist);
  async function jsonResponse(response){const result=await response.json().catch(()=>null);if(!result)throw new Error(`Resposta inválida do servidor (HTTP ${response.status})`);if(!response.ok||!result.ok)throw new Error(result.error||`HTTP ${response.status}`);return result}
  async function claim(){
    const token=startParam();
    if(!tg?.initData||!/^[A-Za-z0-9_-]{32}$/.test(token))return;
    setBusy(true,'Recuperando…');
    try{
      status.textContent='Recuperando composição…';
      const response=await fetch(api()+'/api/transfers/claim',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:tg.initData,token})});
      const result=await jsonResponse(response);
      ed.innerHTML=sanitizeRichHtml(result.transfer.html)||'<p><br></p>';
      rtl=result.transfer.isRtl===true;skipEntityDetection=result.transfer.skipEntityDetection===true;ed.dir=rtl?'rtl':'ltr';
      document.querySelector('#rtlState').textContent=rtl?'Ligado':'Desligado';document.querySelector('#entityState').textContent=skipEntityDetection?'Desligada':'Ligada';
      persist();updateStatus('Importado do Web');say('Composição transferida para o Telegram');
      try{history.replaceState(null,'',location.pathname+location.hash)}catch{}
    }catch(error){updateStatus('Transferência indisponível');say(error instanceof Error?error.message:'Falha ao recuperar composição')}
    finally{setBusy(false,'Enviar')}
  }
  async function openTelegram(){
    const m=metrics();if(!m.html)return say('Escreva algum conteúdo');if(m.bytes>MAX_BYTES)return say('A mensagem excede 32.768 bytes');
    setBusy(true,'Preparando…');status.textContent='Preparando Telegram…';
    try{
      const response=await fetch(api()+'/api/transfers',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({html:m.html,isRtl:rtl,skipEntityDetection})});
      const result=await jsonResponse(response);persist();
      location.assign(result.telegramUrl);updateStatus('Abrindo Telegram');
    }catch(error){updateStatus('Falha');say(error instanceof Error?error.message:'Falha ao abrir Telegram');setBusy(false,'Abrir no Telegram')}
  }
  if(!tg?.initData){send.textContent='Abrir no Telegram';send.title='Transferir esta composição para o Telegram';send.onclick=openTelegram}else{claim()}
})();

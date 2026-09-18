(()=>{'use strict';
const platform=RMD.platform,tg=platform.tg,send=document.querySelector('#send');
if(!send)return;
const setBusy=(busy,label)=>{if(platform.isTelegram())platform.setMain({text:label||'Enviar',visible:true,enabled:!busy,busy,onClick:typeof sendMessage==='function'?sendMessage:undefined});else{send.disabled=busy;if(label)send.textContent=label}};
async function claim(){
  await RMD.ready;
  const token=platform.startParam();
  if(!platform.isTelegram()||!/^[A-Za-z0-9_-]{32}$/.test(token))return;
  setBusy(true,'Recuperando…');
  try{
    status.textContent='Recuperando composição…';
    const result=await platform.json('/api/transfers/claim',{method:'POST',auth:true,body:{token}});
    doc=RMD.adoptTransferDocument(doc,result.transfer,{sanitize:sanitizeRichHtml});
    rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;
    core.setHtml(doc.content.html);applyOptions();
    doc=await store.save(doc,{checkpoint:true,sanitize:sanitizeRichHtml});
    platform.cleanStartParam();
    updateStatus('Importado do Web');say('Documento continuado no Telegram')
  }catch(error){
    updateStatus('Transferência indisponível');
    say(error instanceof Error?error.message:'Falha ao recuperar composição')
  }finally{setBusy(false,'Enviar')}
}
async function openTelegram(){
  await RMD.ready;
  const m=metrics();
  if(!m.html)return say('Escreva algum conteúdo');
  if(m.text>MAX_TEXT)return say('A mensagem excede 32.768 caracteres');
  setBusy(true,'Preparando…');status.textContent='Preparando Telegram…';
  try{
    syncDoc();
    const result=await platform.json('/api/transfers',{method:'POST',body:{
      html:m.html,
      isRtl:rtl,
      skipEntityDetection,
      document:{id:doc?.id||'',revision:doc?.meta?.revision||0}
    }});
    await persistDocument({label:'Salvo automaticamente'});
    location.assign(result.telegramUrl);updateStatus('Abrindo Telegram')
  }catch(error){
    updateStatus('Falha');say(error instanceof Error?error.message:'Falha ao abrir Telegram');
    setBusy(false,'Abrir no Telegram')
  }
}
if(!platform.isTelegram()){
  send.textContent='Abrir no Telegram';
  send.title='Continuar este documento no Telegram';
  send.onclick=openTelegram
}else claim();
})();
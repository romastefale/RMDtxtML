(()=>{'use strict';
const platform=RMD.platform,app=RMD.application,tg=platform.tg,send=document.querySelector('#send');
if(!send||!app)return;
const setBusy=(busy,label)=>{
  if(platform.isTelegram()){
    if(busy)platform.setMain({text:label||'Enviar',visible:true,enabled:false,busy:true,onClick:app.sendMessage});
    else app.refreshSend?.()
  }else{send.disabled=busy;if(label)send.textContent=label}
};
async function claim(){
  await app.ready();
  const token=platform.startParam();
  if(!platform.isTelegram()||!/^[A-Za-z0-9_-]{32}$/.test(token))return;
  setBusy(true,'Recuperando…');
  try{
    app.setStatus('Recuperando composição…');
    const result=await platform.json('/api/transfers/claim',{method:'POST',auth:true,body:{token}});
    await app.adoptTransfer(result.transfer);
    platform.cleanStartParam();
    app.updateStatus('Importado do Web');app.notify('Documento continuado no Telegram')
  }catch(error){
    app.updateStatus('Transferência indisponível');
    app.notify(error instanceof Error?error.message:'Falha ao recuperar composição')
  }finally{setBusy(false,'Enviar')}
}
async function openTelegram(){
  await app.ready();
  const m=app.metrics();
  if(m.empty)return app.notify('Escreva ou adicione algum conteúdo');
  if(m.text>app.maxText)return app.notify('A mensagem excede 32.768 caracteres');
  setBusy(true,'Preparando…');app.setStatus('Preparando Telegram…');
  try{
    const result=await platform.json('/api/transfers',{method:'POST',body:app.transferPayload()});
    await app.persist({label:'Salvo automaticamente'});
    location.assign(result.telegramUrl);app.updateStatus('Abrindo Telegram')
  }catch(error){
    app.updateStatus('Falha');app.notify(error instanceof Error?error.message:'Falha ao abrir Telegram');
    setBusy(false,'Abrir no Telegram')
  }
}
if(!platform.isTelegram()){
  send.textContent='Abrir no Telegram';
  send.title='Continuar este documento no Telegram';
  send.onclick=openTelegram
}else claim();
})();
const platform=RMD.platform;
platform.boot();

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const ed=$('#editor');
const status=$('#status');
const drawer=$('#drawer');
const toast=$('#toast');
const MAX_TEXT=32768;
const themeQuery=matchMedia('(prefers-color-scheme: dark)');
let rtl=false;
let skipEntityDetection=false;
const store=new RMD.DocumentStore();
let doc=null,saveTimer=0,sendRequestId='',destinationId='';

function syncTheme(){const dark=platform.isTelegram()?platform.colorScheme()==='dark':themeQuery.matches;document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light'}
function say(message){toast.textContent=message;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>toast.classList.remove('show'),2200)}
function validHref(v){return /^(#|https?:|mailto:|tel:|tg:\/\/user\?id=)/i.test(v)}
function currentHtml(){return core.html()}
function metrics(){const s=core.stats();return{html:currentHtml(),text:s.text,blocks:s.blocks}}
function updateStatus(prefix=''){const m=metrics();status.textContent=`${prefix?prefix+' · ':''}${m.text.toLocaleString('pt-BR')}/${MAX_TEXT.toLocaleString('pt-BR')} caracteres · ${m.blocks} blocos`;status.classList.toggle('danger',m.text>MAX_TEXT)}
function syncDoc(){
  if(!doc)return null;
  doc.content.model=core.model();
  doc.options.isRtl=rtl;
  doc.options.skipEntityDetection=skipEntityDetection;
  return doc
}
async function persistDocument({checkpoint=false,label='Salvo'}={}){
  if(!doc)return null;
  syncDoc();
  doc=await store.save(doc,{checkpoint,normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});
  platform.dirty(false);document.documentElement.dataset.dirty='false';updateStatus(label);
  return doc
}
function schedulePersist(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{persistDocument({label:'Salvo automaticamente'}).catch(()=>updateStatus('Falha ao salvar'))},700)
}
function dirty(){sendRequestId='';platform.dirty(true);document.documentElement.dataset.dirty='true';updateStatus('Não salvo');queueMicrotask(syncEditorUi);if(doc)schedulePersist()}
const core=new RMD.Editor(ed,{change:dirty});RMD.editor=core;
const menuIcons={
  ul:'list',ol:'list',task:'list',quote:'quote',expandable:'quote',pullquote:'quote',details:'file',pre:'code',divider:'text',table:'table',
  math:'text',mathblock:'text',image:'media',video:'media',audio:'media',document:'file',map:'media',collage:'media',slideshow:'media',
  reference:'file',anchor:'link',time:'text',emoji:'media',button:'button',rtl:'settings',entities:'settings',
  export:'file',exporthtml:'code',import:'file',revision:'file',reset:'settings'
};
for(const b of $$('[data-action]')){
  const id=menuIcons[b.dataset.action];if(id&&!b.querySelector('svg'))b.insertAdjacentHTML('afterbegin',`<svg class="menuIcon" aria-hidden="true"><use href="#i-${id}"/></svg>`)
}
for(const b of $$('button[title]:not([aria-label])'))b.setAttribute('aria-label',b.title);
const textSpec=(text,marks=[])=>({type:'text',text:String(text),...(marks.length?{marks}:{})});
const paragraphSpec=(text='')=>({type:'paragraph',...(text?{content:[textSpec(text)]}:{})});
const insertSpec=spec=>core.insertSpec(spec)
function wrap(tag,attrs={}){if(!core.format(tag,attrs))say('Selecione um trecho primeiro')}
function run(command){const map={bold:'strong',italic:'em',underline:'u',strikeThrough:'s'};if(map[command])return wrap(map[command]);if(command==='undo')return core.undo();if(command==='redo')return core.redo()}
function promptHttp(label,initial='https://'){const v=prompt(label,initial);if(v===null)return null;if(!/^https?:\/\//i.test(v)){say('Use uma URL HTTP ou HTTPS');return null}return v}
function safeName(value){return String(value||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,64)}

const formatButtons=[
  ['[data-cmd="bold"]','strong'],['[data-cmd="italic"]','em'],['[data-cmd="underline"]','u'],
  ['[data-cmd="strikeThrough"]','s'],['#spoiler','tg-spoiler'],['#code','code'],['#mark,[data-action="mark"]','mark'],['[data-action="sub"]','sub'],['[data-action="super"]','sup'],['#link','a']
];
function syncEditorUi(){
  const r=core.range();if(!r)return;
  for(const[selector,tag]of formatButtons)for(const b of $$(selector)){
    const active=!r.collapsed&&core.hasFormat(tag,r);
    b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active))
  }
  const block=core.topBlock(r.startContainer),tag=block?.tagName?.toLowerCase()||'p';
  const value=/^(p|h[1-6]|footer)$/.test(tag)?tag:'p';
  $('#block').value=value;$('#blockLabel').textContent=value==='p'?'P':value==='footer'?'F':value.toUpperCase()
}

document.addEventListener('selectionchange',()=>{if(core.ownsSelection())syncEditorUi()});
document.addEventListener('pointerdown',e=>{if(e.target.closest('.bar,.drawer,.bottom'))core.remember()},{capture:true});
$$('[data-cmd]').forEach(b=>{if(!b.hasAttribute('aria-pressed'))b.setAttribute('aria-pressed','false');b.addEventListener('click',()=>{run(b.dataset.cmd);queueMicrotask(syncEditorUi)})});
$('#block').addEventListener('change',e=>{core.block(e.target.value);queueMicrotask(syncEditorUi)});
$('#link').onclick=()=>{const r=core.range(),text=r?.toString()||'',u=prompt('URL','https://t.me/');if(!u)return;if(!validHref(u))return say('URL não suportada');if(r&&!r.collapsed)wrap('a',{href:u});else core.insertText(text||'Telegram',[{type:'link',attrs:{href:u}}])};
$('#code').onclick=()=>wrap('code');
$('#spoiler').onclick=()=>wrap('tg-spoiler');
$('#mark').onclick=()=>wrap('mark');
let previewOpen=false,drawerFocus=null;
const app=$('.app'),sheet=$('.sheet'),more=$('#more');
function syncBack(){
  if(!platform.isTelegram())return;
  if(drawer.classList.contains('open'))return platform.setBack(closeDrawer);
  if(previewOpen)return platform.setBack(closePreview);
  platform.setBack(null)
}
function openDrawer(){
  platform.keyboard();drawerFocus=document.activeElement;drawer.classList.add('open');drawer.setAttribute('aria-hidden','false');
  more.setAttribute('aria-expanded','true');app.inert=true;syncBack();requestAnimationFrame(()=>sheet.focus())
}
function closeDrawer(){
  if(!drawer.classList.contains('open'))return;
  drawer.classList.remove('open');drawer.setAttribute('aria-hidden','true');more.setAttribute('aria-expanded','false');
  app.inert=false;syncBack();if(drawerFocus?.isConnected)drawerFocus.focus({preventScroll:true});drawerFocus=null
}
function closePreview(){
  if(!previewOpen)return;
  previewOpen=false;$('#previewWrap').classList.remove('open');$('#editWrap').hidden=false;
  $('#previewBtn').innerHTML='<svg><use href="#i-preview"/></svg>';$('#previewBtn').setAttribute('aria-pressed','false');$('#previewBtn').setAttribute('aria-label','Abrir prévia');updateStatus('Edição');syncBack();ed.focus({preventScroll:true})
}
$('#more').onclick=openDrawer;
$('#close').onclick=closeDrawer;
drawer.onclick=e=>{if(e.target===drawer)closeDrawer()};
drawer.addEventListener('keydown',e=>{
  if(e.key==='Escape'){e.preventDefault();closeDrawer();return}
  if(e.key!=='Tab')return;
  const list=$$('.sheet button:not(:disabled),.sheet [href],.sheet select:not(:disabled),.sheet input:not(:disabled),.sheet [tabindex]:not([tabindex="-1"])').filter(x=>x.offsetParent!==null);
  if(!list.length)return;const first=list[0],last=list.at(-1);
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!drawer.classList.contains('open')&&previewOpen){e.preventDefault();closePreview()}});

const actions={
  mark:()=>wrap('mark'),
  sub:()=>wrap('sub'),
  super:()=>wrap('sup'),
  clear:()=>{if(!core.clear())say('Selecione um trecho primeiro')},
  ul:()=>core.list('ul'),
  ol:()=>core.list('ol'),
  task:()=>core.taskList([{text:'Tarefa',checked:false},{text:'Concluída',checked:true}]),
  quote:()=>insertSpec({type:'blockquote',attrs:{expandable:false},content:[{type:'paragraph',content:[textSpec('Citação '),textSpec('Autor',[{type:'cite'}])]}]}),
  expandable:()=>insertSpec({type:'blockquote',attrs:{expandable:true},content:[paragraphSpec('Citação expansível'),{type:'paragraph',content:[textSpec('Conteúdo adicional '),textSpec('Autor',[{type:'cite'}])]}]}),
  pullquote:()=>insertSpec({type:'pullquote',content:[textSpec('Trecho em destaque '),textSpec('Autor',[{type:'cite'}])]}),
  details:()=>{const summary=prompt('Título','Detalhes'),body=prompt('Conteúdo','Conteúdo recolhível.');if(summary!==null&&body!==null)insertSpec({type:'details',attrs:{summary,body,open:false}})},
  pre:()=>{const language=safeName(prompt('Linguagem (opcional)','javascript')||''),code=prompt('Código','console.log("Olá")');if(code!==null)insertSpec({type:'code_block',attrs:{language},...(code?{content:[textSpec(code)]}:{})})},
  divider:()=>insertSpec({type:'divider'}),
  math:()=>{const expression=prompt('Fórmula LaTeX','x^2 + y^2');if(expression)insertSpec({type:'math_inline',attrs:{expression}})},
  mathblock:()=>{const expression=prompt('Fórmula LaTeX','E = mc^2');if(expression)insertSpec({type:'math_block',attrs:{expression}})},
  table:()=>{
    const rows=Math.max(1,Math.min(100,+prompt('Linhas','3')||1)),cols=Math.max(1,Math.min(20,+prompt('Colunas','3')||1));
    const content=Array.from({length:rows},(_,row)=>({type:'table_row',content:Array.from({length:cols},(_,col)=>({
      type:row===0?'table_header':'table_cell',
      attrs:{colspan:1,rowspan:1,align:'',valign:''},
      content:[textSpec(row===0?'Cabeçalho '+(col+1):'Célula')]
    }))}));
    insertSpec({type:'table',attrs:{bordered:true,striped:false,compact:true},content})
  },
  image:()=>{const src=promptHttp('URL HTTPS da imagem');if(src)insertSpec({type:'image',attrs:{src,caption:'Imagem',alt:'Imagem',spoiler:false}})},
  video:()=>{const src=promptHttp('URL HTTPS do vídeo');if(src)insertSpec({type:'video',attrs:{src,caption:'Vídeo',alt:'',spoiler:false}})},
  audio:()=>{const src=promptHttp('URL HTTPS do áudio');if(src)insertSpec({type:'audio',attrs:{src,caption:'Áudio',alt:'',spoiler:false}})},
  document:()=>{const src=promptHttp('URL HTTPS do documento');if(src)insertSpec({type:'document',attrs:{src,caption:'Documento'}})},
  map:()=>{const lat=Number(prompt('Latitude','-23.5505')),long=Number(prompt('Longitude','-46.6333')),zoom=Math.max(0,Math.min(24,+prompt('Zoom (0–24)','14')||14));if(Number.isFinite(lat)&&Number.isFinite(long))insertSpec({type:'map',attrs:{lat,long,zoom}})},
  collage:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)insertSpec({type:'collage',attrs:{items:[{src:a,alt:'Imagem 1'},{src:b,alt:'Imagem 2'}],caption:'Collage'}})},
  slideshow:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)insertSpec({type:'slideshow',attrs:{items:[{src:a,alt:'Slide 1'},{src:b,alt:'Slide 2'}],caption:'Slideshow'}})},
  reference:()=>{const name=safeName(prompt('Identificador da referência','nota-1')),text=prompt('Texto da referência','Fonte ou nota');if(name&&text!==null)core.insertText(text,[{type:'reference',attrs:{name}}])},
  anchor:()=>{const name=safeName(prompt('Nome da âncora','secao-1'));if(name)insertSpec({type:'anchor',attrs:{name}})},
  time:()=>{const unix=String(prompt('Unix timestamp',String(Math.floor(Date.now()/1000)))||''),label=prompt('Texto exibido','Data e hora');if(/^\d+$/.test(unix)&&label!==null)insertSpec({type:'time',attrs:{unix,format:'wDT',label}})},
  emoji:()=>{const emojiId=prompt('Custom emoji ID','5368324170671202286'),fallback=prompt('Emoji alternativo','👍');if(emojiId&&/^\d+$/.test(emojiId)&&fallback)insertSpec({type:'custom_emoji',attrs:{emojiId,fallback}})},
  button:()=>{
    const type=(prompt('Tipo: url, web_app, copy_text, switch_inline_query, disabled','url')||'').trim(),label=prompt('Texto do botão','Abrir');if(!label)return;
    const button={type,label,style:'',url:'',data:'',text:'',query:''};
    if(type==='url'||type==='web_app'){const value=promptHttp('URL HTTPS');if(!value)return;button.url=value}
    else if(type==='copy_text'){const value=prompt('Texto para copiar','Texto');if(value===null)return;button.text=value}
    else if(type==='switch_inline_query'){button.query=prompt('Consulta inline','')||''}
    else if(type!=='disabled'){say('Tipo não suportado neste editor');return}
    insertSpec({type:'button_row',attrs:{align:'center',buttons:[button]}})
  },
  rtl:()=>{rtl=!rtl;applyOptions();dirty()},
  entities:()=>{skipEntityDetection=!skipEntityDetection;applyOptions();dirty()},
  export:()=>{syncDoc();const blob=new Blob([RMD.exportDocument(doc)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RMDtxtML.rmdtxtml';a.click();URL.revokeObjectURL(url)},
  exporthtml:()=>{const h=currentHtml(),blob=new Blob([h],{type:'text/html'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RMDtxtML-rich-message.html';a.click();URL.revokeObjectURL(url)},
  import:()=>$('#file').click(),
  revision:async()=>{if(!doc?.revisions?.length)return say('Nenhuma revisão salva');const list=doc.revisions.slice(-10).reverse(),choice=prompt('Revisão para restaurar:\n'+list.map(r=>r.revision+' · '+new Date(r.at).toLocaleString('pt-BR')).join('\n'),String(list[0].revision));if(choice===null)return;const rev=Number(choice);if(!Number.isSafeInteger(rev))return say('Revisão inválida');try{doc=await store.restore(doc,rev,{normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;core.setModel(doc.content.model,{history:false});applyOptions();updateStatus('Revisão restaurada');say('Revisão restaurada')}catch{say('Revisão não encontrada')}},
  reset:async()=>{if(confirm('Apagar o documento atual e iniciar um documento vazio?')){doc=await store.reset({model:core.emptyModel(),normalizeModel:m=>core.normalizeModel(m)});rtl=false;skipEntityDetection=false;core.setModel(doc.content.model,{history:false});applyOptions();updateStatus('Novo documento')}}
};
$$('[data-action]').forEach(b=>b.onclick=()=>{closeDrawer();actions[b.dataset.action]?.();queueMicrotask(syncEditorUi)});

$('#file').onchange=async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{
    const text=await f.text();
    if(f.name.toLowerCase().endsWith('.rmdtxtml')||f.type==='application/json'){
      doc=RMD.importDocument(text,{normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});
      core.setModel(doc.content.model,{history:false});rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;applyOptions();
      doc=await store.save(doc,{checkpoint:true,normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});
      updateStatus('Documento importado');say('Documento RMDtxtML importado')
    }else{
      core.setHtml(text,{history:false});syncDoc();doc=await store.save(doc,{checkpoint:true,normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});
      updateStatus('HTML importado');say('Rich HTML importado')
    }
  }catch(error){say(error?.message==='unsupported_schema'?'Versão de documento não suportada':'Arquivo inválido')}
  finally{e.target.value=''}
};
$('#save').onclick=async()=>{try{await persistDocument({checkpoint:true,label:'Salvo'});say('Checkpoint salvo')}catch{updateStatus('Falha ao salvar');say('Não foi possível salvar')}};
$('#previewBtn').onclick=()=>{
  if(previewOpen)return closePreview();
  platform.keyboard();previewOpen=true;$('#preview').innerHTML=currentHtml();$('#preview').dir=rtl?'rtl':'ltr';
  $('#previewWrap').classList.add('open');$('#editWrap').hidden=true;$('#previewBtn').innerHTML='<svg><use href="#i-edit"/></svg>';$('#previewBtn').setAttribute('aria-pressed','true');$('#previewBtn').setAttribute('aria-label','Voltar à edição');
  updateStatus('Prévia');syncBack()
};
$('#back').onclick=()=>platform.close();
async function sendMessage(){
  await RMD.ready;
  const m=metrics();
  if(!m.html)return say('Escreva algum conteúdo');
  if(m.text>MAX_TEXT)return say('A mensagem excede 32.768 caracteres');
  if(!platform.isTelegram())return say('Abra o RMDtxtML pelo Telegram para enviar');
  if(!destinationId)return say('Nenhum destino autorizado disponível');
  if(!sendRequestId)sendRequestId=crypto.randomUUID?.()||('send-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  status.textContent='Enviando…';platform.setMain({text:'Enviando…',visible:true,enabled:false,busy:true,onClick:sendMessage});
  try{
    await platform.json('/api/send',{method:'POST',auth:true,body:{requestId:sendRequestId,destinationId,html:m.html,isRtl:rtl,skipEntityDetection}});
    sendRequestId='';platform.setMain({text:'Enviar',visible:true,enabled:true,busy:false,onClick:sendMessage});updateStatus('Enviado');say('Rich Message enviada');platform.haptic('success');
  }catch(error){platform.setMain({text:'Enviar',visible:true,enabled:true,busy:false,onClick:sendMessage});updateStatus(error?.info?.uncertain?'Resultado indeterminado':'Falha');say(error instanceof Error?error.message:'Falha no envio');platform.haptic('error')}
}
$('#send').onclick=sendMessage;
if(platform.isTelegram())platform.setMain({text:'Enviar',visible:true,enabled:false,onClick:sendMessage});

function applyOptions(){
  ed.dir=rtl?'rtl':'ltr';
  $('#rtlState').textContent=rtl?'Ligado':'Desligado';
  $('#entityState').textContent=skipEntityDetection?'Desligada':'Ligada';
  $('[data-action="rtl"]')?.setAttribute('aria-pressed',String(rtl));
  $('[data-action="entities"]')?.setAttribute('aria-pressed',String(!skipEntityDetection))
}
async function initDocument(){
  const loaded=await store.load({initialModel:core.model(),normalizeModel:m=>core.normalizeModel(m),migrateHtml:h=>core.parseHtml(h)});
  doc=loaded.doc;rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;
  core.setModel(doc.content.model,{history:false});applyOptions();platform.dirty(false);document.documentElement.dataset.dirty='false';syncBack();syncEditorUi();
  updateStatus(loaded.migrated?'Documento migrado para modelo semântico':'Pronto');
  return doc
}
async function initDestinations(){
  if(!platform.isTelegram())return[];
  const result=await platform.json('/api/bootstrap',{method:'POST',auth:true,body:{}});
  const select=$('#destination'),items=Array.isArray(result.destinations)?result.destinations:[];
  select.replaceChildren(...items.map(item=>{const option=document.createElement('option');option.value=String(item.id);option.textContent=String(item.label);return option}));
  const saved=sessionStorage.getItem('rmdtxtml-destination');
  destinationId=items.some(x=>x.id===saved)?saved:String(items[0]?.id||'');
  select.value=destinationId;
  $('#destinationHint').textContent=items.length>1?'Escolha entre os destinos autorizados pelo servidor.':items.length===1?'Destino validado pelo servidor.':'Nenhum destino autorizado.';
  select.disabled=items.length<2;
  select.onchange=()=>{destinationId=select.value;sessionStorage.setItem('rmdtxtml-destination',destinationId)};
  platform.setMain({text:'Enviar',visible:true,enabled:Boolean(destinationId),onClick:sendMessage});
  return items
}
async function init(){
  await initDocument();
  try{await initDestinations()}
  catch(error){platform.setMain({text:'Enviar',visible:true,enabled:false,onClick:sendMessage});updateStatus('Destino indisponível');say(error instanceof Error?error.message:'Falha ao carregar destinos')}
  return doc
}
syncTheme();themeQuery.addEventListener?.('change',syncTheme);platform.on('theme',syncTheme);
RMD.ready=init();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});
window.addEventListener('pagehide',()=>{persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});
platform.on('active',active=>{if(!active)persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});

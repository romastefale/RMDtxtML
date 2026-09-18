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
let doc=null,saveTimer=0,sendRequestId='';

const ALIASES={B:'STRONG',I:'EM',INS:'U',STRIKE:'S',DEL:'S'};
const TAGS=new Set('A B STRONG I EM U INS S STRIKE DEL CODE PRE MARK SUB SUP TG-SPOILER TG-REFERENCE TG-EMOJI TG-TIME TG-MATH H1 H2 H3 H4 H5 H6 P FOOTER HR UL OL LI INPUT BR BLOCKQUOTE CITE ASIDE IMG VIDEO AUDIO TG-DOCUMENT FIGURE FIGCAPTION TG-MAP TG-COLLAGE TG-SLIDESHOW TABLE CAPTION THEAD TBODY TR TH TD DETAILS SUMMARY TG-MATH-BLOCK TG-BUTTON TG-BUTTON-ROW'.split(' '));
const ATTRS={
  A:new Set(['href','name']),CODE:new Set(['class']),OL:new Set(['start','type','reversed']),LI:new Set(['value','type']),INPUT:new Set(['type','checked']),
  BLOCKQUOTE:new Set(['expandable']),IMG:new Set(['src','alt','tg-spoiler']),VIDEO:new Set(['src','tg-spoiler']),AUDIO:new Set(['src']),['TG-DOCUMENT']:new Set(['src']),
  ['TG-MAP']:new Set(['lat','long','zoom']),TABLE:new Set(['bordered','striped','compact']),TH:new Set(['colspan','rowspan','align','valign']),TD:new Set(['colspan','rowspan','align','valign']),
  DETAILS:new Set(['open']),['TG-REFERENCE']:new Set(['name']),['TG-EMOJI']:new Set(['emoji-id']),['TG-TIME']:new Set(['unix','format']),
  ['TG-BUTTON']:new Set(['type','style','url','data','forward-text','request-write-access','query','allow-user-chats','allow-bot-chats','allow-group-chats','allow-channel-chats','text']),
  ['TG-BUTTON-ROW']:new Set(['align'])
};
const BLOCK_SELECTOR='h1,h2,h3,h4,h5,h6,p,footer,pre,ul,ol,blockquote,aside,figure,tg-map,tg-collage,tg-slideshow,table,details,tg-math-block,tg-button-row,hr';
const BOOL_ATTRS=new Set(['checked','reversed','expandable','tg-spoiler','bordered','striped','compact','open','request-write-access','allow-user-chats','allow-bot-chats','allow-group-chats','allow-channel-chats']);

function syncTheme(){const dark=platform.isTelegram()?platform.colorScheme()==='dark':themeQuery.matches;document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light'}
function say(message){toast.textContent=message;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>toast.classList.remove('show'),2200)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function validHref(v){return /^(#|https?:|mailto:|tel:|tg:\/\/user\?id=)/i.test(v)}
function validSrc(v){return /^https?:\/\//i.test(v)||/^tg:\/\/emoji\?id=/i.test(v)}
function validButtonUrl(v){return /^https?:\/\//i.test(v)||/^tg:\/\/user\?id=/i.test(v)}
function allowedAttr(tag,name,value){
  if(name.startsWith('on'))return false;
  const set=ATTRS[tag];
  if(!set?.has(name))return false;
  if(tag==='A'&&name==='href')return validHref(value);
  if(['IMG','VIDEO','AUDIO','TG-DOCUMENT'].includes(tag)&&name==='src')return validSrc(value);
  if(tag==='TG-BUTTON'&&name==='url')return validButtonUrl(value);
  if(tag==='INPUT'&&name==='type')return value.toLowerCase()==='checkbox';
  if(tag==='CODE'&&name==='class')return /^language-[a-z0-9_+.-]+$/i.test(value);
  if(tag==='TG-BUTTON'&&name==='style')return /^(primary|danger|success|link)$/i.test(value);
  if(tag==='TG-BUTTON-ROW'&&name==='align')return /^(left|center|right)$/i.test(value);
  if(['TH','TD'].includes(tag)&&name==='align')return /^(left|center|right)$/i.test(value);
  if(['TH','TD'].includes(tag)&&name==='valign')return /^(top|middle|bottom)$/i.test(value);
  return true;
}
function sanitizeRichHtml(input){
  const doc=new DOMParser().parseFromString('<body>'+String(input??'')+'</body>','text/html');
  const out=document.createElement('div');
  function copy(node){
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.nodeValue||'');
    if(node.nodeType!==Node.ELEMENT_NODE)return document.createDocumentFragment();
    const raw=node.tagName.toUpperCase(),tag=ALIASES[raw]||raw;
    if(!TAGS.has(raw)){
      const f=document.createDocumentFragment();
      [...node.childNodes].forEach(child=>f.append(copy(child)));
      return f;
    }
    const el=document.createElement(tag.toLowerCase());
    for(const attr of [...node.attributes]){
      const name=attr.name.toLowerCase(),value=attr.value;
      if(!allowedAttr(tag,name,value))continue;
      if(BOOL_ATTRS.has(name))el.setAttribute(name,'');else el.setAttribute(name,value);
    }
    [...node.childNodes].forEach(child=>el.append(copy(child)));
    return el;
  }
  [...doc.body.childNodes].forEach(node=>out.append(copy(node)));
  return out.innerHTML.trim();
}
function currentHtml(){return sanitizeRichHtml(ed.innerHTML)}
function metrics(){
  const h=currentHtml();
  const d=new DOMParser().parseFromString('<body>'+h+'</body>','text/html');
  return {html:h,text:[...d.body.textContent].length,blocks:d.body.querySelectorAll(BLOCK_SELECTOR).length};
}
function updateStatus(prefix=''){const m=metrics();status.textContent=`${prefix?prefix+' · ':''}${m.text.toLocaleString('pt-BR')}/${MAX_TEXT.toLocaleString('pt-BR')} caracteres · ${m.blocks} blocos`;status.classList.toggle('danger',m.text>MAX_TEXT)}
function syncDoc(){
  if(!doc)return null;
  doc.content.html=currentHtml();
  doc.options.isRtl=rtl;
  doc.options.skipEntityDetection=skipEntityDetection;
  return doc
}
async function persistDocument({checkpoint=false,label='Salvo'}={}){
  if(!doc)return null;
  syncDoc();
  doc=await store.save(doc,{checkpoint,sanitize:sanitizeRichHtml});
  platform.dirty(false);document.documentElement.dataset.dirty='false';updateStatus(label);
  return doc
}
function schedulePersist(){
  clearTimeout(saveTimer);
  saveTimer=setTimeout(()=>{persistDocument({label:'Salvo automaticamente'}).catch(()=>updateStatus('Falha ao salvar'))},700)
}
function dirty(){sendRequestId='';platform.dirty(true);document.documentElement.dataset.dirty='true';updateStatus('Não salvo');queueMicrotask(syncEditorUi);if(doc)schedulePersist()}
const core=new RMD.Editor(ed,{change:dirty});
const menuIcons={
  ul:'list',ol:'list',task:'list',quote:'quote',expandable:'quote',pullquote:'quote',details:'file',pre:'code',divider:'text',table:'table',
  math:'text',mathblock:'text',image:'media',video:'media',audio:'media',document:'file',map:'media',collage:'media',slideshow:'media',
  reference:'file',anchor:'link',time:'text',emoji:'media',button:'button',rtl:'settings',entities:'settings',
  export:'file',exporthtml:'code',import:'file',revision:'file',server:'settings',reset:'settings'
};
for(const b of $$('[data-action]')){
  const id=menuIcons[b.dataset.action];if(id&&!b.querySelector('svg'))b.insertAdjacentHTML('afterbegin',`<svg class="menuIcon" aria-hidden="true"><use href="#i-${id}"/></svg>`)
}
for(const b of $$('button[title]:not([aria-label])'))b.setAttribute('aria-label',b.title);
function insertHtml(html){core.insert(html)}
function addBlock(html){core.blockHtml(html)}
function wrap(tag,attrs={}){if(!core.format(tag,attrs))say('Selecione um trecho primeiro')}
function run(command){const map={bold:'strong',italic:'em',underline:'u',strikeThrough:'s'};if(map[command])return wrap(map[command]);if(command==='undo')return core.undo();if(command==='redo')return core.redo()}
function promptHttp(label,initial='https://'){const v=prompt(label,initial);if(v===null)return null;if(!/^https?:\/\//i.test(v)){say('Use uma URL HTTP ou HTTPS');return null}return v}
function safeName(value){return String(value||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,64)}

const formatButtons=[
  ['[data-cmd="bold"]','strong'],['[data-cmd="italic"]','em'],['[data-cmd="underline"]','u'],
  ['[data-cmd="strikeThrough"]','s'],['#spoiler','tg-spoiler'],['#code','code'],['#mark','mark'],['#link','a']
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
$('#link').onclick=()=>{const r=core.range(),text=r?.toString()||'',u=prompt('URL','https://t.me/');if(!u)return;if(!validHref(u))return say('URL não suportada');if(r&&!r.collapsed)wrap('a',{href:u});else insertHtml(`<a href="${esc(u)}">${esc(text||'Telegram')}</a>`)};
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
  ul:()=>core.list('ul'),
  ol:()=>core.list('ol'),
  task:()=>addBlock('<ul><li><input type="checkbox"> Tarefa</li><li><input type="checkbox" checked> Concluída</li></ul>'),
  quote:()=>addBlock('<blockquote>Citação<cite>Autor</cite></blockquote>'),
  expandable:()=>addBlock('<blockquote expandable>Citação expansível<br>Conteúdo adicional<cite>Autor</cite></blockquote>'),
  pullquote:()=>addBlock('<aside>Trecho em destaque<cite>Autor</cite></aside>'),
  details:()=>{const title=prompt('Título','Detalhes'),body=prompt('Conteúdo','Conteúdo recolhível.');if(title!==null&&body!==null)addBlock(`<details><summary>${esc(title)}</summary><p>${esc(body)}</p></details>`)},
  pre:()=>{const lang=safeName(prompt('Linguagem (opcional)','javascript')||''),code=prompt('Código','console.log("Olá")');if(code!==null)addBlock(lang?`<pre><code class="language-${esc(lang)}">${esc(code)}</code></pre>`:`<pre>${esc(code)}</pre>`)},
  divider:()=>addBlock('<hr>'),
  math:()=>{const x=prompt('Fórmula LaTeX','x^2 + y^2');if(x)insertHtml(`<tg-math>${esc(x)}</tg-math>`)},
  mathblock:()=>{const x=prompt('Fórmula LaTeX','E = mc^2');if(x)addBlock(`<tg-math-block>${esc(x)}</tg-math-block>`)},
  table:()=>{const rows=Math.max(1,Math.min(100,+prompt('Linhas','3')||1)),cols=Math.max(1,Math.min(20,+prompt('Colunas','3')||1));let h='<table bordered compact><tr>'+Array.from({length:cols},(_,i)=>`<th>Cabeçalho ${i+1}</th>`).join('')+'</tr>';for(let r=1;r<rows;r++)h+='<tr>'+Array.from({length:cols},()=>'<td>Célula</td>').join('')+'</tr>';addBlock(h+'</table>')},
  image:()=>{const u=promptHttp('URL HTTPS da imagem');if(u)addBlock(`<figure><img src="${esc(u)}" alt="Imagem"><figcaption>Imagem</figcaption></figure>`)},
  video:()=>{const u=promptHttp('URL HTTPS do vídeo');if(u)addBlock(`<figure><video src="${esc(u)}"></video><figcaption>Vídeo</figcaption></figure>`)},
  audio:()=>{const u=promptHttp('URL HTTPS do áudio');if(u)addBlock(`<figure><audio src="${esc(u)}"></audio><figcaption>Áudio</figcaption></figure>`)},
  document:()=>{const u=promptHttp('URL HTTPS do documento');if(u)addBlock(`<figure><tg-document src="${esc(u)}"></tg-document><figcaption>Documento</figcaption></figure>`)},
  map:()=>{const lat=Number(prompt('Latitude','-23.5505')),lon=Number(prompt('Longitude','-46.6333')),zoom=Math.max(0,Math.min(24,+prompt('Zoom (0–24)','14')||14));if(Number.isFinite(lat)&&Number.isFinite(lon))addBlock(`<tg-map lat="${lat}" long="${lon}" zoom="${zoom}"></tg-map>`)},
  collage:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)addBlock(`<tg-collage><img src="${esc(a)}" alt="Imagem 1"><img src="${esc(b)}" alt="Imagem 2"><figcaption>Collage</figcaption></tg-collage>`)},
  slideshow:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)addBlock(`<tg-slideshow><img src="${esc(a)}" alt="Slide 1"><img src="${esc(b)}" alt="Slide 2"><figcaption>Slideshow</figcaption></tg-slideshow>`)},
  reference:()=>{const name=safeName(prompt('Identificador da referência','nota-1')),text=prompt('Texto da referência','Fonte ou nota');if(name&&text!==null)addBlock(`<tg-reference name="${esc(name)}">${esc(text)}</tg-reference>`)},
  anchor:()=>{const name=safeName(prompt('Nome da âncora','secao-1'));if(name)insertHtml(`<a name="${esc(name)}"></a>`)},
  time:()=>{const unix=Math.floor(Date.now()/1000),value=prompt('Unix timestamp',String(unix)),label=prompt('Texto exibido','Data e hora');if(value&&/^\d+$/.test(value)&&label!==null)insertHtml(`<tg-time unix="${value}" format="wDT">${esc(label)}</tg-time>`)},
  emoji:()=>{const id=prompt('Custom emoji ID','5368324170671202286'),fallback=prompt('Emoji alternativo','👍');if(id&&/^\d+$/.test(id)&&fallback)addBlock(`<p><tg-emoji emoji-id="${id}">${esc(fallback)}</tg-emoji></p>`)},
  button:()=>{const type=(prompt('Tipo: url, web_app, copy_text, switch_inline_query, disabled','url')||'').trim();const label=prompt('Texto do botão','Abrir');if(!label)return;let attrs=`type="${esc(type)}"`;if(type==='url'||type==='web_app'){const u=promptHttp('URL HTTPS');if(!u)return;attrs+=` url="${esc(u)}"`}else if(type==='copy_text'){const t=prompt('Texto para copiar','Texto');if(t===null)return;attrs+=` text="${esc(t)}"`}else if(type==='switch_inline_query'){const q=prompt('Consulta inline','');attrs+=` query="${esc(q||'')}"`}else if(type!=='disabled'){say('Tipo não suportado neste editor');return}addBlock(`<tg-button-row align="center"><tg-button ${attrs}>${esc(label)}</tg-button></tg-button-row>`)},
  rtl:()=>{rtl=!rtl;applyOptions();dirty()},
  entities:()=>{skipEntityDetection=!skipEntityDetection;applyOptions();dirty()},
  export:()=>{syncDoc();const blob=new Blob([RMD.exportDocument(doc)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RMDtxtML.rmdtxtml';a.click();URL.revokeObjectURL(url)},
  exporthtml:()=>{const h=currentHtml(),blob=new Blob([h],{type:'text/html'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RMDtxtML-rich-message.html';a.click();URL.revokeObjectURL(url)},
  import:()=>$('#file').click(),
  revision:async()=>{if(!doc?.revisions?.length)return say('Nenhuma revisão salva');const list=doc.revisions.slice(-10).reverse(),choice=prompt('Revisão para restaurar:\n'+list.map(r=>r.revision+' · '+new Date(r.at).toLocaleString('pt-BR')).join('\n'),String(list[0].revision));if(choice===null)return;const rev=Number(choice);if(!Number.isSafeInteger(rev))return say('Revisão inválida');try{doc=await store.restore(doc,rev,{sanitize:sanitizeRichHtml});rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;core.setHtml(doc.content.html);applyOptions();updateStatus('Revisão restaurada');say('Revisão restaurada')}catch{say('Revisão não encontrada')}},
  reset:async()=>{if(confirm('Apagar o documento atual e iniciar um documento vazio?')){doc=await store.reset({html:'<p><br></p>',sanitize:sanitizeRichHtml});rtl=false;skipEntityDetection=false;core.setHtml(doc.content.html);applyOptions();updateStatus('Novo documento')}} ,
  server:()=>{const old=platform.api(),u=prompt('URL HTTPS do backend',old);if(u!==null&&/^https:\/\//i.test(u)){localStorage.setItem('rmdtxtml-api-v1',u.replace(/\/+$/,''));say('Servidor salvo')}}
};
$$('[data-action]').forEach(b=>b.onclick=()=>{closeDrawer();if(b.dataset.action==='mark')return wrap('mark');actions[b.dataset.action]?.()});

$('#file').onchange=async e=>{
  const f=e.target.files?.[0];if(!f)return;
  try{
    const text=await f.text();
    if(f.name.toLowerCase().endsWith('.rmdtxtml')||f.type==='application/json'){
      doc=RMD.importDocument(text,{sanitize:sanitizeRichHtml});
      core.setHtml(doc.content.html);rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;applyOptions();
      doc=await store.save(doc,{checkpoint:true,sanitize:sanitizeRichHtml});
      updateStatus('Documento importado');say('Documento RMDtxtML importado')
    }else{
      const html=sanitizeRichHtml(text)||'<p><br></p>';
      core.setHtml(html);syncDoc();doc=await store.save(doc,{checkpoint:true,sanitize:sanitizeRichHtml});
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
ed.onpaste=e=>{const h=e.clipboardData?.getData('text/html');if(h){e.preventDefault();insertHtml(sanitizeRichHtml(h))}};

async function sendMessage(){
  const m=metrics();
  if(!m.html)return say('Escreva algum conteúdo');
  if(m.text>MAX_TEXT)return say('A mensagem excede 32.768 caracteres');
  if(!platform.isTelegram())return say('Abra o RMDtxtML pelo Telegram para enviar');
  const defaultTarget=platform.userId();
  const chatId=prompt('Destino (ID do chat)',defaultTarget);
  if(!chatId)return;
  if(!sendRequestId)sendRequestId=crypto.randomUUID?.()||('send-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2));
  status.textContent='Enviando…';platform.setMain({text:'Enviando…',visible:true,enabled:false,busy:true,onClick:sendMessage});
  try{
    await platform.json('/api/send',{method:'POST',auth:true,body:{requestId:sendRequestId,chatId,html:m.html,isRtl:rtl,skipEntityDetection}});
    sendRequestId='';platform.setMain({text:'Enviar',visible:true,enabled:true,busy:false,onClick:sendMessage});updateStatus('Enviado');say('Rich Message enviada');platform.haptic('success');
  }catch(error){platform.setMain({text:'Enviar',visible:true,enabled:true,busy:false,onClick:sendMessage});updateStatus(error?.info?.uncertain?'Resultado indeterminado':'Falha');say(error instanceof Error?error.message:'Falha no envio');platform.haptic('error')}
}
$('#send').onclick=sendMessage;
if(platform.isTelegram())platform.setMain({text:'Enviar',visible:true,enabled:true,onClick:sendMessage});

function applyOptions(){
  ed.dir=rtl?'rtl':'ltr';
  $('#rtlState').textContent=rtl?'Ligado':'Desligado';
  $('#entityState').textContent=skipEntityDetection?'Desligada':'Ligada';
  $('[data-action="rtl"]')?.setAttribute('aria-pressed',String(rtl));
  $('[data-action="entities"]')?.setAttribute('aria-pressed',String(!skipEntityDetection))
}
async function initDocument(){
  const initial=sanitizeRichHtml(ed.innerHTML)||'<p><br></p>';
  const loaded=await store.load({initialHtml:initial,sanitize:sanitizeRichHtml});
  doc=loaded.doc;rtl=doc.options.isRtl;skipEntityDetection=doc.options.skipEntityDetection;
  core.setHtml(doc.content.html);applyOptions();platform.dirty(false);document.documentElement.dataset.dirty='false';syncBack();syncEditorUi();
  updateStatus(loaded.migrated?'Rascunho migrado':'Pronto');
  return doc
}
syncTheme();themeQuery.addEventListener?.('change',syncTheme);platform.on('theme',syncTheme);
RMD.ready=initDocument();
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden')persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});
window.addEventListener('pagehide',()=>{persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});
platform.on('active',active=>{if(!active)persistDocument({label:'Salvo automaticamente'}).catch(()=>{})});

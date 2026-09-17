const tg=window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const ed=$('#editor');
const status=$('#status');
const drawer=$('#drawer');
const toast=$('#toast');
const KEY='rmdtxtml-draft-v2';
const APIKEY='rmdtxtml-api-v1';
const DEFAULT_API='https://rmdtxtml-api-production.up.railway.app';
const MAX_BYTES=32768;
const themeQuery=matchMedia('(prefers-color-scheme: dark)');
let rtl=false;
let skipEntityDetection=false;

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

function syncTheme(){const inside=!!tg?.initData,dark=inside&&tg.colorScheme?tg.colorScheme==='dark':themeQuery.matches;document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.style.colorScheme=dark?'dark':'light';if(inside){tg.setHeaderColor?.('bg_color');tg.setBackgroundColor?.('bg_color');tg.setBottomBarColor?.('bottom_bar_bg_color')}}
function say(message){toast.textContent=message;toast.classList.add('show');clearTimeout(say.t);say.t=setTimeout(()=>toast.classList.remove('show'),2200)}
function esc(s){return String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function bytes(s){return new TextEncoder().encode(s).length}
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
    const tag=node.tagName.toUpperCase();
    if(!TAGS.has(tag)){
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
  return {html:h,bytes:bytes(h),blocks:d.body.querySelectorAll(BLOCK_SELECTOR).length};
}
function updateStatus(prefix=''){const m=metrics();status.textContent=`${prefix?prefix+' · ':''}${m.bytes.toLocaleString('pt-BR')}/${MAX_BYTES.toLocaleString('pt-BR')} bytes · ${m.blocks} blocos`;status.classList.toggle('danger',m.bytes>MAX_BYTES)}
function dirty(){updateStatus('Não salvo')}
function exec(command,value=null){ed.focus();document.execCommand(command,false,value);dirty()}
function insertHtml(html){ed.focus();document.execCommand('insertHTML',false,html);dirty()}
function addBlock(html){insertHtml(html+'<p><br></p>')}
function wrap(tag,attrs=''){
  ed.focus();const sel=getSelection();
  if(!sel?.rangeCount||sel.getRangeAt(0).collapsed)return say('Selecione um trecho primeiro');
  const range=sel.getRangeAt(0);const el=document.createElement(tag);
  if(attrs)for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);
  try{range.surroundContents(el)}catch{el.append(range.extractContents());range.insertNode(el)}
  sel.removeAllRanges();sel.addRange(range);dirty();
}
function promptHttp(label,initial='https://'){const v=prompt(label,initial);if(v===null)return null;if(!/^https?:\/\//i.test(v)){say('Use uma URL HTTP ou HTTPS');return null}return v}
function safeName(value){return String(value||'').trim().replace(/[^A-Za-z0-9_-]/g,'-').replace(/-+/g,'-').slice(0,64)}

$$('[data-cmd]').forEach(b=>b.addEventListener('click',()=>exec(b.dataset.cmd)));
$('#block').addEventListener('change',e=>exec('formatBlock',e.target.value));
$('#link').onclick=()=>{const text=getSelection()?.toString()||'Telegram',u=prompt('URL','https://t.me/');if(u&&validHref(u))insertHtml(`<a href="${esc(u)}">${esc(text||u)}</a>`);else if(u) say('URL não suportada')};
$('#code').onclick=()=>wrap('code');
$('#spoiler').onclick=()=>wrap('tg-spoiler');
$('#mark').onclick=()=>wrap('mark');
$('#more').onclick=()=>drawer.classList.add('open');
$('#close').onclick=()=>drawer.classList.remove('open');
drawer.onclick=e=>{if(e.target===drawer)drawer.classList.remove('open')};

const actions={
  ul:()=>exec('insertUnorderedList'),
  ol:()=>exec('insertOrderedList'),
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
  image:()=>{const u=promptHttp('URL HTTPS da imagem');if(u)addBlock(`<figure><img src="${esc(u)}"><figcaption>Imagem</figcaption></figure>`)},
  video:()=>{const u=promptHttp('URL HTTPS do vídeo');if(u)addBlock(`<figure><video src="${esc(u)}"></video><figcaption>Vídeo</figcaption></figure>`)},
  audio:()=>{const u=promptHttp('URL HTTPS do áudio');if(u)addBlock(`<figure><audio src="${esc(u)}"></audio><figcaption>Áudio</figcaption></figure>`)},
  document:()=>{const u=promptHttp('URL HTTPS do documento');if(u)addBlock(`<figure><tg-document src="${esc(u)}"></tg-document><figcaption>Documento</figcaption></figure>`)},
  map:()=>{const lat=Number(prompt('Latitude','-23.5505')),lon=Number(prompt('Longitude','-46.6333')),zoom=Math.max(0,Math.min(24,+prompt('Zoom (0–24)','14')||14));if(Number.isFinite(lat)&&Number.isFinite(lon))addBlock(`<tg-map lat="${lat}" long="${lon}" zoom="${zoom}"></tg-map>`)},
  collage:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)addBlock(`<tg-collage><img src="${esc(a)}"><img src="${esc(b)}"><figcaption>Collage</figcaption></tg-collage>`)},
  slideshow:()=>{const a=promptHttp('Primeira imagem'),b=promptHttp('Segunda imagem');if(a&&b)addBlock(`<tg-slideshow><img src="${esc(a)}"><img src="${esc(b)}"><figcaption>Slideshow</figcaption></tg-slideshow>`)},
  reference:()=>{const name=safeName(prompt('Identificador da referência','nota-1')),text=prompt('Texto da referência','Fonte ou nota');if(name&&text!==null)addBlock(`<tg-reference name="${esc(name)}">${esc(text)}</tg-reference>`)},
  anchor:()=>{const name=safeName(prompt('Nome da âncora','secao-1'));if(name)insertHtml(`<a name="${esc(name)}"></a>`)},
  time:()=>{const unix=Math.floor(Date.now()/1000),value=prompt('Unix timestamp',String(unix)),label=prompt('Texto exibido','Data e hora');if(value&&/^\d+$/.test(value)&&label!==null)insertHtml(`<tg-time unix="${value}" format="wDT">${esc(label)}</tg-time>`)},
  emoji:()=>{const id=prompt('Custom emoji ID','5368324170671202286'),fallback=prompt('Emoji alternativo','👍');if(id&&/^\d+$/.test(id)&&fallback)addBlock(`<p><tg-emoji emoji-id="${id}">${esc(fallback)}</tg-emoji></p>`)},
  button:()=>{const type=(prompt('Tipo: url, web_app, copy_text, switch_inline_query, disabled','url')||'').trim();const label=prompt('Texto do botão','Abrir');if(!label)return;let attrs=`type="${esc(type)}"`;if(type==='url'||type==='web_app'){const u=promptHttp('URL HTTPS');if(!u)return;attrs+=` url="${esc(u)}"`}else if(type==='copy_text'){const t=prompt('Texto para copiar','Texto');if(t===null)return;attrs+=` text="${esc(t)}"`}else if(type==='switch_inline_query'){const q=prompt('Consulta inline','');attrs+=` query="${esc(q||'')}"`}else if(type!=='disabled'){say('Tipo não suportado neste editor');return}addBlock(`<tg-button-row align="center"><tg-button ${attrs}>${esc(label)}</tg-button></tg-button-row>`)},
  rtl:()=>{rtl=!rtl;ed.dir=rtl?'rtl':'ltr';$('#rtlState').textContent=rtl?'Ligado':'Desligado';dirty()},
  entities:()=>{skipEntityDetection=!skipEntityDetection;$('#entityState').textContent=skipEntityDetection?'Desligada':'Ligada';dirty()},
  export:()=>{const h=currentHtml(),blob=new Blob([h],{type:'text/html'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='RMDtxtML-rich-message.html';a.click();URL.revokeObjectURL(url)},
  import:()=>$('#file').click(),
  reset:()=>{if(confirm('Apagar o rascunho local e iniciar um documento vazio?')){ed.innerHTML='<p><br></p>';rtl=false;skipEntityDetection=false;ed.dir='ltr';localStorage.removeItem(KEY);dirty()}},
  server:()=>{const old=localStorage.getItem(APIKEY)||DEFAULT_API,u=prompt('URL HTTPS do backend',old);if(u!==null&&/^https:\/\//i.test(u)){localStorage.setItem(APIKEY,u.replace(/\/+$/,''));say('Servidor salvo')}}
};
$('[data-action]').forEach(b=>b.onclick=()=>{drawer.classList.remove('open');if(b.dataset.action==='mark')return wrap('mark');actions[b.dataset.action]?.()});

$('#file').onchange=async e=>{const f=e.target.files?.[0];if(!f)return;const text=await f.text();ed.innerHTML=sanitizeRichHtml(text)||'<p><br></p>';e.target.value='';dirty()};
$('#save').onclick=()=>{const m=metrics();localStorage.setItem(KEY,JSON.stringify({html:m.html,rtl,skipEntityDetection}));updateStatus('Salvo');say('Rascunho salvo')};
$('#previewBtn').onclick=()=>{const wrap=$('#previewWrap'),open=!wrap.classList.contains('open');if(open){$('#preview').innerHTML=currentHtml();$('#preview').dir=rtl?'rtl':'ltr'}wrap.classList.toggle('open',open);$('#editWrap').hidden=open;$('#previewBtn').textContent=open?'✕':'◉';updateStatus(open?'Prévia':'Edição')};
$('#back').onclick=()=>tg?.close?tg.close():history.back();
ed.oninput=dirty;
ed.onpaste=e=>{const h=e.clipboardData?.getData('text/html');if(h){e.preventDefault();insertHtml(sanitizeRichHtml(h))}};

$('#send').onclick=async()=>{
  const m=metrics();
  if(!m.html)return say('Escreva algum conteúdo');
  if(m.bytes>MAX_BYTES)return say('A mensagem excede 32.768 bytes');
  if(!tg?.initData)return say('Abra o RMDtxtML pelo Telegram para enviar');
  const defaultTarget=String(tg.initDataUnsafe?.user?.id||'');
  const chatId=prompt('Destino (ID do chat)',defaultTarget);
  if(!chatId)return;
  const api=(localStorage.getItem(APIKEY)||DEFAULT_API).replace(/\/+$/,'');
  status.textContent='Enviando…';
  try{
    const response=await fetch(api+'/api/send',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({initData:tg.initData,chatId,html:m.html,isRtl:rtl,skipEntityDetection})});
    const result=await response.json().catch(()=>({ok:false,error:`HTTP ${response.status}`}));
    if(!response.ok||!result.ok)throw new Error(result.error||`HTTP ${response.status}`);
    updateStatus('Enviado');say('Rich Message enviada');tg?.HapticFeedback?.notificationOccurred?.('success');
  }catch(error){updateStatus('Falha');say(error instanceof Error?error.message:'Falha no envio');tg?.HapticFeedback?.notificationOccurred?.('error')}
};

try{const saved=JSON.parse(localStorage.getItem(KEY)||'null');if(saved?.html){ed.innerHTML=sanitizeRichHtml(saved.html)||'<p><br></p>';rtl=saved.rtl===true;skipEntityDetection=saved.skipEntityDetection===true}}catch{}
ed.dir=rtl?'rtl':'ltr';
$('#rtlState').textContent=rtl?'Ligado':'Desligado';
$('#entityState').textContent=skipEntityDetection?'Desligada':'Ligada';
syncTheme();
themeQuery.addEventListener?.('change',syncTheme);tg?.onEvent?.('themeChanged',syncTheme);
updateStatus('Pronto');

import crypto from 'node:crypto';

export function signInitData(fields,botToken){const params=new URLSearchParams();for(const[key,value]of Object.entries(fields))params.set(key,String(value));const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();const hash=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');params.set('hash',hash);return params.toString()}
export function validateInitData(initData,botToken,{maxAgeSeconds=86400,now=Date.now()}={}){if(!initData||!botToken)return{ok:false,error:'missing_init_data'};const params=new URLSearchParams(initData);const receivedHash=params.get('hash');if(!receivedHash||!/^[a-f0-9]{64}$/i.test(receivedHash))return{ok:false,error:'invalid_hash'};const authDate=Number(params.get('auth_date')||0),nowSeconds=Math.floor(now/1000);if(!Number.isSafeInteger(authDate)||authDate<=0||authDate>nowSeconds+30)return{ok:false,error:'invalid_auth_date'};if(nowSeconds-authDate>maxAgeSeconds)return{ok:false,error:'expired'};params.delete('hash');const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();const expected=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');const a=Buffer.from(receivedHash,'hex'),b=Buffer.from(expected,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return{ok:false,error:'signature_mismatch'};let user=null;const rawUser=params.get('user');if(rawUser){try{user=JSON.parse(rawUser)}catch{return{ok:false,error:'invalid_user'}}}return{ok:true,authDate,user,params}}

export function destinationId(chatId,secret){return'd_'+crypto.createHmac('sha256',secret).update('rmdtxtml:destination:'+String(chatId)).digest('base64url').slice(0,22)}
function enabled(value){return /^(1|true|yes|on)$/i.test(String(value||''))}
function destinationAllowed(item,userId,{allowGlobal=false}={}){
  const acl=item?.user_ids??item?.users??item?.allow_user_ids;
  if(item?.public===true||acl==='*')return true;
  if(Array.isArray(acl))return acl.map(String).includes(String(userId));
  if(typeof acl==='string'&&acl.trim())return acl.split(',').map(x=>x.trim()).filter(Boolean).includes(String(userId));
  return allowGlobal
}
export function authorizedDestinations(validated,env=process.env,secret=''){
  const out=[],seen=new Set(),requested=String(env.SEND_SCOPE||'self').toLowerCase(),scope=['none','self','configured','all'].includes(requested)?requested:'self',userId=validated?.user?.id;
  if(userId!==undefined&&userId!==null&&(scope==='self'||scope==='all')){
    const chatId=String(userId);out.push({id:'self',label:'Minhas mensagens',chatId});seen.add(chatId)
  }
  if(userId===undefined||userId===null||!(scope==='configured'||scope==='all'))return out;
  const allowGlobal=enabled(env.ALLOW_GLOBAL_DESTINATIONS);
  let configured=[];
  try{const parsed=JSON.parse(env.AUTHORIZED_DESTINATIONS||'[]');if(Array.isArray(parsed))configured=parsed}catch{}
  for(const item of configured){
    if(!destinationAllowed(item,userId,{allowGlobal}))continue;
    const chatId=String(item?.chat_id??item?.chatId??'').trim();if(!chatId||seen.has(chatId))continue;
    const label=String(item?.label||item?.name||'Destino autorizado').trim().slice(0,80)||'Destino autorizado';
    out.push({id:destinationId(chatId,secret),label,chatId});seen.add(chatId)
  }
  if(allowGlobal)for(const raw of String(env.ALLOWED_CHAT_IDS||'').split(',')){
    const chatId=raw.trim();if(!chatId||seen.has(chatId))continue;
    out.push({id:destinationId(chatId,secret),label:'Destino autorizado',chatId});seen.add(chatId)
  }
  return out
}
export function publicDestinations(validated,env=process.env,secret=''){return authorizedDestinations(validated,env,secret).map(({id,label})=>({id,label}))}
export function resolveDestination(id,validated,env=process.env,secret=''){const value=String(id||'').trim();return authorizedDestinations(validated,env,secret).find(x=>x.id===value)?.chatId||null}

const BLOCK_TAGS=new Set(['p','h1','h2','h3','h4','h5','h6','footer','hr','ul','ol','li','blockquote','aside','pre','tg-math-block','tg-collage','tg-slideshow','table','tr','details','tg-map','tg-button-row','figure','img','video','audio','tg-document']);
const VOID_TAGS=new Set(['hr','br','img','input']);
function richStructure(html){
  const stack=[];let blocks=0,maxDepth=0,media=0;
  const tableStack=[];
  for(const match of html.matchAll(/<\s*(\/?)\s*([a-z][\w-]*)\b([^>]*)>/gi)){
    const closing=!!match[1],tag=match[2].toLowerCase(),attrs=match[3]||'',selfClosing=/\/\s*$/.test(attrs)||VOID_TAGS.has(tag);
    if(closing){
      for(let i=stack.length-1;i>=0;i--)if(stack[i]===tag){stack.length=i;break}
      if(tag==='table')tableStack.pop();
      continue;
    }
    if(BLOCK_TAGS.has(tag))blocks++;
    if(['img','video','audio','tg-document'].includes(tag))media++;
    if(tag==='table')tableStack.push({maxCols:0,currentCols:0,inRow:false});
    const table=tableStack.at(-1);
    if(table){if(tag==='tr'){table.currentCols=0;table.inRow=true}if(table.inRow&&(tag==='td'||tag==='th')){const col=Number(/\bcolspan\s*=\s*["']?(\d+)/i.exec(attrs)?.[1]||1);table.currentCols+=Number.isFinite(col)&&col>0?col:1;table.maxCols=Math.max(table.maxCols,table.currentCols)}if(tag==='tr'&&selfClosing)table.inRow=false;if(table.maxCols>20)return{ok:false,error:'too_many_table_columns'}}
    if(!selfClosing){stack.push(tag);maxDepth=Math.max(maxDepth,stack.length)}
    if(blocks>500)return{ok:false,error:'too_many_blocks'};
    if(maxDepth>16)return{ok:false,error:'nesting_too_deep'};
    if(media>50)return{ok:false,error:'too_many_media'};
  }
  return{ok:true,blocks,maxDepth,media};
}
function richTextLength(html){return [...html.replace(/<[^>]*>/g,'').replace(/&(?:#\d+|#x[\da-f]+|lt|gt|amp|quot|apos|nbsp|hellip|mdash|ndash|lsquo|rsquo|ldquo|rdquo);/gi,'x')].length}
export function validateRichHtml(html){if(typeof html!=='string')return{ok:false,error:'html_required'};const trimmed=html.trim();if(!trimmed)return{ok:false,error:'empty_message'};if(richTextLength(trimmed)>32768)return{ok:false,error:'text_too_long'};if(/<\s*(script|iframe|object|embed|style|link|meta)\b/i.test(trimmed))return{ok:false,error:'unsafe_tag'};if(/<[^>]+\son[a-z]+\s*=/i.test(trimmed))return{ok:false,error:'unsafe_attribute'};if(/<[^>]+\b(?:href|src|url)\s*=\s*(['"]?)\s*javascript:/i.test(trimmed))return{ok:false,error:'unsafe_url'};const structure=richStructure(trimmed);if(!structure.ok)return structure;return{ok:true,html:trimmed,...structure}}

function richTextCount(value){
  if(typeof value==='string')return[...value].length;
  if(Array.isArray(value))return value.reduce((n,x)=>n+richTextCount(x),0);
  if(!value||typeof value!=='object')return 0;
  if(value.type==='custom_emoji')return[...String(value.alternative_text||'')].length;
  if(value.type==='mathematical_expression')return[...String(value.expression||'')].length;
  if(value.type==='anchor')return 0;
  if(value.type==='button')return richTextCount(value.button?.text);
  return richTextCount(value.text)
}
function safeHttp(value){return /^https?:\/\//i.test(String(value||''))}
function inspectBlocks(blocks){
  if(!Array.isArray(blocks)||!blocks.length)return{ok:false,error:'blocks_required'};
  let count=0,depth=0,media=0,text=0;
  const walk=(items,level)=>{
    if(level>16)throw new Error('nesting_too_deep');
    depth=Math.max(depth,level);
    for(const block of items){
      if(!block||typeof block!=='object')throw new Error('invalid_block');
      count++;if(count>500)throw new Error('too_many_blocks');
      const type=String(block.type||'');
      if(!['paragraph','heading','pre','footer','divider','mathematical_expression','anchor','list','blockquote','expandable_blockquote','pullquote','collage','slideshow','table','details','map','buttons','animation','audio','document','photo','video','voice_note'].includes(type))throw new Error('unsupported_block');
      text+=richTextCount(block.text)+richTextCount(block.summary)+richTextCount(block.caption?.text)+richTextCount(block.caption?.credit)+richTextCount(block.credit);
      if(type==='heading'&&(!Number.isInteger(block.size)||block.size<1||block.size>6))throw new Error('invalid_heading');
      if(type==='list'){
        if(!Array.isArray(block.items)||!block.items.length)throw new Error('invalid_list');
        for(const item of block.items){
          if(item?.type&&!['1','a','A','i','I'].includes(item.type))throw new Error('invalid_list_type');
          if(item?.value!==undefined&&!Number.isSafeInteger(item.value))throw new Error('invalid_list_value');
          walk(item?.blocks||[],level+1)
        }
      }
      if(type==='blockquote')walk(block.blocks||[],level+1);
      if(type==='details')walk(block.blocks||[],level+1);
      if(type==='collage'||type==='slideshow')walk(block.blocks||[],level+1);
      if(type==='table'){
        if(!Array.isArray(block.cells)||!block.cells.length)throw new Error('invalid_table');
        for(const row of block.cells){
          if(!Array.isArray(row)||!row.length)throw new Error('invalid_table');
          let columns=0;
          for(const cell of row){
            text+=richTextCount(cell?.text);
            const colspan=cell?.colspan===undefined?1:Number(cell.colspan),rowspan=cell?.rowspan===undefined?1:Number(cell.rowspan);
            if(!Number.isInteger(colspan)||colspan<1||colspan>20||!Number.isInteger(rowspan)||rowspan<1||rowspan>100)throw new Error('invalid_table_span');
            if(cell?.align!==undefined&&!['left','center','right'].includes(cell.align))throw new Error('invalid_table_align');
            if(cell?.valign!==undefined&&!['top','middle','bottom'].includes(cell.valign))throw new Error('invalid_table_valign');
            columns+=colspan
          }
          if(columns>20)throw new Error('too_many_table_columns')
        }
      }
      if(type==='map'){
        const loc=block.location||{},w=Number(block.width||0),h=Number(block.height||0);
        if(!Number.isFinite(loc.latitude)||loc.latitude<-90||loc.latitude>90||!Number.isFinite(loc.longitude)||loc.longitude<-180||loc.longitude>180)throw new Error('invalid_map');
        if(block.zoom!==undefined&&(!Number.isInteger(block.zoom)||block.zoom<0||block.zoom>24))throw new Error('invalid_map');
        if(w<0||h<0||w>10000||h>10000||(w&&h&&(w+h>10000||Math.max(w/h,h/w)>20)))throw new Error('invalid_map')
      }
      if(type==='buttons'){
        if(!Array.isArray(block.buttons)||block.buttons.length<1||block.buttons.length>8)throw new Error('invalid_buttons');
        for(const button of block.buttons){
          text+=richTextCount(button?.text);
          const keys=['url','callback_data','web_app','login_url','switch_inline_query','switch_inline_query_current_chat','switch_inline_query_chosen_chat','copy_text','disabled'].filter(k=>button?.[k]!==undefined);
          if(keys.length!==1)throw new Error('invalid_button');
          const kind=keys[0];
          if(button.style&&!['danger','success','primary','link'].includes(button.style))throw new Error('invalid_button_style');
          if(button.style==='link'&&kind!=='callback_data')throw new Error('invalid_button_style');
          if(kind==='url'&&!safeHttp(button.url))throw new Error('invalid_button_url');
          if(kind==='web_app'&&!safeHttp(button.web_app?.url))throw new Error('invalid_button_url');
          if(kind==='login_url'&&!safeHttp(button.login_url?.url))throw new Error('invalid_button_url');
          if(kind==='callback_data'){
            const bytes=Buffer.byteLength(String(button.callback_data||''),'utf8');
            if(bytes<1||bytes>64)throw new Error('invalid_callback_data')
          }
          if(kind==='copy_text'&&!String(button.copy_text?.text||''))throw new Error('invalid_copy_text')
        }
      }
      if(['photo','video','audio','document','animation','voice_note'].includes(type)){
        media++;if(media>50)throw new Error('too_many_media');
        const field=type==='photo'?'photo':type==='voice_note'?'voice_note':type;
        if(!safeHttp(block[field]?.media))throw new Error('invalid_media')
      }
    }
  };
  try{walk(blocks,1)}catch(error){return{ok:false,error:error.message||'invalid_blocks'}}
  if(text>32768)return{ok:false,error:'text_too_long'};
  return{ok:true,blocks,count,depth,media,text}
}
export function validateRichMessage(input){
  if(!input||typeof input!=='object')return{ok:false,error:'rich_message_required'};
  const modes=['html','markdown','blocks'].filter(key=>input[key]!==undefined);
  if(modes.length!==1)return{ok:false,error:'exactly_one_rich_representation_required'};
  const common={...(input.is_rtl===true?{is_rtl:true}:{}),...(input.skip_entity_detection===true?{skip_entity_detection:true}:{})};
  if(modes[0]==='html'){const checked=validateRichHtml(input.html);return checked.ok?{...checked,richMessage:{html:checked.html,...common}}:checked}
  if(modes[0]==='markdown'){
    if(typeof input.markdown!=='string'||!input.markdown.trim())return{ok:false,error:'markdown_required'};
    if([...input.markdown].length>32768)return{ok:false,error:'text_too_long'};
    return{ok:true,richMessage:{markdown:input.markdown,...common}}
  }
  const checked=inspectBlocks(input.blocks);return checked.ok?{...checked,richMessage:{blocks:input.blocks,...common}}:checked
}

export async function telegramCall(token,method,body,{fetchImpl=fetch,timeoutMs=15000}={}){
  let response;
  try{
    const options={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)};
    if(typeof AbortSignal?.timeout==='function')options.signal=AbortSignal.timeout(Math.max(1000,Number(timeoutMs)||15000));
    response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,options)
  }catch(error){if(error&&typeof error==='object')error.telegramResponse=false;throw error}
  let data;
  try{data=await response.json()}catch{const error=new Error(`Telegram retornou HTTP ${response.status} sem JSON válido`);error.telegramResponse=false;throw error}
  if(data?.ok===false){const error=new Error(data?.description||`Telegram HTTP ${response.status}`);error.telegramResponse=true;throw error}
  if(!response.ok||data?.ok!==true){const error=new Error(data?.description||`Telegram HTTP ${response.status}`);error.telegramResponse=false;throw error}
  return data
}

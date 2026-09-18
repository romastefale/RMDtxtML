import crypto from 'node:crypto';

export function signInitData(fields,botToken){const params=new URLSearchParams();for(const[key,value]of Object.entries(fields))params.set(key,String(value));const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();const hash=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');params.set('hash',hash);return params.toString()}
export function validateInitData(initData,botToken,{maxAgeSeconds=86400,now=Date.now()}={}){if(!initData||!botToken)return{ok:false,error:'missing_init_data'};const params=new URLSearchParams(initData);const receivedHash=params.get('hash');if(!receivedHash||!/^[a-f0-9]{64}$/i.test(receivedHash))return{ok:false,error:'invalid_hash'};const authDate=Number(params.get('auth_date')||0),nowSeconds=Math.floor(now/1000);if(!Number.isSafeInteger(authDate)||authDate<=0||authDate>nowSeconds+30)return{ok:false,error:'invalid_auth_date'};if(nowSeconds-authDate>maxAgeSeconds)return{ok:false,error:'expired'};params.delete('hash');const dataCheck=[...params.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');const secret=crypto.createHmac('sha256','WebAppData').update(botToken).digest();const expected=crypto.createHmac('sha256',secret).update(dataCheck).digest('hex');const a=Buffer.from(receivedHash,'hex'),b=Buffer.from(expected,'hex');if(a.length!==b.length||!crypto.timingSafeEqual(a,b))return{ok:false,error:'signature_mismatch'};let user=null;const rawUser=params.get('user');if(rawUser){try{user=JSON.parse(rawUser)}catch{return{ok:false,error:'invalid_user'}}}return{ok:true,authDate,user,params}}
export function isAllowedTarget(chatId,validated,env=process.env){const target=String(chatId).trim();if(!target)return false;const scope=(env.SEND_SCOPE||'self').toLowerCase();if(scope==='any')return true;const allowed=new Set((env.ALLOWED_CHAT_IDS||'').split(',').map(x=>x.trim()).filter(Boolean));if(allowed.has(target))return true;const userId=validated?.user?.id;return userId!==undefined&&userId!==null&&String(userId)===target}

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
export async function telegramCall(token,method,body,{fetchImpl=fetch}={}){let response;try{response=await fetchImpl(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})}catch(error){if(error&&typeof error==='object')error.telegramResponse=false;throw error}let data;try{data=await response.json()}catch{const error=new Error(`Telegram retornou HTTP ${response.status} sem JSON válido`);error.telegramResponse=false;throw error}if(data?.ok===false){const error=new Error(data?.description||`Telegram HTTP ${response.status}`);error.telegramResponse=true;throw error}if(!response.ok||data?.ok!==true){const error=new Error(data?.description||`Telegram HTTP ${response.status}`);error.telegramResponse=false;throw error}return data}

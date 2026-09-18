import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile,stat} from 'node:fs/promises';
import {Store} from './store.mjs';
import {publicDestinations,resolveDestination,telegramCall,validateInitData,validateRichHtml} from './telegram.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../docs');
const version=process.env.APP_VERSION||'1.1.0-rc.1';
const port=Number(process.env.PORT||3000),maxBody=512*1024;
const mime=new Map([
  ['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],
  ['.json','application/json; charset=utf-8'],['.svg','image/svg+xml'],['.png','image/png'],['.ico','image/x-icon']
]);
let botName='';

function json(res,status,body,extraHeaders={}){
  const data=Buffer.from(JSON.stringify(body));
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','content-length':data.length,'cache-control':'no-store','x-content-type-options':'nosniff',...extraHeaders});
  res.end(data)
}
function origins(env){return new Set(String(env.ALLOWED_ORIGINS||'').split(',').map(v=>v.trim().replace(/\/$/,'')).filter(Boolean))}
function origin(req){return String(req.headers.origin||'').trim().replace(/\/$/,'')}
function trustedOrigin(req,env){const value=origin(req);return !value||origins(env).has(value)}
function corsHeaders(req,env){
  const value=origin(req);if(!value)return{};
  if(!origins(env).has(value))return{'vary':'Origin'};
  return{'access-control-allow-origin':value,'access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type','access-control-max-age':'86400','vary':'Origin'}
}
function clientIp(req){return String(req.headers['cf-connecting-ip']||req.headers['x-forwarded-for']||req.socket.remoteAddress||'').split(',')[0].trim()||'unknown'}
function limit(data,bucket,value,{fallback=20,windowMs=60_000}={}){
  const n=Math.max(1,Math.min(1000,Number(value||fallback)));
  const result=data.rate(bucket,{limit:n,windowMs});
  return{...result,retryAfter:Math.max(1,Math.ceil((result.resetsAt-Date.now())/1000))}
}
async function bodyJson(req){
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>maxBody)throw Object.assign(new Error('Corpo da requisição excede o limite'),{status:413});chunks.push(chunk)}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}')}catch{throw Object.assign(new Error('JSON inválido'),{status:400})}
}
async function botUsername(botToken,env,fetchImpl){
  if(env.BOT_USERNAME)return String(env.BOT_USERNAME).replace(/^@/,'');
  if(botName)return botName;
  if(!botToken)return'';
  const result=await telegramCall(botToken,'getMe',{}, {fetchImpl});
  botName=String(result?.result?.username||'');
  return botName
}
function transferDocument(input){
  const id=typeof input?.id==='string'?input.id.trim():'',revision=Number(input?.revision);
  if(!/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/.test(id))return null;
  return{id,revision:Number.isSafeInteger(revision)&&revision>=0?revision:0}
}
function validRequestId(value){return typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{15,79}$/.test(value)}
function transferSemantic(input){
  if(input===undefined||input===null)return null;
  if(typeof input!=='object'||input.schema!==2||input.format!=='semantic'||!input.model||typeof input.model!=='object')return false;
  let encoded;try{encoded=JSON.stringify(input.model)}catch{return false}
  if(encoded.length>300000)return false;
  return{schema:2,format:'semantic',model:input.model}
}

async function createTransfer(req,res,{botToken,env,fetchImpl,headers,data}){
  if(!trustedOrigin(req,env))return json(res,403,{ok:false,error:'Origem não autorizada'},headers);
  const gate=limit(data,'transfer:'+clientIp(req),env.TRANSFER_RATE_LIMIT);
  if(!gate.ok)return json(res,429,{ok:false,error:'Muitas transferências; tente novamente em instantes'},{...headers,'retry-after':gate.retryAfter});
  const input=await bodyJson(req),checked=validateRichHtml(input.html),semantic=transferSemantic(input.semantic);
  if(!checked.ok)return json(res,400,{ok:false,error:`Conteúdo inválido: ${checked.error}`},headers);
  if(semantic===false)return json(res,400,{ok:false,error:'Documento semântico inválido'},headers);
  let username;
  try{username=await botUsername(botToken,env,fetchImpl)}catch{return json(res,502,{ok:false,error:'Não foi possível identificar o bot'},headers)}
  if(!username)return json(res,503,{ok:false,error:'Bot sem username configurado'},headers);
  const token=crypto.randomBytes(24).toString('base64url');
  const ttl=Math.max(60,Math.min(3600,Number(env.TRANSFER_TTL_SECONDS||900)));
  const expiresAt=Date.now()+ttl*1000;
  data.createTransfer({token,html:checked.html,isRtl:input.isRtl===true,skipEntityDetection:input.skipEntityDetection===true,document:transferDocument(input.document),semantic,expiresAt});
  return json(res,201,{ok:true,token,expiresAt,telegramUrl:`https://t.me/${encodeURIComponent(username)}?startapp=${token}`},headers)
}

async function claimTransfer(req,res,{botToken,env,headers,data}){
  if(!trustedOrigin(req,env))return json(res,403,{ok:false,error:'Origem não autorizada'},headers);
  if(!botToken)return json(res,503,{ok:false,error:'BOT_TOKEN não configurado no servidor'},headers);
  const gate=limit(data,'claim:'+clientIp(req),env.CLAIM_RATE_LIMIT,{fallback:30});
  if(!gate.ok)return json(res,429,{ok:false,error:'Muitas tentativas de transferência'},{...headers,'retry-after':gate.retryAfter});
  const input=await bodyJson(req);
  const validated=validateInitData(typeof input.initData==='string'?input.initData:'',botToken,{maxAgeSeconds:Number(env.INIT_DATA_MAX_AGE||86400)});
  if(!validated.ok)return json(res,401,{ok:false,error:`Sessão Telegram inválida: ${validated.error}`},headers);
  const token=typeof input.token==='string'?input.token:'';
  if(!/^[A-Za-z0-9_-]{32}$/.test(token))return json(res,400,{ok:false,error:'Transferência inválida'},headers);
  const transfer=data.claimTransfer(token);
  if(!transfer)return json(res,404,{ok:false,error:'Transferência expirada ou já utilizada'},headers);
  return json(res,200,{ok:true,transfer},headers)
}

async function bootstrap(req,res,{token,env,headers}){
  if(!trustedOrigin(req,env))return json(res,403,{ok:false,error:'Origem não autorizada'},headers);
  if(!token)return json(res,503,{ok:false,error:'BOT_TOKEN não configurado no servidor'},headers);
  const input=await bodyJson(req);
  const validated=validateInitData(typeof input.initData==='string'?input.initData:'',token,{maxAgeSeconds:Number(env.INIT_DATA_MAX_AGE||86400)});
  if(!validated.ok)return json(res,401,{ok:false,error:`Sessão Telegram inválida: ${validated.error}`},headers);
  return json(res,200,{ok:true,destinations:publicDestinations(validated,env,token)},headers)
}

async function send(req,res,{token,env,fetchImpl,headers,data}){
  if(!trustedOrigin(req,env))return json(res,403,{ok:false,error:'Origem não autorizada'},headers);
  if(!token)return json(res,503,{ok:false,error:'BOT_TOKEN não configurado no servidor'},headers);
  const input=await bodyJson(req);
  const validated=validateInitData(typeof input.initData==='string'?input.initData:'',token,{maxAgeSeconds:Number(env.INIT_DATA_MAX_AGE||86400)});
  if(!validated.ok)return json(res,401,{ok:false,error:`Sessão Telegram inválida: ${validated.error}`},headers);
  const userId=validated?.user?.id===undefined?'':String(validated.user.id);
  if(!userId)return json(res,401,{ok:false,error:'Sessão Telegram sem usuário'},headers);
  const gate=limit(data,'send:'+userId,env.SEND_RATE_LIMIT,{fallback:20});
  if(!gate.ok)return json(res,429,{ok:false,error:'Muitos envios; tente novamente em instantes'},{...headers,'retry-after':gate.retryAfter});
  const requestId=typeof input.requestId==='string'?input.requestId:'';
  if(!validRequestId(requestId))return json(res,400,{ok:false,error:'requestId inválido'},headers);
  const chatId=resolveDestination(input.destinationId,validated,env,token);
  if(!chatId)return json(res,403,{ok:false,error:'Destino não autorizado para esta Mini App'},headers);
  const checked=validateRichHtml(input.html);
  if(!checked.ok)return json(res,400,{ok:false,error:`Conteúdo inválido: ${checked.error}`},headers);

  const previous=data.sendState(userId,requestId);
  if(previous?.state==='done')return json(res,200,{ok:true,result:previous.response,idempotent:true},headers);
  if(previous?.state==='pending'||previous?.state==='uncertain')return json(res,409,{ok:false,error:'Este envio já foi iniciado; o resultado anterior ainda é indeterminado',requestId,uncertain:true},headers);
  if(!data.beginSend(userId,requestId)){
    const current=data.sendState(userId,requestId);
    if(current?.state==='done')return json(res,200,{ok:true,result:current.response,idempotent:true},headers);
    return json(res,409,{ok:false,error:'Este envio já está em processamento',requestId},headers)
  }

  const richMessage={html:checked.html};
  if(input.isRtl===true)richMessage.is_rtl=true;
  if(input.skipEntityDetection===true)richMessage.skip_entity_detection=true;
  try{
    const result=await telegramCall(token,'sendRichMessage',{chat_id:chatId,rich_message:richMessage,disable_notification:input.disableNotification===true,protect_content:input.protectContent===true},{fetchImpl});
    data.completeSend(userId,requestId,result.result);
    return json(res,200,{ok:true,result:result.result,requestId},headers)
  }catch(error){
    if(error?.telegramResponse===true)data.releaseSend(userId,requestId);else data.markUncertain(userId,requestId);
    const message=error?.telegramResponse===true
      ?(error instanceof Error?error.message:'Telegram recusou o envio')
      :'Falha de rede após iniciar o envio; o resultado é indeterminado e o mesmo requestId não será reenviado automaticamente';
    return json(res,502,{ok:false,error:message,requestId,uncertain:error?.telegramResponse!==true},headers)
  }
}

async function serveStatic(req,res){
  const url=new URL(req.url,'http://local');let pathname=decodeURIComponent(url.pathname);
  if(pathname==='/')pathname='/index.html';
  const candidate=path.resolve(root,'.'+pathname);
  if(!candidate.startsWith(root+path.sep)&&candidate!==root)return json(res,403,{ok:false,error:'forbidden'});
  try{
    const info=await stat(candidate);if(!info.isFile())throw new Error('not_file');
    const data=await readFile(candidate);
    res.writeHead(200,{'content-type':mime.get(path.extname(candidate))||'application/octet-stream','content-length':data.length,'cache-control':path.extname(candidate)==='.html'?'no-cache':'public, max-age=300','x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=()'});
    res.end(req.method==='HEAD'?undefined:data)
  }catch{
    if(pathname!=='/index.html'&&!path.extname(pathname)){req.url='/index.html';return serveStatic(req,res)}
    return json(res,404,{ok:false,error:'not_found'})
  }
}

export function createServer({botToken=process.env.BOT_TOKEN||'',env=process.env,fetchImpl=fetch,store}={}){
  const token=botToken,data=store||new Store({env}),ownsStore=!store;
  const server=http.createServer(async(req,res)=>{
    try{
      const headers=corsHeaders(req,env);
      if(req.method==='OPTIONS'&&req.url?.startsWith('/api/')){res.writeHead(204,headers);return res.end()}
      if(req.method==='GET'&&req.url?.startsWith('/api/health')){
        data.prune();
        return json(res,200,{ok:true,version,botConfigured:Boolean(token),sendScope:env.SEND_SCOPE||'self',storage:data.health()},headers)
      }
      if(req.method==='POST'&&req.url==='/api/bootstrap')return await bootstrap(req,res,{token,env,headers});
      if(req.method==='POST'&&req.url==='/api/transfers')return await createTransfer(req,res,{botToken:token,env,fetchImpl,headers,data});
      if(req.method==='POST'&&req.url==='/api/transfers/claim')return await claimTransfer(req,res,{botToken:token,env,headers,data});
      if(req.method==='POST'&&req.url==='/api/send')return await send(req,res,{token,env,fetchImpl,headers,data});
      if(req.method==='GET'||req.method==='HEAD')return await serveStatic(req,res);
      return json(res,405,{ok:false,error:'method_not_allowed'})
    }catch(error){
      const status=Number(error?.status)||500;console.error(error);
      return json(res,status,{ok:false,error:status>=500?'Erro interno':error.message})
    }
  });
  if(ownsStore)server.on('close',()=>{try{data.close()}catch{}});
  return server
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const server=createServer();
  server.listen(port,async()=>{
    console.log(`RMDtxtML ${version} http://localhost:${port}`);
    const token=process.env.BOT_TOKEN||'',appUrl=process.env.APP_URL||'';
    if(token&&/^https:\/\//i.test(appUrl)){
      try{
        const me=await telegramCall(token,'getMe',{});
        botName=String(me?.result?.username||botName||'');
        console.log(`Telegram bot ready: ${botName?'@'+botName:'username unavailable'} · mainMiniApp=${me?.result?.has_main_web_app===true?'yes':'no'}`);
        await telegramCall(token,'setChatMenuButton',{menu_button:{type:'web_app',text:'RMDtxtML',web_app:{url:appUrl}}});
        console.log(`Telegram menu configured: ${appUrl}`)
      }catch(error){console.error('Could not configure Telegram bot:',error instanceof Error?error.message:error)}
    }
  })
}

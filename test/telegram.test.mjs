import test from 'node:test';
import assert from 'node:assert/strict';
import {authorizedDestinations,destinationId,publicDestinations,resolveDestination,signInitData,telegramCall,validateInitData,validateInlineKeyboard,validateRichHtml,validateRichMessage} from '../src/telegram.mjs';

const token='123456:TEST_TOKEN';
const now=Date.UTC(2026,8,17,18,0,0);
const authDate=Math.floor(now/1000);

test('accepts correctly signed initData',()=>{const initData=signInitData({auth_date:authDate,user:JSON.stringify({id:42,first_name:'Test'})},token);const result=validateInitData(initData,token,{now});assert.equal(result.ok,true);assert.equal(result.user.id,42)});
test('rejects tampered initData',()=>{const signed=signInitData({auth_date:authDate,user:JSON.stringify({id:42})},token);const params=new URLSearchParams(signed);params.set('user',JSON.stringify({id:99}));assert.equal(validateInitData(params.toString(),token,{now}).ok,false)});
test('rejects expired initData',()=>{const initData=signInitData({auth_date:authDate-86401,user:JSON.stringify({id:42})},token);assert.equal(validateInitData(initData,token,{now,maxAgeSeconds:86400}).error,'expired')});
test('keeps signature field in HMAC calculation',()=>{const initData=signInitData({auth_date:authDate,signature:'external-signature',user:JSON.stringify({id:42})},token);assert.equal(validateInitData(initData,token,{now}).ok,true)});
test('rejects dangerous HTML constructs',()=>{assert.equal(validateRichHtml('<script>alert(1)</script>').ok,false);assert.equal(validateRichHtml('<p onclick="x()">x</p>').ok,false);assert.equal(validateRichHtml('<a href="javascript:alert(1)">x</a>').ok,false)});
test('accepts valid Rich HTML and harmless code-like text',()=>{assert.equal(validateRichHtml('<h2>Title</h2><p><strong>Hello</strong> <tg-spoiler>world</tg-spoiler></p>').ok,true);assert.equal(validateRichHtml('<pre>javascript: onclick= example</pre>').ok,true)});
test('enforces Telegram 32768-character rich-message text limit',()=>{assert.equal(validateRichHtml('a'.repeat(32768)).ok,true);assert.equal(validateRichHtml('a'.repeat(32769)).error,'text_too_long');assert.equal(validateRichHtml('😀'.repeat(32768)).ok,true);assert.equal(validateRichHtml('<p>'+('x'.repeat(32768))+'</p>').ok,true);assert.equal(validateRichHtml('<p>'+('x'.repeat(32769))+'</p>').error,'text_too_long')});
test('enforces maximum of 500 blocks',()=>{assert.equal(validateRichHtml('<p>x</p>'.repeat(500)).ok,true);assert.equal(validateRichHtml('<p>x</p>'.repeat(501)).error,'too_many_blocks')});
test('enforces maximum nesting depth of 16',()=>{const nest=n=>'<details>'.repeat(n)+'x'+'</details>'.repeat(n);assert.equal(validateRichHtml(nest(16)).ok,true);assert.equal(validateRichHtml(nest(17)).error,'nesting_too_deep')});
test('enforces maximum of 50 media attachments',()=>{assert.equal(validateRichHtml('<img src="https://x.test/a">'.repeat(50)).ok,true);assert.equal(validateRichHtml('<img src="https://x.test/a">'.repeat(51)).error,'too_many_media')});
test('enforces maximum of 20 table columns including colspan',()=>{const cells=n=>Array.from({length:n},()=>'<td>x</td>').join('');assert.equal(validateRichHtml(`<table><tr>${cells(20)}</tr></table>`).ok,true);assert.equal(validateRichHtml(`<table><tr>${cells(21)}</tr></table>`).error,'too_many_table_columns');assert.equal(validateRichHtml('<table><tr><td colspan="21">x</td></tr></table>').error,'too_many_table_columns')});


test('telegramCall marks explicit Bot API rejection as confirmed',async()=>{
  await assert.rejects(
    ()=>telegramCall(token,'sendRichMessage',{}, {fetchImpl:async()=>new Response(JSON.stringify({ok:false,description:'Bad Request'}),{status:400,headers:{'content-type':'application/json'}})}),
    error=>error.telegramResponse===true&&/Bad Request/.test(error.message)
  )
});

test('telegramCall keeps malformed or transport responses uncertain',async()=>{
  await assert.rejects(
    ()=>telegramCall(token,'sendRichMessage',{}, {fetchImpl:async()=>new Response('gateway failure',{status:502})}),
    error=>error.telegramResponse===false
  );
  await assert.rejects(
    ()=>telegramCall(token,'sendRichMessage',{}, {fetchImpl:async()=>{throw new Error('socket closed')}}),
    error=>error.telegramResponse===false
  )
});


test('destination scope and ACL never expose or authorize another user chat',()=>{
  const validated={user:{id:42}};
  const env={SEND_SCOPE:'all',AUTHORIZED_DESTINATIONS:JSON.stringify([
    {chat_id:'-100123',label:'Equipe',user_ids:[42]},
    {chat_id:'-100999',label:'Outro',user_ids:[99]},
    {chat_id:'-100777',label:'Público',public:true}
  ])};
  const publicList=publicDestinations(validated,env,token);
  assert.equal(publicList.some(x=>Object.values(x).some(v=>String(v).startsWith('-100'))),false);
  assert.deepEqual(publicList.map(x=>x.label),['Minhas mensagens','Equipe','Público']);
  const allowed=destinationId('-100123',token),denied=destinationId('-100999',token);
  assert.equal(resolveDestination(allowed,validated,env,token),'-100123');
  assert.equal(resolveDestination(denied,validated,env,token),null);
  assert.equal(authorizedDestinations(validated,{...env,SEND_SCOPE:'self'},token).length,1);
  assert.equal(authorizedDestinations(validated,{SEND_SCOPE:'configured',ALLOWED_CHAT_IDS:'-100555'},token).length,0);
  assert.equal(authorizedDestinations(validated,{SEND_SCOPE:'configured',ALLOWED_CHAT_IDS:'-100555',ALLOW_GLOBAL_DESTINATIONS:'true'},token).length,1)
});

test('telegramCall applies a bounded transport signal',async()=>{
  let signal;
  await telegramCall(token,'getMe',{}, {fetchImpl:async(_url,options)=>{signal=options.signal;return new Response(JSON.stringify({ok:true,result:{id:1}}),{status:200,headers:{'content-type':'application/json'}})}});
  assert.ok(signal instanceof AbortSignal)
});

test('Rich Message block validation enforces colspan totals and button invariants',()=>{
  const base={blocks:[{type:'table',cells:[[
    {text:'a',colspan:10,align:'left',valign:'top'},
    {text:'b',colspan:11,align:'right',valign:'bottom'}
  ]]}]};
  assert.equal(validateRichMessage(base).error,'too_many_table_columns');
  assert.equal(validateRichMessage({blocks:[{type:'buttons',buttons:[{text:'x',url:'https://example.com',style:'link'}]}]}).error,'invalid_button_style');
  assert.equal(validateRichMessage({blocks:[{type:'buttons',buttons:[{text:'x',callback_data:'x'.repeat(65)}]}]}).error,'invalid_callback_data');
  assert.equal(validateRichMessage({blocks:[{type:'buttons',buttons:[{text:'x',callback_data:'ok',style:'link'}]}]}).ok,true)
});


test('inline keyboard validation renders supported publication buttons and rejects callback-only behavior',()=>{
  const input=[
    [{text:'Site',type:'url',url:'https://example.com',style:'primary'}],
    [{text:'Copiar',type:'copy_text',copyText:'valor'},{text:'Off',type:'disabled'}],
    [{text:'Escolher',type:'switch_inline_query_chosen_chat',query:'busca',allowUserChats:true,allowGroupChats:true}]
  ];
  const checked=validateInlineKeyboard(input);
  assert.equal(checked.ok,true);assert.deepEqual(checked.keyboard,[input[0],input[1],[{...input[2][0],allowBotChats:false,allowChannelChats:false}]]);
  assert.deepEqual(checked.replyMarkup.inline_keyboard[0][0],{text:'Site',style:'primary',url:'https://example.com'});
  assert.deepEqual(checked.replyMarkup.inline_keyboard[1][0],{text:'Copiar',copy_text:{text:'valor'}});
  assert.deepEqual(checked.replyMarkup.inline_keyboard[1][1],{text:'Off',disabled:{}});
  assert.deepEqual(checked.replyMarkup.inline_keyboard[2][0].switch_inline_query_chosen_chat,{query:'busca',allow_user_chats:true,allow_group_chats:true});
  assert.equal(validateInlineKeyboard([[{text:'Callback',type:'callback_data',data:'x'}]]).error,'unsupported_keyboard_button');
  assert.equal(validateInlineKeyboard([[{text:'Mini App',type:'web_app',url:'http://example.com'}]]).error,'invalid_keyboard_url')
});

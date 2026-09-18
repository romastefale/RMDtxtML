import test from 'node:test';
import assert from 'node:assert/strict';
import {isAllowedTarget,signInitData,validateInitData,validateRichHtml} from '../src/telegram.mjs';

const token='123456:TEST_TOKEN';
const now=Date.UTC(2026,8,17,18,0,0);
const authDate=Math.floor(now/1000);

test('accepts correctly signed initData',()=>{const initData=signInitData({auth_date:authDate,user:JSON.stringify({id:42,first_name:'Test'})},token);const result=validateInitData(initData,token,{now});assert.equal(result.ok,true);assert.equal(result.user.id,42)});
test('rejects tampered initData',()=>{const signed=signInitData({auth_date:authDate,user:JSON.stringify({id:42})},token);const params=new URLSearchParams(signed);params.set('user',JSON.stringify({id:99}));assert.equal(validateInitData(params.toString(),token,{now}).ok,false)});
test('rejects expired initData',()=>{const initData=signInitData({auth_date:authDate-86401,user:JSON.stringify({id:42})},token);assert.equal(validateInitData(initData,token,{now,maxAgeSeconds:86400}).error,'expired')});
test('keeps signature field in HMAC calculation',()=>{const initData=signInitData({auth_date:authDate,signature:'external-signature',user:JSON.stringify({id:42})},token);assert.equal(validateInitData(initData,token,{now}).ok,true)});
test('self scope only allows authenticated user chat',()=>{const validated={user:{id:42}};assert.equal(isAllowedTarget('42',validated,{SEND_SCOPE:'self'}),true);assert.equal(isAllowedTarget('43',validated,{SEND_SCOPE:'self'}),false)});
test('explicit allowlist permits configured destinations',()=>{assert.equal(isAllowedTarget('-100123',{user:{id:42}},{SEND_SCOPE:'self',ALLOWED_CHAT_IDS:'-100123,55'}),true)});
test('rejects dangerous HTML constructs',()=>{assert.equal(validateRichHtml('<script>alert(1)</script>').ok,false);assert.equal(validateRichHtml('<p onclick="x()">x</p>').ok,false);assert.equal(validateRichHtml('<a href="javascript:alert(1)">x</a>').ok,false)});
test('accepts valid Rich HTML and harmless code-like text',()=>{assert.equal(validateRichHtml('<h2>Title</h2><p><strong>Hello</strong> <tg-spoiler>world</tg-spoiler></p>').ok,true);assert.equal(validateRichHtml('<pre>javascript: onclick= example</pre>').ok,true)});
test('enforces Telegram 32768-character rich-message text limit',()=>{assert.equal(validateRichHtml('a'.repeat(32768)).ok,true);assert.equal(validateRichHtml('a'.repeat(32769)).error,'text_too_long');assert.equal(validateRichHtml('😀'.repeat(32768)).ok,true);assert.equal(validateRichHtml('<p>'+('x'.repeat(32768))+'</p>').ok,true);assert.equal(validateRichHtml('<p>'+('x'.repeat(32769))+'</p>').error,'text_too_long')});
test('enforces maximum of 500 blocks',()=>{assert.equal(validateRichHtml('<p>x</p>'.repeat(500)).ok,true);assert.equal(validateRichHtml('<p>x</p>'.repeat(501)).error,'too_many_blocks')});
test('enforces maximum nesting depth of 16',()=>{const nest=n=>'<details>'.repeat(n)+'x'+'</details>'.repeat(n);assert.equal(validateRichHtml(nest(16)).ok,true);assert.equal(validateRichHtml(nest(17)).error,'nesting_too_deep')});
test('enforces maximum of 50 media attachments',()=>{assert.equal(validateRichHtml('<img src="https://x.test/a">'.repeat(50)).ok,true);assert.equal(validateRichHtml('<img src="https://x.test/a">'.repeat(51)).error,'too_many_media')});
test('enforces maximum of 20 table columns including colspan',()=>{const cells=n=>Array.from({length:n},()=>'<td>x</td>').join('');assert.equal(validateRichHtml(`<table><tr>${cells(20)}</tr></table>`).ok,true);assert.equal(validateRichHtml(`<table><tr>${cells(21)}</tr></table>`).error,'too_many_table_columns');assert.equal(validateRichHtml('<table><tr><td colspan="21">x</td></tr></table>').error,'too_many_table_columns')});

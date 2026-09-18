import {test,expect} from '@playwright/test';

const telegramPattern=/https:\/\/telegram\.org\/js\/telegram-web-app\.js/;

async function waitReady(page){
  await page.waitForFunction(()=>window.RMD?.ready);
  await page.evaluate(()=>window.RMD.ready)
}
async function web(page,path='/'){
  await page.route(telegramPattern,route=>route.fulfill({status:200,contentType:'application/javascript',body:''}));
  await page.goto(path);
  await waitReady(page)
}
function telegramScript(startParam=''){
  return `(()=>{
    const handlers=new Map();
    const button=()=>({
      isVisible:false,isActive:true,isProgressVisible:false,text:'',handler:null,
      onClick(fn){this.handler=fn},offClick(fn){if(!fn||this.handler===fn)this.handler=null},
      show(){this.isVisible=true},hide(){this.isVisible=false},enable(){this.isActive=true},disable(){this.isActive=false},
      showProgress(){this.isProgressVisible=true},hideProgress(){this.isProgressVisible=false},setText(v){this.text=v}
    });
    const tg={
      initData:'signed-raw-data',initDataUnsafe:{user:{id:42,first_name:'Test'},start_param:${JSON.stringify(startParam)}},
      platform:'ios',version:'10.3',colorScheme:'dark',viewportHeight:720,viewportStableHeight:700,
      isExpanded:true,isFullscreen:false,isActive:true,
      safeAreaInset:{top:8,right:2,bottom:6,left:2},contentSafeAreaInset:{top:4,right:3,bottom:10,left:3},
      BackButton:button(),MainButton:button(),SettingsButton:button(),HapticFeedback:{notificationOccurred(type){this.type=type}},
      onEvent(name,fn){if(!handlers.has(name))handlers.set(name,new Set());handlers.get(name).add(fn)},
      emit(name,data){for(const fn of handlers.get(name)||[])fn(data)},
      ready(){this.readyCalled=true},expand(){this.expandCalled=true},requestFullscreen(){this.fullscreenRequested=true},
      setHeaderColor(v){this.header=v},setBackgroundColor(v){this.background=v},setBottomBarColor(v){this.bottom=v},
      enableClosingConfirmation(){this.closing=true},disableClosingConfirmation(){this.closing=false},
      hideKeyboard(){this.keyboardHidden=true},close(){this.closed=true}
    };
    window.Telegram={WebApp:tg};window.__tg=tg
  })();`
}
async function telegram(page,{path='/',startParam=''}={}){
  await page.route('**/api/bootstrap',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,destinations:[{id:'self',label:'Minhas mensagens'}]})}));
  await page.route(telegramPattern,route=>route.fulfill({status:200,contentType:'application/javascript',body:telegramScript(startParam)}));
  await page.goto(path);
  await waitReady(page)
}
async function setEditor(page,html){
  await page.evaluate(value=>window.RMD.editor.setHtml(value,{history:false}),html);
  await page.locator('#editor').focus()
}
async function selectText(page,text){
  await page.evaluate(needle=>{if(!window.RMD.editor.selectText(needle))throw new Error('selection_text_not_found')},text)
}
async function selectAll(page){await page.evaluate(()=>window.RMD.editor.selectAll())}

test('inline formatting toggles without losing the selected text',async({page})=>{
  await web(page);await setEditor(page,'<p>alpha beta gamma</p>');await selectText(page,'beta');
  await page.locator('[data-cmd="bold"]').click();
  expect(await page.evaluate(()=>window.RMD.editor.html())).toBe('<p>alpha <strong>beta</strong> gamma</p>');
  await expect(page.locator('[data-cmd="bold"]')).toHaveAttribute('aria-pressed','true');
  expect((await page.evaluate(()=>window.RMD.editor.selectionState())).text).toBe('beta');
  await page.locator('[data-cmd="bold"]').click();
  expect(await page.evaluate(()=>window.RMD.editor.html())).toBe('<p>alpha beta gamma</p>');
  expect(await page.evaluate(()=>getSelection().toString())).toBe('beta')
});

test('subscript applies and clear-format affects only the selected range',async({page})=>{
  await web(page);await setEditor(page,'<p><strong>alpha beta gamma</strong></p>');await selectText(page,'beta');
  await page.locator('#more').click();await page.locator('[data-action="sub"]').click();
  await expect(page.locator('#editor sub')).toHaveText('beta');
  await selectText(page,'beta');await page.locator('#more').click();await page.locator('[data-action="clear"]').click();
  expect(await page.evaluate(()=>window.RMD.editor.html())).toBe('<p><strong>alpha </strong>beta<strong> gamma</strong></p>')
});

test('link editor preserves selection and block conversion stays in place',async({page})=>{
  await web(page);await setEditor(page,'<p>alpha beta gamma</p>');await selectText(page,'beta');
  await page.locator('#link').click();await expect(page.locator('#inputDialog')).toHaveJSProperty('open',true);
  await page.locator('#inputDialogValue').fill('https://example.com/x');await page.locator('#inputDialogOk').click();
  await expect(page.locator('#editor a')).toHaveText('beta');
  await expect(page.locator('#editor a')).toHaveAttribute('href','https://example.com/x');
  await selectText(page,'alpha');
  await page.locator('#block').selectOption('h2');
  await expect(page.locator('#editor > h2')).toHaveCount(1);
  await expect(page.locator('#editor > h2')).toContainText('alpha');
  await expect(page.locator('#editor > *')).toHaveCount(1)
});

test('list transaction survives undo and redo without phantom blocks',async({page})=>{
  await web(page);await setEditor(page,'<p>one</p><p>two</p>');await selectAll(page);
  await page.locator('#more').click();await page.locator('[data-action="ul"]').click();
  await expect(page.locator('#editor > ul > li')).toHaveCount(2);
  await page.locator('#editor').press('Control+z');
  await expect(page.locator('#editor > p')).toHaveCount(2);
  await page.locator('#editor').press('Control+Shift+z');
  await expect(page.locator('#editor > ul > li')).toHaveCount(2);
  expect(await page.locator('#editor').evaluate(el=>[...el.childNodes].filter(n=>n.nodeType===3&&n.textContent.trim()).length)).toBe(0)
});

test('real browser typing participates in ProseMirror undo and redo history',async({page})=>{
  await web(page);await setEditor(page,'<p>abc</p>');
  await page.evaluate(()=>RMD.editor.setCursorInText('abc',3));
  await page.keyboard.type('d');
  await expect(page.locator('#editor')).toContainText('abcd');
  await page.locator('#editor').press('Control+z');
  expect(await page.evaluate(()=>RMD.editor.html())).toBe('<p>abc</p>');
  await page.locator('#editor').press('Control+Shift+z');
  expect(await page.evaluate(()=>RMD.editor.html())).toBe('<p>abcd</p>')
});

test('drawer and preview do not mutate the document and restore focus',async({page})=>{
  await web(page);await setEditor(page,'<h2>Título</h2><p>Texto <strong>forte</strong></p>');
  const before=await page.evaluate(()=>window.RMD.editor.html());
  await page.locator('#more').focus();await page.locator('#more').click();
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden','false');
  await expect(page.locator('#more')).toHaveAttribute('aria-expanded','true');
  expect(await page.locator('.app').evaluate(el=>el.inert)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden','true');
  await expect(page.locator('#more')).toBeFocused();
  expect(await page.evaluate(()=>window.RMD.editor.html())).toBe(before);
  await page.locator('#previewTab').click();
  await expect(page.locator('#editWrap')).toBeHidden();
  await expect(page.locator('#preview')).toContainText('Texto forte');
  await expect(page.locator('#previewTab')).toHaveAttribute('aria-selected','true');
  await page.locator('#editTab').click();
  await expect(page.locator('#editWrap')).toBeVisible();
  await expect(page.locator('#editor')).toBeFocused();
  expect(await page.locator('#editor').evaluate(el=>el.innerHTML)).toBe(before)
});

test('task checkbox is semantic state and survives persistence',async({page})=>{
  await web(page);await setEditor(page,'<p>Tarefas</p>');
  await page.locator('#more').click();await page.locator('[data-action="task"]').click();
  const readChecked=()=>page.evaluate(()=>{
    const model=RMD.editor.model(),items=[];
    const walk=n=>{if(n.type==='list_item')items.push(n.attrs?.checked);for(const child of n.content||[])walk(child)};walk(model);return items
  });
  expect(await readChecked()).toEqual([false,true]);
  const boxes=page.locator('#editor input[type="checkbox"]');await expect(boxes).toHaveCount(2);
  await boxes.first().click();
  expect(await readChecked()).toEqual([true,true]);
  const rich=await page.evaluate(()=>RMD.editor.html());
  expect(rich).toContain('<input type="checkbox" checked="">');
  expect(rich).not.toContain('rmd-task-');expect(rich).not.toContain('data-task');
  await page.locator('#save').click();await page.reload();await waitReady(page);
  await expect(page.locator('#editor input[type="checkbox"]:checked')).toHaveCount(2)
});

test('checkpoint persists the canonical document across reload',async({page})=>{
  await web(page);await setEditor(page,'<h3>Persistente</h3><p>Depois do reload.</p>');
  await page.locator('#save').click();
  await expect(page.locator('#status')).toContainText('Salvo');
  const stored=await page.evaluate(async()=>{
    const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('rmdtxtml',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
    return await new Promise((resolve,reject)=>{const tx=db.transaction('docs','readonly'),r=tx.objectStore('docs').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)})
  });
  expect(stored.schema).toBe(2);expect(stored.format).toBe('semantic');expect(stored.content.modelVersion).toBe(2);expect(stored.content.model.type).toBe('doc');expect(stored.content.html).toBeUndefined();
  await page.reload();await waitReady(page);
  await expect(page.locator('#editor > h3')).toHaveText('Persistente');
  await expect(page.locator('#editor')).toContainText('Depois do reload.')
});

test('media semantic model is stable across Rich HTML projection and reparse',async({page})=>{
  await web(page);
  const model={type:'doc',content:[
    {type:'image',attrs:{src:'https://example.com/a.jpg',alt:'A',spoiler:false},content:[{type:'text',text:'Legenda imagem'}]},
    {type:'video',attrs:{src:'https://example.com/a.mp4',alt:'',spoiler:false},content:[{type:'text',text:'Legenda vídeo'}]},
    {type:'document',attrs:{src:'https://example.com/a.pdf'},content:[{type:'text',text:'Legenda documento'}]}
  ]};
  const result=await page.evaluate(input=>{
    RMD.editor.setModel(input,{history:false});
    const html=RMD.editor.html();
    return{html,reparsed:RMD.editor.parseHtml(html)}
  },model);
  expect(result.reparsed).toEqual(model);
  expect((result.html.match(/<figcaption>/g)||[]).length).toBe(3)
});

test('voice note is preserved semantically and rendered as Telegram voice_note',async({page})=>{
  await web(page);
  const model={type:'doc',content:[{type:'voice_note',attrs:{src:'https://example.com/voice.ogg',alt:'',spoiler:false},content:[{type:'text',text:'Mensagem de voz'}]}]};
  const result=await page.evaluate(input=>{
    RMD.editor.setModel(input,{history:false});
    const html=RMD.editor.html(),reparsed=RMD.editor.parseHtml(html),rendered=RMD.editor.render();
    return{html,reparsed,rendered}
  },model);
  expect(result.reparsed).toEqual(model);
  expect(result.html).toContain('<audio src="https://example.com/voice.ogg"');
  expect(result.rendered.richMessage.blocks[0]).toMatchObject({type:'voice_note',voice_note:{type:'voice_note',media:'https://example.com/voice.ogg'}})
});

test('paste sanitization removes executable markup',async({page})=>{
  await web(page);await setEditor(page,'<p>Base</p>');await page.locator('#editor').click();
  await page.locator('#editor').evaluate(el=>{
    const event=new Event('paste',{bubbles:true,cancelable:true});
    Object.defineProperty(event,'clipboardData',{value:{getData:type=>type==='text/html'?'<p><strong>Seguro</strong><script>window.pwned=1</script></p>':''}});
    el.dispatchEvent(event)
  });
  await expect(page.locator('#editor script')).toHaveCount(0);
  expect(await page.evaluate(()=>window.pwned)).toBeUndefined();
  await expect(page.locator('#editor')).toContainText('Seguro')
});

test('current responsive geometry never clips the editor or touch targets',async({page})=>{
  await web(page);
  for(const width of [320,360,390,1024]){
    await page.setViewportSize({width,height:844});
    const geometry=await page.evaluate(()=>({
      items:[...document.querySelectorAll('.bar > .blockPick,.bar > button')].map(el=>{const x=el.getBoundingClientRect(),svg=el.querySelector('svg')?.getBoundingClientRect();return{w:x.width,h:x.height,left:x.left,right:x.right,cy:x.top+x.height/2,sy:svg?svg.top+svg.height/2:null}}),
      bodyOverflow:document.documentElement.scrollWidth-window.innerWidth,
      font:getComputedStyle(document.querySelector('#editor')).fontSize,
      toolbarBottom:document.querySelector('#toolbar').getBoundingClientRect().bottom,
      viewport:window.innerHeight
    }));
    expect(geometry.items).toHaveLength(6);
    expect(geometry.items.every(x=>x.w>=42&&x.h>=42&&x.left>=-0.5&&x.right<=width+0.5)).toBe(true);
    expect(Math.max(...geometry.items.map(x=>x.cy))-Math.min(...geometry.items.map(x=>x.cy))).toBeLessThanOrEqual(1);
    expect(geometry.items.filter(x=>x.sy!==null).every(x=>Math.abs(x.sy-x.cy)<=2)).toBe(true);
    expect(geometry.bodyOverflow).toBeLessThanOrEqual(0);
    expect(geometry.font).toBe('16px');
    expect(geometry.toolbarBottom).toBeLessThanOrEqual(geometry.viewport+0.5)
  }
});

test('caret and focus survive viewport resize and theme changes dynamically',async({page})=>{
  await web(page);await setEditor(page,'<p>abcdef</p>');
  await page.evaluate(()=>window.RMD.editor.setCursorInText('abcdef',3));
  await page.setViewportSize({width:320,height:620});
  const caret=await page.evaluate(()=>({active:document.activeElement?.id,...window.RMD.editor.selectionState()}));
  expect(caret.active).toBe('editor');expect(caret.empty).toBe(true);expect(caret.from).toBe(caret.to);
  await page.emulateMedia({colorScheme:'dark'});await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
  await page.emulateMedia({colorScheme:'light'});await expect(page.locator('html')).toHaveAttribute('data-theme','light')
});

test('invalid semantic model is rejected without replacing the current document',async({page})=>{
  await web(page);await setEditor(page,'<p>Preservar</p>');
  const result=await page.evaluate(()=>{
    const before=JSON.stringify(RMD.editor.model());
    try{RMD.editor.setModel({type:'doc',content:[{type:'unknown_node'}]},{history:false});return{error:null,before,after:JSON.stringify(RMD.editor.model())}}
    catch(error){return{error:error?.message||String(error),before,after:JSON.stringify(RMD.editor.model())}}
  });
  expect(result.error).toBe('invalid_semantic_model');expect(result.after).toBe(result.before);
  const unsafe=await page.evaluate(()=>{
    const before=JSON.stringify(RMD.editor.model());
    try{
      RMD.editor.setModel({type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'X',marks:[{type:'link',attrs:{href:'javascript:alert(1)'}}]}]}]},{history:false});
      return{error:null,before,after:JSON.stringify(RMD.editor.model())}
    }catch(error){return{error:error?.message||String(error),before,after:JSON.stringify(RMD.editor.model())}}
  });
  expect(unsafe.error).toBe('invalid_semantic_model');expect(unsafe.after).toBe(unsafe.before);
  await expect(page.locator('#editor')).toContainText('Preservar')
});

test('semantic empty document is blocked while non-text structural content is valid',async({page})=>{
  let calls=0;
  await page.route('**/api/transfers',async route=>{
    calls++;await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token:'c'.repeat(32),expiresAt:Date.now()+60000,telegramUrl:'https://t.me/rmdtxtml_test_bot?startapp='+('c'.repeat(32))})})
  });
  await page.route(/https:\/\/t\.me\/.*/,route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>Telegram</body></html>'}));
  await web(page);await page.evaluate(()=>RMD.editor.setModel({type:'doc',content:[{type:'paragraph'}]},{history:false}));
  await page.locator('#send').click();await expect(page.locator('#toast')).toContainText('Escreva ou adicione algum conteúdo');expect(calls).toBe(0);
  await page.locator('#more').click();await page.locator('[data-action="divider"]').click();
  await page.locator('#send').click();await expect.poll(()=>calls).toBe(1)
});

test('Telegram lifecycle uses native controls, stable viewport and safe areas',async({page})=>{
  await telegram(page);
  await expect(page.locator('html')).toHaveAttribute('data-host','telegram');
  await expect(page.locator('.top')).toBeHidden();
  expect(await page.evaluate(()=>({ready:__tg.readyCalled,expand:__tg.expandCalled,fullscreen:__tg.fullscreenRequested,main:__tg.MainButton.isVisible,text:__tg.MainButton.text,settings:__tg.SettingsButton.isVisible})))
    .toEqual({ready:true,expand:true,fullscreen:true,main:true,text:'Enviar',settings:true});
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--rmd-app-height'))).toBe('700px');
  await page.evaluate(()=>{__tg.viewportHeight=410;__tg.emit('viewportChanged',{isStateStable:false})});
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--rmd-app-height'))).toBe('700px');
  await page.evaluate(()=>{__tg.viewportStableHeight=610;__tg.emit('viewportChanged',{isStateStable:true})});
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--rmd-app-height'))).toBe('610px');
  await page.evaluate(()=>{__tg.contentSafeAreaInset={top:11,right:12,bottom:13,left:14};__tg.emit('contentSafeAreaChanged')});
  expect(await page.locator('html').evaluate(el=>el.style.getPropertyValue('--rmd-content-bottom'))).toBe('13px');
  await page.locator('#more').click();expect(await page.evaluate(()=>__tg.BackButton.isVisible)).toBe(true);
  await page.evaluate(()=>__tg.BackButton.handler());
  await expect(page.locator('#drawer')).toHaveAttribute('aria-hidden','true');
  expect(await page.evaluate(()=>__tg.BackButton.isVisible)).toBe(false);
  await page.evaluate(()=>{__tg.colorScheme='light';__tg.emit('themeChanged')});
  await expect(page.locator('html')).toHaveAttribute('data-theme','light')
});

test('Telegram MainButton sends raw initData through the application boundary',async({page})=>{
  let body;
  await page.route('**/api/send',async route=>{
    body=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{message_id:77}})})
  });
  await telegram(page);await setEditor(page,'<h2>Enviar</h2><p>Mensagem</p>');
  await page.evaluate(()=>__tg.MainButton.handler());
  await expect.poll(()=>body).not.toBeUndefined();
  expect(body.initData).toBe('signed-raw-data');expect(body.destinationId).toBe('self');expect(body.chatId).toBeUndefined();
  expect(body.richMessage.blocks[0]).toEqual({type:'heading',text:'Enviar',size:2});
  expect(body.requestId).toMatch(/^(?:[0-9a-f-]{36}|send-)/);
  await expect.poll(()=>page.evaluate(()=>({active:__tg.MainButton.isActive,progress:__tg.MainButton.isProgressVisible,haptic:__tg.HapticFeedback.type})))
    .toEqual({active:true,progress:false,haptic:'success'})
});

test('start parameter claims a transferred document exactly through the Telegram bridge',async({page})=>{
  const token='a'.repeat(32);let body;
  await page.route('**/api/transfers/claim',async route=>{
    body=route.request().postDataJSON();
    await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,transfer:{
      html:'<p>HTML de compatibilidade</p>',isRtl:false,skipEntityDetection:false,
      semantic:{schema:2,format:'semantic',model:{type:'doc',content:[
        {type:'heading',attrs:{level:2},content:[{type:'text',text:'Transferido'}]},
        {type:'paragraph',content:[{type:'text',text:'Continuidade'}]}
      ]}},
      document:{id:'00000000-0000-4000-8000-000000000001',revision:7},expiresAt:Date.now()+60000
    }})})
  });
  await telegram(page,{path:'/?tgWebAppStartParam='+token});
  await expect(page.locator('#editor > h2')).toHaveText('Transferido');
  await expect.poll(()=>body).not.toBeUndefined();
  expect(body).toEqual({token,initData:'signed-raw-data'});
  expect(new URL(page.url()).searchParams.has('tgWebAppStartParam')).toBe(false)
});

test('Web handoff sends document identity before navigating to Telegram',async({page})=>{
  const token='b'.repeat(32);let body;
  await page.route('**/api/transfers',async route=>{
    body=route.request().postDataJSON();
    await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token,expiresAt:Date.now()+60000,telegramUrl:'https://t.me/rmdtxtml_test_bot?startapp='+token})})
  });
  await page.route(/https:\/\/t\.me\/.*/,route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>Telegram</body></html>'}));
  await web(page);await setEditor(page,'<h2>Web</h2><p>Continua no Telegram</p>');
  await expect(page.locator('#send')).toHaveText('Abrir no Telegram');
  await page.locator('#send').click();
  await expect.poll(()=>body).not.toBeUndefined();
  expect(body.html).toContain('<h2>Web</h2>');
  expect(body.document.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9_-]{7,79}$/);
  expect(body.semantic.schema).toBe(2);expect(body.semantic.format).toBe('semantic');expect(body.semantic.modelVersion).toBe(2);
  expect(body.semantic.model.type).toBe('doc');
  await page.waitForURL(/t\.me\/rmdtxtml_test_bot/)
});


test('official Rich HTML structures survive semantic round-trip without silent loss',async({page})=>{
  await web(page);
  const html='<details open><summary><strong>Resumo</strong></summary><p>Corpo <em>rico</em></p></details>'+
    '<table bordered compact><caption>Tabela</caption><tr><th>H</th><td colspan="2">V</td></tr></table>'+
    '<figure><tg-map lat="41.9" long="12.5" zoom="14" width="600" height="400"/><figcaption>Roma<cite>Fonte</cite></figcaption></figure>'+
    '<tg-slideshow><img src="https://example.com/a.jpg"/><video src="https://example.com/b.mp4"/><figcaption>Mídia</figcaption></tg-slideshow>'+
    '<ol><li value="7" type="i">Item</li></ol>'+
    '<ol reversed><li>A</li><li>B</li><li>C</li></ol>'+
    '<tg-button-row align="right"><tg-button type="callback_data" style="link" data="go">Abrir</tg-button><tg-button type="disabled">Off</tg-button></tg-button-row>';
  const result=await page.evaluate(value=>{const model=RMD.editor.parseHtml(value);RMD.editor.setModel(model,{history:false});const serialized=RMD.editor.html();return{model,serialized,reparsed:RMD.editor.parseHtml(serialized),rendered:RMD.editor.render()}},html);
  expect(result.reparsed).toEqual(result.model);
  expect(result.rendered.mechanism).toBe('Rich Message · Blocks');
  const blocks=result.rendered.richMessage.blocks;
  expect(blocks.find(x=>x.type==='details').blocks[0].type).toBe('paragraph');
  expect(blocks.find(x=>x.type==='table').caption).toBe('Tabela');
  expect(blocks.find(x=>x.type==='map').caption.credit).toBe('Fonte');
  expect(blocks.find(x=>x.type==='slideshow').blocks.map(x=>x.type)).toEqual(['photo','video']);
  const lists=blocks.filter(x=>x.type==='list');
  expect(lists[0].items[0]).toMatchObject({value:7,type:'i'});
  expect(lists[1].items.map(x=>x.value)).toEqual([3,2,1]);
  expect(blocks.find(x=>x.type==='buttons').buttons).toHaveLength(2)
});
test('TXT import stays literal while Markdown import is interpreted and original source is preserved',async({page})=>{
  await web(page);
  await page.locator('#file').setInputFiles({name:'literal.txt',mimeType:'text/plain',buffer:Buffer.from('# Não é título\n**não é negrito**','utf8')});
  await expect(page.locator('#editor > p')).toHaveCount(2);await expect(page.locator('#editor h1,#editor strong')).toHaveCount(0);
  let source=await page.evaluate(()=>RMD.application.document().source);
  expect(source.kind).toBe('text');expect(source.originalText).toContain('**não é negrito**');expect(source.edited).toBe(false);
  await page.locator('#more').click();
  const [original]=await Promise.all([page.waitForEvent('download'),page.locator('[data-action="exportsource"]').click()]);
  const stream=await original.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);
  expect(original.suggestedFilename()).toBe('literal.txt');expect(Buffer.concat(chunks).toString('utf8')).toBe('# Não é título\n**não é negrito**');
  await page.locator('#file').setInputFiles({name:'doc.md',mimeType:'text/markdown',buffer:Buffer.from('# Título\n\n**forte**\n\n| A | B |\n| - | - |\n| 1 | 2 |','utf8')});
  await expect(page.locator('#editor > h1')).toHaveText('Título');await expect(page.locator('#editor strong')).toHaveText('forte');await expect(page.locator('#editor table')).toHaveCount(1);
  source=await page.evaluate(()=>RMD.application.document().source);
  expect(source.kind).toBe('markdown');expect(source.originalText).toContain('| A | B |');expect(source.encoding).toBe('utf-8')
});
test('preview and send use the same renderer decision and payload',async({page})=>{
  let body;
  await page.route('**/api/send',async route=>{body=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{message_id:101}})})});
  await telegram(page);await setEditor(page,'<h2>Mesmo renderer</h2><p>Corpo</p>');
  const expected=await page.evaluate(()=>RMD.editor.render({isRtl:false,skipEntityDetection:false}));
  await page.locator('#previewTab').click();await expect(page.locator('#previewMechanism')).toHaveText(expected.mechanism);await page.locator('#editTab').click();
  await page.evaluate(()=>__tg.MainButton.handler());await expect.poll(()=>body).not.toBeUndefined();expect(body.richMessage).toEqual(expected.richMessage)
});


test('traditional inline keyboard survives preview, Web handoff and Telegram send',async({page})=>{
  const keyboard=[[{text:'Site',type:'url',url:'https://example.com',style:'primary'}],[{text:'Copiar',type:'copy_text',copyText:'ABC'}]];
  let transferBody;
  await page.route('**/api/transfers',async route=>{transferBody=route.request().postDataJSON();await route.fulfill({status:201,contentType:'application/json',body:JSON.stringify({ok:true,token:'k'.repeat(32),expiresAt:Date.now()+60000,telegramUrl:'https://t.me/rmdtxtml_test_bot?startapp='+('k'.repeat(32))})})});
  await page.route(/https:\/\/t\.me\/.*/,route=>route.fulfill({status:200,contentType:'text/html',body:'<html><body>Telegram</body></html>'}));
  await web(page);await setEditor(page,'<p>Com teclado</p>');
  await page.evaluate(value=>{RMD.application.document().options.inlineKeyboard=value},keyboard);
  await page.locator('#previewTab').click();
  await expect(page.locator('.previewKeyboard button')).toHaveCount(2);
  await expect(page.locator('.previewKeyboard button').first()).toHaveText('Site');
  await page.locator('#editTab').click();
  await page.locator('#send').click();await expect.poll(()=>transferBody).not.toBeUndefined();
  expect(transferBody.publication.inlineKeyboard).toEqual(keyboard);

  let sendBody;
  await page.route('**/api/send',async route=>{sendBody=route.request().postDataJSON();await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,result:{message_id:151}})})});
  await telegram(page);await setEditor(page,'<p>Com teclado</p>');
  await page.evaluate(value=>{RMD.application.document().options.inlineKeyboard=value},keyboard);
  await page.evaluate(()=>__tg.MainButton.handler());await expect.poll(()=>sendBody).not.toBeUndefined();
  expect(sendBody.inlineKeyboard).toEqual(keyboard)
});


test('document bar persists name and reports local saving states',async({page})=>{
  await web(page);await expect(page.locator('#docName')).toHaveText('Sem título');await expect(page.locator('#saveState')).toHaveText('Salvo');
  await page.locator('#docName').click();await expect(page.locator('#inputDialog')).toHaveJSProperty('open',true);
  await page.locator('#inputDialogValue').fill('Mensagem cliente');await page.locator('#inputDialogOk').click();
  await expect(page.locator('#docName')).toHaveText('Mensagem cliente');
  await expect(page.locator('#saveState')).toContainText(/Alterações locais|Salvando|Salvo/);
  await expect.poll(()=>page.locator('#saveState').textContent()).toBe('Salvo');
  await page.reload();await waitReady(page);await expect(page.locator('#docName')).toHaveText('Mensagem cliente')
});

test('H1 H2 H3 are distinct and preview switch does not mutate the document',async({page})=>{
  await web(page);await setEditor(page,'<p>Título</p>');const before=await page.evaluate(()=>RMD.editor.html());
  await page.locator('#more').click();await page.locator('[data-action="h1"]').click();await expect(page.locator('#editor > h1')).toHaveText('Título');
  await page.locator('#block').selectOption('h2');await expect(page.locator('#editor > h2')).toHaveText('Título');
  await page.locator('#block').selectOption('h3');await expect(page.locator('#editor > h3')).toHaveText('Título');
  const formatted=await page.evaluate(()=>RMD.editor.html());expect(formatted).not.toBe(before);
  await page.locator('#previewTab').click();await page.locator('#editTab').click();expect(await page.evaluate(()=>RMD.editor.html())).toBe(formatted)
});


test('product forms use the in-app accessible dialog instead of native browser prompts',async({page})=>{
  await web(page);await setEditor(page,'<p>Texto</p>');
  const nativeDialogs=[];page.on('dialog',dialog=>{nativeDialogs.push(dialog.type());dialog.dismiss()});
  await selectText(page,'Texto');await page.locator('#link').click();
  await expect(page.locator('#inputDialog')).toHaveJSProperty('open',true);
  await expect(page.locator('#inputDialogTitle')).toHaveText('Inserir link');
  await expect(page.locator('#inputDialogValue')).toBeFocused();
  await page.keyboard.press('Escape');await expect(page.locator('#inputDialog')).toHaveJSProperty('open',false);
  expect(nativeDialogs).toEqual([])
});

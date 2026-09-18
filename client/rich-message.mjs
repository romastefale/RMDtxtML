const ADVANCED=new Set([
  'heading','footer','blockquote','pullquote','code_block','divider','bullet_list','ordered_list',
  'math_block','anchor','image','video','audio','voice_note','document','map','collage','slideshow',
  'details','table','button','button_row'
]);

const asArray=value=>Array.isArray(value)?value:[];
const clean=x=>x&&typeof x==='object'?x:{};
const hasMark=(node,type)=>asArray(node?.marks).some(mark=>mark?.type===type);
const withoutMark=(node,type)=>({...node,marks:asArray(node?.marks).filter(mark=>mark?.type!==type)});

function compact(parts){
  const out=[];
  for(const value of parts.flat(Infinity)){
    if(value===undefined||value===null||value==='')continue;
    if(typeof value==='string'&&typeof out.at(-1)==='string')out[out.length-1]+=value;
    else out.push(value)
  }
  if(!out.length)return'';
  return out.length===1?out[0]:out
}

function wrapMarks(value,marks=[]){
  let out=value;
  for(const mark of [...marks].reverse()){
    const attrs=clean(mark.attrs);
    if(mark.type==='strong')out={type:'bold',text:out};
    else if(mark.type==='em')out={type:'italic',text:out};
    else if(mark.type==='underline')out={type:'underline',text:out};
    else if(mark.type==='strike')out={type:'strikethrough',text:out};
    else if(mark.type==='spoiler')out={type:'spoiler',text:out};
    else if(mark.type==='sub')out={type:'subscript',text:out};
    else if(mark.type==='sup')out={type:'superscript',text:out};
    else if(mark.type==='marked')out={type:'marked',text:out};
    else if(mark.type==='code')out={type:'code',text:out};
    else if(mark.type==='link'){
      const href=String(attrs.href||'');
      out=href.startsWith('#')
        ?{type:'anchor_link',text:out,anchor_name:href.slice(1)}
        :{type:'url',text:out,url:href}
    }else if(mark.type==='reference')out={type:'reference',text:out,name:String(attrs.name||'')}
  }
  return out
}

function richButton(node){
  const a=clean(node.attrs),type=String(a.type||'url');
  const button={text:richText(node.content)};
  if(a.style)button.style=String(a.style);
  if(type==='url')button.url=String(a.url||'');
  else if(type==='callback_data')button.callback_data=String(a.data||'');
  else if(type==='web_app')button.web_app={url:String(a.url||'')};
  else if(type==='login_url'){
    button.login_url={url:String(a.url||'')};
    if(a.forwardText)button.login_url.forward_text=String(a.forwardText);
    if(a.requestWriteAccess)button.login_url.request_write_access=true
  }else if(type==='switch_inline_query')button.switch_inline_query=String(a.query||'');
  else if(type==='switch_inline_query_current_chat')button.switch_inline_query_current_chat=String(a.query||'');
  else if(type==='switch_inline_query_chosen_chat'){
    button.switch_inline_query_chosen_chat={query:String(a.query||'')};
    for(const [attr,key] of [['allowUserChats','allow_user_chats'],['allowBotChats','allow_bot_chats'],['allowGroupChats','allow_group_chats'],['allowChannelChats','allow_channel_chats']])
      if(a[attr])button.switch_inline_query_chosen_chat[key]=true
  }else if(type==='copy_text')button.copy_text={text:String(a.text||'')};
  else if(type==='disabled')button.disabled={};
  return button
}

function inline(node){
  if(!node||typeof node!=='object')return'';
  if(node.type==='text')return wrapMarks(String(node.text||''),asArray(node.marks).filter(mark=>mark?.type!=='cite'));
  if(node.type==='custom_emoji')return{type:'custom_emoji',custom_emoji_id:String(node.attrs?.emojiId||''),alternative_text:String(node.attrs?.fallback||'')};
  if(node.type==='time')return{type:'date_time',text:String(node.attrs?.label||''),unix_time:Number(node.attrs?.unix||0),date_time_format:String(node.attrs?.format||'wDT')};
  if(node.type==='math_inline')return{type:'mathematical_expression',expression:String(node.attrs?.expression||'')};
  if(node.type==='anchor')return{type:'anchor',name:String(node.attrs?.name||'')};
  if(node.type==='button')return{type:'button',button:richButton(node)};
  return''
}

export function richText(content,{citeOnly=false,excludeCite=false}={}){
  return compact(asArray(content).map(node=>{
    const cited=hasMark(node,'cite');
    if(citeOnly&&!cited)return'';
    if(excludeCite&&cited)return'';
    return inline(cited?withoutMark(node,'cite'):node)
  }))
}

function hasRich(value){
  if(typeof value==='string')return value.length>0;
  if(Array.isArray(value))return value.length>0;
  return Boolean(value)
}

function caption(content){
  const text=richText(content,{excludeCite:true}),credit=richText(content,{citeOnly:true});
  if(!hasRich(text)&&!hasRich(credit))return undefined;
  const out={text:hasRich(text)?text:''};
  if(hasRich(credit))out.credit=credit;
  return out
}

function creditFrom(node){
  const parts=[];
  const walk=n=>{
    if(!n||typeof n!=='object')return;
    if(n.type==='text'&&hasMark(n,'cite'))parts.push(inline(withoutMark(n,'cite')));
    for(const child of asArray(n.content))walk(child)
  };
  walk(node);return compact(parts)
}

function textFromBlocks(content){
  const out=[];
  for(const block of asArray(content)){
    if(out.length)out.push('\n');
    if(['paragraph','heading','footer','pullquote','table_cell','table_header','details_summary','table_caption'].includes(block.type))
      out.push(richText(block.content,{excludeCite:true}));
    else if(block.type==='code_block')out.push(String(block.content?.map(x=>x.text||'').join('')||''));
    else out.push(String(block.textContent||''))
  }
  return compact(out)
}

function mediaBlock(type,src,cap,spoiler=false){
  const mediaType=type==='image'?'photo':type;
  const field=mediaType==='photo'?'photo':mediaType;
  const out={type:mediaType,[field]:{type:mediaType,media:String(src||'')}};
  if(spoiler&&(mediaType==='photo'||mediaType==='video'))out.has_spoiler=true;
  if(cap)out.caption=cap;
  return out
}

function listItem(item,index,parent){
  const a=clean(item.attrs),out={blocks:asArray(item.content).map(blockToInput).filter(Boolean)};
  if(a.checked!==null&&a.checked!==undefined){out.has_checkbox=true;if(a.checked)out.is_checked=true}
  if(parent.type==='ordered_list'){
    const base=Number(parent.attrs?.order||1),delta=parent.attrs?.reversed?-index:index;
    const value=Number.isInteger(a.value)?a.value:base+delta;
    out.value=value;
    out.type=String(a.style||parent.attrs?.style||'1')
  }
  return out
}

function cell(node){
  const a=clean(node.attrs),out={text:richText(node.content)};
  if(node.type==='table_header')out.is_header=true;
  if(Number(a.colspan)>1)out.colspan=Number(a.colspan);
  if(Number(a.rowspan)>1)out.rowspan=Number(a.rowspan);
  out.align=a.align||'left';out.valign=a.valign||'top';
  return out
}

export function blockToInput(node){
  if(!node||typeof node!=='object')return null;
  const a=clean(node.attrs),content=asArray(node.content);
  if(node.type==='paragraph')return{type:'paragraph',text:richText(content,{excludeCite:true})};
  if(node.type==='heading')return{type:'heading',text:richText(content,{excludeCite:true}),size:Number(a.level||2)};
  if(node.type==='footer')return{type:'footer',text:richText(content,{excludeCite:true})};
  if(node.type==='code_block'){
    const out={type:'pre',text:content.map(x=>x.text||'').join('')};if(a.language)out.language=String(a.language);return out
  }
  if(node.type==='divider')return{type:'divider'};
  if(node.type==='math_block')return{type:'mathematical_expression',expression:String(a.expression||'')};
  if(node.type==='anchor')return{type:'anchor',name:String(a.name||'')};
  if(node.type==='blockquote'){
    const credit=creditFrom(node);
    if(a.expandable){
      const out={type:'expandable_blockquote',text:textFromBlocks(content)};if(hasRich(credit))out.credit=credit;return out
    }
    const out={type:'blockquote',blocks:content.map(blockToInput).filter(Boolean)};if(hasRich(credit))out.credit=credit;return out
  }
  if(node.type==='pullquote'){
    const out={type:'pullquote',text:richText(content,{excludeCite:true})},credit=richText(content,{citeOnly:true});
    if(hasRich(credit))out.credit=credit;return out
  }
  if(node.type==='bullet_list'||node.type==='ordered_list')return{type:'list',items:content.map((item,index)=>listItem(item,index,node))};
  if(node.type==='image'||node.type==='video'||node.type==='audio'||node.type==='voice_note'||node.type==='document')
    return mediaBlock(node.type,String(a.src||''),caption(content),a.spoiler===true);
  if(node.type==='map'){
    const out={type:'map',location:{latitude:Number(a.lat),longitude:Number(a.long)}};
    if(Number.isInteger(a.zoom))out.zoom=a.zoom;if(Number.isInteger(a.width)&&a.width>0)out.width=a.width;if(Number.isInteger(a.height)&&a.height>0)out.height=a.height;
    const cap=caption(content);if(cap)out.caption=cap;return out
  }
  if(node.type==='collage'||node.type==='slideshow'){
    const out={type:node.type,blocks:asArray(a.items).map(item=>mediaBlock(item.type==='video'?'video':'image',item.src,undefined,item.spoiler===true))};
    const cap=caption(content);if(cap)out.caption=cap;return out
  }
  if(node.type==='table'){
    const capNode=content.find(x=>x.type==='table_caption');
    const rows=content.filter(x=>x.type==='table_row');
    const out={type:'table',cells:rows.map(row=>asArray(row.content).map(cell))};
    if(a.bordered)out.is_bordered=true;if(a.striped)out.is_striped=true;if(a.compact)out.is_compact=true;
    if(capNode)out.caption=richText(capNode.content);return out
  }
  if(node.type==='details'){
    const summary=content.find(x=>x.type==='details_summary');
    const blocks=content.filter(x=>x.type!=='details_summary').map(blockToInput).filter(Boolean);
    const out={type:'details',summary:richText(summary?.content||[]),blocks};if(a.open)out.is_open=true;return out
  }
  if(node.type==='button_row')return{type:'buttons',buttons:content.map(richButton),...(a.align&&a.align!=='left'?{align:a.align}:{})};
  if(node.type==='button')return{type:'paragraph',text:{type:'button',button:richButton(node)}};
  return null
}

function usesBlocks(model){
  let advanced=false;
  const walk=node=>{if(ADVANCED.has(node?.type))advanced=true;for(const child of asArray(node?.content))walk(child)};
  walk(model);return advanced
}

export function renderRichMessage(model,{html='',isRtl=false,skipEntityDetection=false}={}){
  const richMessage=usesBlocks(model)
    ?{blocks:asArray(model?.content).map(blockToInput).filter(Boolean)}
    :{html:String(html||'')};
  if(isRtl)richMessage.is_rtl=true;
  if(skipEntityDetection)richMessage.skip_entity_detection=true;
  return{
    mechanism:'Rich Message · '+(richMessage.blocks?'Blocks':'Rich HTML'),
    richMessage,
    previewHtml:String(html||'')
  }
}

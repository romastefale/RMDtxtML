import {Schema,DOMParser as PMDOMParser,DOMSerializer} from 'prosemirror-model';
import {AllSelection,EditorState,TextSelection} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {history,undo,redo} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap,setBlockType,toggleMark} from 'prosemirror-commands';
import {wrapInList,liftListItem,splitListItem} from 'prosemirror-schema-list';
import {gapCursor} from 'prosemirror-gapcursor';
import {renderRichMessage} from './rich-message.mjs';
import {markdownToHtml} from './importer.mjs';

const url=v=>/^(#|https?:|mailto:|tel:|tg:\/\/user\?id=)/i.test(String(v||''))?String(v):false;
const media=v=>/^(https?:\/\/|tg:\/(?:photo|video|document|audio|emoji)\?id=)/i.test(String(v||''))?String(v):false;
const escAttr=v=>String(v??'');
const bool=v=>v===true||v===''||v==='true';

const marks={
  strong:{parseDOM:[{tag:'strong'},{tag:'b'}],toDOM:()=>['strong',0]},
  em:{parseDOM:[{tag:'em'},{tag:'i'}],toDOM:()=>['em',0]},
  underline:{parseDOM:[{tag:'u'},{tag:'ins'}],toDOM:()=>['u',0]},
  strike:{parseDOM:[{tag:'s'},{tag:'strike'},{tag:'del'}],toDOM:()=>['s',0]},
  code:{code:true,excludes:'_',parseDOM:[{tag:'code'}],toDOM:()=>['code',0]},
  marked:{parseDOM:[{tag:'mark'}],toDOM:()=>['mark',0]},
  spoiler:{parseDOM:[{tag:'tg-spoiler'}],toDOM:()=>['tg-spoiler',0]},
  sub:{excludes:'sup',parseDOM:[{tag:'sub'}],toDOM:()=>['sub',0]},
  sup:{excludes:'sub',parseDOM:[{tag:'sup'}],toDOM:()=>['sup',0]},
  link:{
    attrs:{href:{}},inclusive:false,
    parseDOM:[{tag:'a[href]',getAttrs:el=>{const href=url(el.getAttribute('href'));return href?{href}:false}}],
    toDOM:mark=>['a',{href:mark.attrs.href},0]
  },
  cite:{parseDOM:[{tag:'cite'}],toDOM:()=>['cite',0]},
  reference:{
    attrs:{name:{}},
    parseDOM:[{tag:'tg-reference[name]',getAttrs:el=>({name:el.getAttribute('name')||''})}],
    toDOM:mark=>['tg-reference',{name:mark.attrs.name},0]
  }
};

const mediaAttrs=el=>{
  const src=media(el.getAttribute('src'));if(!src)return false;
  return{src,alt:el.getAttribute('alt')||'',spoiler:el.hasAttribute('tg-spoiler')}
};
const mediaNode=tag=>({
  group:'block',content:'inline*',selectable:true,
  attrs:{src:{default:''},alt:{default:''},spoiler:{default:false}},
  parseDOM:[
    {tag:'figure',getAttrs:figure=>{const el=figure.querySelector(':scope > '+tag);return el?mediaAttrs(el):false},contentElement:figure=>figure.querySelector(':scope > figcaption')||document.createElement('span')},
    {tag,getAttrs:el=>mediaAttrs(el)}
  ],
  toDOM:node=>node.childCount
    ?['figure',{},[tag,{src:node.attrs.src,...(node.attrs.alt?{alt:node.attrs.alt}:{}),...(node.attrs.spoiler?{'tg-spoiler':''}:{})}],['figcaption',0]]
    :[tag,{src:node.attrs.src,...(node.attrs.alt?{alt:node.attrs.alt}:{}),...(node.attrs.spoiler?{'tg-spoiler':''}:{})}]
});

const nodes={
  doc:{content:'block+'},
  text:{group:'inline button_inline'},
  paragraph:{content:'inline*',group:'block',parseDOM:[{tag:'p'}],toDOM:()=>['p',0]},
  heading:{
    attrs:{level:{default:2}},content:'inline*',group:'block',defining:true,
    parseDOM:[1,2,3,4,5,6].map(level=>({tag:'h'+level,attrs:{level}})),
    toDOM:node=>['h'+node.attrs.level,0]
  },
  footer:{content:'inline*',group:'block',parseDOM:[{tag:'footer'}],toDOM:()=>['footer',0]},
  blockquote:{
    attrs:{expandable:{default:false}},content:'block+',group:'block',defining:true,
    parseDOM:[{tag:'blockquote',getAttrs:el=>({expandable:el.hasAttribute('expandable')})}],
    toDOM:node=>['blockquote',node.attrs.expandable?{expandable:''}:{},0]
  },
  pullquote:{content:'inline*',group:'block',parseDOM:[{tag:'aside'}],toDOM:()=>['aside',0]},
  code_block:{
    attrs:{language:{default:''}},content:'text*',marks:'',group:'block',code:true,defining:true,
    parseDOM:[{tag:'pre',preserveWhitespace:'full',getAttrs:el=>{const c=el.querySelector(':scope > code[class^="language-"]');return{language:c?.className?.replace(/^language-/,'')||''}}}],
    toDOM:node=>['pre',{},['code',node.attrs.language?{class:'language-'+node.attrs.language}:{},0]]
  },
  divider:{group:'block',atom:true,parseDOM:[{tag:'hr'}],toDOM:()=>['hr']},
  bullet_list:{content:'list_item+',group:'block',parseDOM:[{tag:'ul'}],toDOM:()=>['ul',0]},
  ordered_list:{
    attrs:{order:{default:1},style:{default:'1'},reversed:{default:false}},content:'list_item+',group:'block',
    parseDOM:[{tag:'ol',getAttrs:el=>{const reversed=el.hasAttribute('reversed'),start=el.getAttribute('start');return{order:start!==null?Number(start):reversed?el.querySelectorAll(':scope > li').length:1,style:el.getAttribute('type')||'1',reversed}}}],
    toDOM:node=>['ol',{...(node.attrs.order!==1?{start:node.attrs.order}:{}),...(node.attrs.style!=='1'?{type:node.attrs.style}:{}),...(node.attrs.reversed?{reversed:''}:{})},0]
  },
  list_item:{
    attrs:{checked:{default:null},value:{default:null},style:{default:''}},content:'paragraph block*',defining:true,
    parseDOM:[{tag:'li',getAttrs:el=>{const box=el.querySelector(':scope > input[type="checkbox"]'),value=el.hasAttribute('value')?Number(el.getAttribute('value')):null;return{checked:box?box.checked:null,value:Number.isSafeInteger(value)?value:null,style:el.getAttribute('type')||''}}}],
    toDOM:node=>['li',{...(node.attrs.checked!==null?{'data-task':node.attrs.checked?'done':'open'}:{}),...(Number.isSafeInteger(node.attrs.value)?{value:node.attrs.value}:{}),...(node.attrs.style?{type:node.attrs.style}:{})},0]
  },
  math_inline:{
    inline:true,group:'inline',atom:true,attrs:{expression:{default:''}},
    parseDOM:[{tag:'tg-math',getAttrs:el=>({expression:el.textContent||''})}],
    toDOM:node=>['tg-math',node.attrs.expression]
  },
  math_block:{
    group:'block',atom:true,attrs:{expression:{default:''}},
    parseDOM:[{tag:'tg-math-block',getAttrs:el=>({expression:el.textContent||''})}],
    toDOM:node=>['tg-math-block',node.attrs.expression]
  },
  anchor:{
    inline:true,group:'inline',atom:true,attrs:{name:{default:''}},
    parseDOM:[{tag:'a[name]',getAttrs:el=>({name:el.getAttribute('name')||''})}],
    toDOM:node=>['a',{name:node.attrs.name}]
  },
  custom_emoji:{
    inline:true,group:'inline button_inline',atom:true,attrs:{emojiId:{default:''},fallback:{default:'🙂'}},
    parseDOM:[{tag:'tg-emoji[emoji-id]',getAttrs:el=>({emojiId:el.getAttribute('emoji-id')||'',fallback:el.textContent||'🙂'})}],
    toDOM:node=>['tg-emoji',{'emoji-id':node.attrs.emojiId},node.attrs.fallback]
  },
  time:{
    inline:true,group:'inline button_inline',atom:true,attrs:{unix:{default:''},format:{default:'wDT'},label:{default:''}},
    parseDOM:[{tag:'tg-time[unix]',getAttrs:el=>({unix:el.getAttribute('unix')||'',format:el.getAttribute('format')||'wDT',label:el.textContent||''})}],
    toDOM:node=>['tg-time',{unix:node.attrs.unix,format:node.attrs.format},node.attrs.label]
  },
  image:mediaNode('img'),
  video:mediaNode('video'),
  audio:mediaNode('audio'),
  document:{
    group:'block',content:'inline*',attrs:{src:{default:''}},
    parseDOM:[
      {tag:'figure',getAttrs:figure=>{const el=figure.querySelector(':scope > tg-document');if(!el)return false;const src=media(el.getAttribute('src'));return src?{src}:false},contentElement:figure=>figure.querySelector(':scope > figcaption')||document.createElement('span')},
      {tag:'tg-document',getAttrs:el=>{const src=media(el.getAttribute('src'));return src?{src}:false}}
    ],
    toDOM:node=>node.childCount?['figure',{},['tg-document',{src:node.attrs.src}],['figcaption',0]]:['tg-document',{src:node.attrs.src}]
  },
  map:{
    group:'block',content:'inline*',attrs:{lat:{default:0},long:{default:0},zoom:{default:14},width:{default:0},height:{default:0}},
    parseDOM:[
      {tag:'figure',getAttrs:figure=>{const el=figure.querySelector(':scope > tg-map');return el?mapAttrs(el):false},contentElement:figure=>figure.querySelector(':scope > figcaption')||document.createElement('span')},
      {tag:'tg-map',getAttrs:mapAttrs}
    ],
    toDOM:node=>{const attrs={lat:String(node.attrs.lat),long:String(node.attrs.long),zoom:String(node.attrs.zoom),...(node.attrs.width?{width:String(node.attrs.width)}:{}),...(node.attrs.height?{height:String(node.attrs.height)}:{})};return node.childCount?['figure',{},['tg-map',attrs],['figcaption',0]]:['tg-map',attrs]}
  },
  collage:mediaGroupNode('tg-collage'),
  slideshow:mediaGroupNode('tg-slideshow'),
  details:{
    group:'block',content:'details_summary block+',attrs:{open:{default:false}},
    parseDOM:[{tag:'details',getAttrs:el=>({open:el.hasAttribute('open')})}],
    toDOM:node=>['details',node.attrs.open?{open:''}:{},0]
  },
  details_summary:{content:'inline*',defining:true,parseDOM:[{tag:'summary'}],toDOM:()=>['summary',0]},
  table:{
    group:'block',content:'table_caption? table_row+',attrs:{bordered:{default:false},striped:{default:false},compact:{default:false}},
    parseDOM:[{tag:'table',getAttrs:el=>({bordered:el.hasAttribute('bordered'),striped:el.hasAttribute('striped'),compact:el.hasAttribute('compact')})}],
    toDOM:node=>['table',{...(node.attrs.bordered?{bordered:''}:{}),...(node.attrs.striped?{striped:''}:{}),...(node.attrs.compact?{compact:''}:{})},0]
  },
  table_caption:{content:'inline*',parseDOM:[{tag:'caption'}],toDOM:()=>['caption',0]},
  table_row:{content:'(table_header|table_cell)+',parseDOM:[{tag:'tr'}],toDOM:()=>['tr',0]},
  table_cell:{
    content:'inline*',attrs:{colspan:{default:1},rowspan:{default:1},align:{default:''},valign:{default:''}},
    parseDOM:[{tag:'td',getAttrs:cellAttrs}],toDOM:node=>['td',tableAttrs(node),0]
  },
  table_header:{
    content:'inline*',attrs:{colspan:{default:1},rowspan:{default:1},align:{default:''},valign:{default:''}},
    parseDOM:[{tag:'th',getAttrs:cellAttrs}],toDOM:node=>['th',tableAttrs(node),0]
  },
  button:{
    inline:true,group:'inline',content:'button_inline*',marks:'',
    attrs:{type:{default:'url'},style:{default:''},url:{default:''},data:{default:''},text:{default:''},query:{default:''},forwardText:{default:''},requestWriteAccess:{default:false},allowUserChats:{default:false},allowBotChats:{default:false},allowGroupChats:{default:false},allowChannelChats:{default:false}},
    parseDOM:[{tag:'tg-button',getAttrs:buttonAttrs}],
    toDOM:node=>['tg-button',buttonDomAttrs(node.attrs),0]
  },
  button_row:{
    group:'block',content:'button{1,8}',attrs:{align:{default:'left'}},
    parseDOM:[{tag:'tg-button-row',getAttrs:el=>({align:el.getAttribute('align')||'left'})}],
    toDOM:node=>['tg-button-row',{align:node.attrs.align},0]
  }
};

function mapAttrs(el){return{lat:Number(el.getAttribute('lat')||0),long:Number(el.getAttribute('long')||0),zoom:Number(el.getAttribute('zoom')||14),width:Number(el.getAttribute('width')||0),height:Number(el.getAttribute('height')||0)}}
function mediaGroupNode(tag){return{
  group:'block',content:'inline*',attrs:{items:{default:[]}},
  parseDOM:[{tag,getAttrs:el=>({items:[...el.querySelectorAll(':scope > img,:scope > video')].map(x=>({type:x.tagName==='VIDEO'?'video':'image',src:media(x.getAttribute('src'))||'',alt:x.getAttribute('alt')||'',spoiler:x.hasAttribute('tg-spoiler')}))}),contentElement:el=>el.querySelector(':scope > figcaption')||document.createElement('span')}],
  toDOM:node=>[tag,{},...node.attrs.items.map(item=>[item.type==='video'?'video':'img',{src:item.src,...(item.alt?{alt:item.alt}:{}),...(item.spoiler?{'tg-spoiler':''}:{})}]),...(node.childCount?[['figcaption',0]]:[])]
}}
function buttonAttrs(el){return{
  type:el.getAttribute('type')||'url',style:el.getAttribute('style')||'',url:el.getAttribute('url')||'',data:el.getAttribute('data')||'',text:el.getAttribute('text')||'',query:el.getAttribute('query')||'',
  forwardText:el.getAttribute('forward-text')||'',requestWriteAccess:el.hasAttribute('request-write-access'),allowUserChats:el.hasAttribute('allow-user-chats'),allowBotChats:el.hasAttribute('allow-bot-chats'),allowGroupChats:el.hasAttribute('allow-group-chats'),allowChannelChats:el.hasAttribute('allow-channel-chats')
}}
function buttonDomAttrs(a){return{
  type:a.type,...(a.style?{'data-rmd-style':a.style}:{}),...(a.url?{url:a.url}:{}),...(a.data?{data:a.data}:{}),...(a.text?{text:a.text}:{}),...(a.query?{query:a.query}:{}),...(a.forwardText?{'forward-text':a.forwardText}:{}),
  ...(a.requestWriteAccess?{'request-write-access':''}:{}),...(a.allowUserChats?{'allow-user-chats':''}:{}),...(a.allowBotChats?{'allow-bot-chats':''}:{}),...(a.allowGroupChats?{'allow-group-chats':''}:{}),...(a.allowChannelChats?{'allow-channel-chats':''}:{})
}}
function cellAttrs(el){return{colspan:Number(el.getAttribute('colspan')||1),rowspan:Number(el.getAttribute('rowspan')||1),align:el.getAttribute('align')||'',valign:el.getAttribute('valign')||''}}
function tableAttrs(node){return{...(node.attrs.colspan!==1?{colspan:node.attrs.colspan}:{}),...(node.attrs.rowspan!==1?{rowspan:node.attrs.rowspan}:{}),...(node.attrs.align?{align:node.attrs.align}:{}),...(node.attrs.valign?{valign:node.attrs.valign}:{})}}

const schema=new Schema({nodes,marks});
const EMPTY={type:'doc',content:[{type:'paragraph'}]};
const markMap={strong:'strong',em:'em',u:'underline',s:'strike',code:'code',mark:'marked','tg-spoiler':'spoiler',sub:'sub',sup:'sup',a:'link','tg-reference':'reference'};

function cleanContainer(html){
  const source=String(html??'').replace(/<(tg-map|tg-document)(\b[^>]*)\/>/gi,'<$1$2></$1>');
  const box=document.createElement('div');box.innerHTML=source;
  box.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(x=>x.remove());
  box.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{if(a.name.toLowerCase().startsWith('on'))el.removeAttribute(a.name)}));
  return box
}
function parseHtml(html){
  const box=cleanContainer(html),doc=PMDOMParser.fromSchema(schema).parse(box);
  return normalizeModel(doc.toJSON())
}
function assertSafeModel(node){
  node.check();
  node.descendants(child=>{
    for(const mark of child.marks||[]){
      if(mark.type===schema.marks.link&&!url(mark.attrs.href))throw new RangeError('unsafe_link');
      if(mark.type===schema.marks.reference&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(mark.attrs.name||'')))throw new RangeError('invalid_reference')
    }
    const a=child.attrs||{},name=child.type.name;
    if(name==='heading'&&(!Number.isInteger(a.level)||a.level<1||a.level>6))throw new RangeError('invalid_heading');
    if(['image','video','audio','document'].includes(name)&&!media(a.src))throw new RangeError('invalid_media');
    if(name==='anchor'&&!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(String(a.name||'')))throw new RangeError('invalid_anchor');
    if(name==='custom_emoji'&&!/^\d+$/.test(String(a.emojiId||'')))throw new RangeError('invalid_emoji');
    if(name==='time'&&!/^\d+$/.test(String(a.unix||'')))throw new RangeError('invalid_time');
    if(name==='map'){
      const w=Number(a.width||0),h=Number(a.height||0);
      if(!Number.isFinite(a.lat)||a.lat<-90||a.lat>90||!Number.isFinite(a.long)||a.long<-180||a.long>180||!Number.isInteger(a.zoom)||a.zoom<0||a.zoom>24||!Number.isInteger(w)||!Number.isInteger(h)||w<0||h<0||w>10000||h>10000||(w&&h&&(w+h>10000||Math.max(w/h,h/w)>20)))throw new RangeError('invalid_map')
    }
    if(name==='table_cell'||name==='table_header'){
      if(!Number.isInteger(a.colspan)||a.colspan<1||a.colspan>20||!Number.isInteger(a.rowspan)||a.rowspan<1||a.rowspan>100)throw new RangeError('invalid_table_span');
      if(a.align&&!['left','center','right'].includes(a.align))throw new RangeError('invalid_table_align');
      if(a.valign&&!['top','middle','bottom'].includes(a.valign))throw new RangeError('invalid_table_valign')
    }
    if(name==='list_item'){
      if(a.value!==null&&!Number.isSafeInteger(a.value))throw new RangeError('invalid_list_value');
      if(a.style&&!['1','a','A','i','I'].includes(a.style))throw new RangeError('invalid_list_style')
    }
    if(name==='collage'||name==='slideshow'){
      if(!Array.isArray(a.items)||a.items.length<1||a.items.length>20||a.items.some(item=>!['image','video'].includes(item?.type)||!/^https?:\/\//i.test(String(item?.src||''))))throw new RangeError('invalid_media_group')
    }
    if(name==='button_row'&&!['left','center','right'].includes(String(a.align||'')))throw new RangeError('invalid_button_align');
    if(name==='button'){
      const types=['url','callback_data','web_app','login_url','switch_inline_query','switch_inline_query_current_chat','switch_inline_query_chosen_chat','copy_text','disabled'];
      if(!types.includes(String(a.type||'')))throw new RangeError('invalid_button_type');
      if(a.style&&!['danger','success','primary','link'].includes(a.style))throw new RangeError('invalid_button_style');
      if(a.style==='link'&&a.type!=='callback_data')throw new RangeError('invalid_button_style');
      if(a.type==='url'&&!url(a.url))throw new RangeError('invalid_button_url');
      if((a.type==='web_app'||a.type==='login_url')&&!/^https:\/\//i.test(String(a.url||'')))throw new RangeError('invalid_button_url');
      if(a.type==='callback_data'&&(!String(a.data||'')||new TextEncoder().encode(String(a.data)).length>64))throw new RangeError('invalid_callback_data');
      if(a.type==='copy_text'&&!String(a.text||''))throw new RangeError('invalid_copy_text')
    }
    if(name==='blockquote'&&a.expandable){let invalid=false;child.forEach(block=>{if(block.type.name!=='paragraph')invalid=true});if(invalid)throw new RangeError('invalid_expandable_structure')}
  });
  return node
}
function normalizeModel(json){
  if(json===undefined||json===null)return structuredClone(EMPTY);
  try{return assertSafeModel(schema.nodeFromJSON(json)).toJSON()}catch{throw new Error('invalid_semantic_model')}
}
function toHtml(json){
  const node=schema.nodeFromJSON(normalizeModel(json)),frag=DOMSerializer.fromSchema(schema).serializeFragment(node.content);
  const box=document.createElement('div');box.append(frag);
  for(const li of box.querySelectorAll('li[data-task]')){
    const checked=li.getAttribute('data-task')==='done',input=document.createElement('input');
    input.setAttribute('type','checkbox');if(checked)input.setAttribute('checked','');li.removeAttribute('data-task');li.prepend(input)
  }
  return box.innerHTML.replace(/\bdata-rmd-style=/g,'style=')
}
function nodeText(node){
  let text=node.textContent||'';
  node.descendants(child=>{
    if(child.isText)return;
    if(child.type.name==='math_inline'||child.type.name==='math_block')text+=child.attrs.expression||'';
    if(child.type.name==='custom_emoji')text+=child.attrs.fallback||'';
    if(child.type.name==='time')text+=child.attrs.label||'';
    if(child.type.name==='details')text+=(child.attrs.summary||'')+(child.attrs.body||'');
    if(['image','video','audio','document','map','collage','slideshow'].includes(child.type.name))text+=child.textContent||'';
    if(child.type.name==='button')text+=child.textContent||'';
  });
  return text
}

function migrateModel(json,fromVersion=1){
  const source=structuredClone(json);
  if(Number(fromVersion)===2)return normalizeModel(source);
  if(Number(fromVersion)!==1)throw new Error('unsupported_model_version');
  const walk=node=>{
    if(!node||typeof node!=='object')return node;
    const content=Array.isArray(node.content)?node.content.map(walk):undefined,a={...(node.attrs||{})};
    if(node.type==='details'){
      const summary=String(a.summary||'Detalhes'),body=String(a.body||'');
      return{type:'details',attrs:{open:a.open===true},content:[{type:'details_summary',content:summary?[{type:'text',text:summary}]:[]},{type:'paragraph',content:body?[{type:'text',text:body}]:[]}]}
    }
    if(['image','video','audio'].includes(node.type)){
      const caption=String(a.caption||'');delete a.caption;
      return{type:node.type,attrs:a,...(caption?{content:[{type:'text',text:caption}]}:{})}
    }
    if(node.type==='document'){
      const caption=String(a.caption||'');return{type:'document',attrs:{src:a.src||''},...(caption?{content:[{type:'text',text:caption}]}:{})}
    }
    if(node.type==='map')return{type:'map',attrs:{lat:a.lat??0,long:a.long??0,zoom:a.zoom??14,width:0,height:0},...(content?.length?{content}:{})};
    if(node.type==='collage'||node.type==='slideshow'){
      const caption=String(a.caption||''),items=Array.isArray(a.items)?a.items.map(item=>({type:item?.type==='video'?'video':'image',src:item?.src||'',alt:item?.alt||'',spoiler:item?.spoiler===true})):[];
      return{type:node.type,attrs:{items},...(caption?{content:[{type:'text',text:caption}]}:{})}
    }
    if(node.type==='table'){
      const children=content||[];return{type:'table',attrs:{bordered:a.bordered===true,striped:a.striped===true,compact:a.compact===true},content:children}
    }
    if(node.type==='list_item')return{type:'list_item',attrs:{checked:a.checked??null,value:a.value??null,style:a.style||''},...(content?{content}:{})};
    if(node.type==='button_row'){
      const buttons=Array.isArray(a.buttons)?a.buttons:[],children=buttons.slice(0,8).map(b=>({type:'button',attrs:{type:b.type||'url',style:b.style||'',url:b.url||'',data:b.data||'',text:b.text||'',query:b.query||'',forwardText:b.forwardText||'',requestWriteAccess:b.requestWriteAccess===true,allowUserChats:b.allowUserChats===true,allowBotChats:b.allowBotChats===true,allowGroupChats:b.allowGroupChats===true,allowChannelChats:b.allowChannelChats===true},content:b.label?[{type:'text',text:String(b.label)}]:[]}));
      return{type:'button_row',attrs:{align:a.align||'left'},content:children}
    }
    return{...node,...(Object.keys(a).length?{attrs:a}:{}),...(content?{content}:{})}
  };
  return normalizeModel(walk(source))
}

function taskListItemView(node,view,getPos){
  const dom=document.createElement('li');
  if(node.attrs.checked===null)return{dom,contentDOM:dom};
  dom.className='rmd-task-item';dom.dataset.checked=node.attrs.checked?'true':'false';
  const input=document.createElement('input'),contentDOM=document.createElement('div');
  input.type='checkbox';input.checked=node.attrs.checked===true;input.contentEditable='false';input.className='rmd-task-checkbox';
  contentDOM.className='rmd-task-content';dom.append(input,contentDOM);
  const commit=()=>{
    if(typeof getPos!=='function')return;
    const pos=getPos(),current=view.state.doc.nodeAt(pos);
    if(!current||current.type!==schema.nodes.list_item)return;
    view.dispatch(view.state.tr.setNodeMarkup(pos,undefined,{...current.attrs,checked:input.checked}));view.focus()
  };
  input.addEventListener('change',commit);
  return{
    dom,contentDOM,
    update(next){
      if(next.type!==schema.nodes.list_item||next.attrs.checked===null)return false;
      input.checked=next.attrs.checked===true;dom.dataset.checked=next.attrs.checked?'true':'false';return true
    },
    stopEvent:event=>event.target===input,
    destroy:()=>input.removeEventListener('change',commit)
  }
}

class Editor{
  constructor(root,{change=()=>{}}={}){
    if(!root)throw new Error('editor_root_required');
    this.root=root;this.change=change;
    const initial=PMDOMParser.fromSchema(schema).parse(root);
    root.innerHTML='';
    this.plugins=[
      history(),gapCursor(),
      keymap({
        'Mod-z':undo,'Mod-y':redo,'Mod-Shift-z':redo,
        'Mod-b':toggleMark(schema.marks.strong),'Mod-i':toggleMark(schema.marks.em),'Mod-u':toggleMark(schema.marks.underline),
        Enter:splitListItem(schema.nodes.list_item)
      }),
      keymap(baseKeymap)
    ];
    this.view=new EditorView({mount:root},{
      state:EditorState.create({doc:initial,plugins:this.plugins}),
      dispatchTransaction:tr=>{const state=this.view.state.apply(tr);this.view.updateState(state);if(tr.docChanged)this.change()},
      transformPastedHTML:html=>toHtml(parseHtml(html)),
      nodeViews:{list_item:taskListItemView}
    });
  }
  model(){return this.view.state.doc.toJSON()}
  normalizeModel(json){return normalizeModel(json)}
  emptyModel(){return structuredClone(EMPTY)}
  parseHtml(html){return parseHtml(html)}
  html(){return toHtml(this.model())}
  migrateModel(json,fromVersion){return migrateModel(json,fromVersion)}
  render(options={}){return renderRichMessage(this.model(),{...options,html:this.html()})}
  parsePlainText(text){const lines=String(text).split(/\r?\n/);return normalizeModel({type:'doc',content:lines.map(line=>({type:'paragraph',...(line?{content:[{type:'text',text:line}]}:{})}))})}
  parseMarkdown(text){const result=markdownToHtml(text);return{model:parseHtml(result.html),html:result.html,warnings:result.warnings}}
  stats(){
    const doc=this.view.state.doc;let blocks=0,meaningful=false;
    const atomContent=new Set(['divider','math_inline','math_block','custom_emoji','time','image','video','audio','document','map','collage','slideshow','details','button','button_row']);
    doc.descendants(node=>{
      if(node.isBlock||node.type.name==='list_item')blocks++;
      if(node.isText&&node.text?.trim())meaningful=true;
      else if(atomContent.has(node.type.name))meaningful=true
    });
    return{text:[...nodeText(doc)].length,blocks,empty:!meaningful}
  }
  setModel(json,{history=true}={}){
    const doc=schema.nodeFromJSON(normalizeModel(json));
    this.view.updateState(EditorState.create({doc,plugins:this.plugins}));
    if(history)this.change();
  }
  setHtml(html,{history=true}={}){this.setModel(parseHtml(html),{history})}
  ownsSelection(){return this.view.hasFocus()}
  remember(){return this.view.state.selection}
  restore(){this.view.focus();return true}
  focus(){this.view.focus()}
  range(){
    const {from,to,empty}=this.view.state.selection;
    return{collapsed:empty,toString:()=>this.view.state.doc.textBetween(from,to,'\n')}
  }
  selectionText(){const{from,to}=this.view.state.selection;return this.view.state.doc.textBetween(from,to,'\n')}
  selectText(needle,occurrence=0){
    const target=String(needle),hits=[];if(!target)return false;
    this.view.state.doc.descendants((node,pos)=>{if(!node.isText)return;let at=-1,start=0;while((at=node.text.indexOf(target,start))>=0){hits.push({from:pos+at,to:pos+at+target.length});start=at+target.length}});
    const hit=hits[occurrence];if(!hit)return false;
    this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc,hit.from,hit.to)));this.view.focus();return true
  }
  selectAll(){this.view.dispatch(this.view.state.tr.setSelection(new AllSelection(this.view.state.doc)));this.view.focus();return true}
  setCursorInText(needle,offset=0){
    const target=String(needle);let hit=null;
    this.view.state.doc.descendants((node,pos)=>{if(hit||!node.isText)return;const at=node.text.indexOf(target);if(at>=0)hit=pos+at+Math.max(0,Math.min(target.length,Number(offset)||0))});
    if(hit===null)return false;this.view.dispatch(this.view.state.tr.setSelection(TextSelection.create(this.view.state.doc,hit)));this.view.focus();return true
  }
  selectionState(){const{from,to,empty}=this.view.state.selection;return{from,to,empty,text:this.view.state.doc.textBetween(from,to,'\n')}}
  hasFormat(tag){
    const type=schema.marks[markMap[String(tag||'').toLowerCase()]];if(!type)return false;
    const {from,to,empty,$from}=this.view.state.selection;
    if(empty)return !!(type.isInSet(this.view.state.storedMarks||$from.marks()));
    return this.view.state.doc.rangeHasMark(from,to,type)
  }
  topBlock(){
    const {$from}=this.view.state.selection;
    for(let d=$from.depth;d>0;d--){const n=$from.node(d);if(n.isBlock){if(n.type.name==='heading')return{tagName:'H'+n.attrs.level};if(n.type.name==='footer')return{tagName:'FOOTER'};return{tagName:'P'}}}
    return{tagName:'P'}
  }
  format(tag,attrs={}){
    const type=schema.marks[markMap[String(tag||'').toLowerCase()]];if(!type)return false;
    const sel=this.view.state.selection;if(sel.empty)return false;
    const ok=toggleMark(type,attrs)(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok
  }
  clear(){
    const {from,to,empty}=this.view.state.selection;if(empty)return false;
    this.view.dispatch(this.view.state.tr.removeMark(from,to).scrollIntoView());this.view.focus();return true
  }
  block(tag){
    const raw=String(tag||'').toLowerCase();let type=schema.nodes.paragraph,attrs=null;
    if(/^h[1-6]$/.test(raw)){type=schema.nodes.heading;attrs={level:Number(raw[1])}}
    else if(raw==='footer')type=schema.nodes.footer;else if(raw!=='p')return false;
    const ok=setBlockType(type,attrs)(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok
  }
  list(tag){
    const type=String(tag).toLowerCase()==='ol'?schema.nodes.ordered_list:schema.nodes.bullet_list;
    const {$from}=this.view.state.selection;
    for(let d=$from.depth;d>0;d--){
      const n=$from.node(d);
      if(n.type===schema.nodes.bullet_list||n.type===schema.nodes.ordered_list){
        if(n.type===type){const ok=liftListItem(schema.nodes.list_item)(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok}
        const pos=$from.before(d);this.view.dispatch(this.view.state.tr.setNodeMarkup(pos,type,n.type===schema.nodes.ordered_list?n.attrs:null));this.view.focus();return true
      }
    }
    const ok=wrapInList(type)(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok
  }
  insertNode(node){
    this.view.dispatch(this.view.state.tr.replaceSelectionWith(node).scrollIntoView());this.view.focus();return true
  }
  insertSpec(spec){return this.insertNode(schema.nodeFromJSON(spec))}
  insertText(text,marks=[]){
    const node=schema.text(String(text),marks.map(mark=>schema.markFromJSON(mark)));
    return this.insertNode(node)
  }
  taskList(items=[{text:'Tarefa',checked:false}]){
    const list=schema.nodes.bullet_list.create(null,items.map(item=>schema.nodes.list_item.create(
      {checked:item.checked===true},
      schema.nodes.paragraph.create(null,item.text?schema.text(String(item.text)):null)
    )));
    return this.insertNode(list)
  }
  undo(){const ok=undo(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok}
  redo(){const ok=redo(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok}
  destroy(){this.view.destroy()}
}

window.RMD=window.RMD||{};
Object.assign(window.RMD,{Editor,richSchema:schema,normalizeRichModel:normalizeModel,migrateRichModel:migrateModel,parseRichHtml:parseHtml,renderRichHtml:toHtml,renderRichMessage,EMPTY_RICH_MODEL:EMPTY});

import {Schema,DOMParser as PMDOMParser,DOMSerializer,Slice} from 'prosemirror-model';
import {EditorState} from 'prosemirror-state';
import {EditorView} from 'prosemirror-view';
import {history,undo,redo} from 'prosemirror-history';
import {keymap} from 'prosemirror-keymap';
import {baseKeymap,setBlockType,toggleMark} from 'prosemirror-commands';
import {wrapInList,liftListItem,splitListItem} from 'prosemirror-schema-list';
import {gapCursor} from 'prosemirror-gapcursor';

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

const mediaNode=(tag,type)=>({
  group:'block',atom:true,selectable:true,
  attrs:{src:{default:''},caption:{default:''},alt:{default:''},spoiler:{default:false}},
  parseDOM:[{tag,getAttrs:el=>({
    src:media(el.getAttribute('src'))||'',caption:el.closest('figure')?.querySelector('figcaption')?.textContent||'',
    alt:el.getAttribute('alt')||'',spoiler:el.hasAttribute('tg-spoiler')
  })}],
  toDOM:node=>['figure',{},[tag,{src:node.attrs.src,...(node.attrs.alt?{alt:node.attrs.alt}:{}),...(node.attrs.spoiler?{'tg-spoiler':''}:{})}],
    ...(node.attrs.caption?[['figcaption',node.attrs.caption]]:[])]
});

const nodes={
  doc:{content:'block*'},
  text:{group:'inline'},
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
    parseDOM:[{tag:'ol',getAttrs:el=>({order:Number(el.getAttribute('start')||1),style:el.getAttribute('type')||'1',reversed:el.hasAttribute('reversed')})}],
    toDOM:node=>['ol',{...(node.attrs.order!==1?{start:node.attrs.order}:{}),...(node.attrs.style!=='1'?{type:node.attrs.style}:{}),...(node.attrs.reversed?{reversed:''}:{})},0]
  },
  list_item:{
    attrs:{checked:{default:null}},content:'paragraph block*',defining:true,
    parseDOM:[{tag:'li',getAttrs:el=>{const box=el.querySelector(':scope > input[type="checkbox"]');return{checked:box?box.checked:null}}}],
    toDOM:node=>node.attrs.checked===null?['li',0]:['li',{'data-task':node.attrs.checked?'done':'open'},0]
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
    inline:true,group:'inline',atom:true,attrs:{emojiId:{default:''},fallback:{default:'🙂'}},
    parseDOM:[{tag:'tg-emoji[emoji-id]',getAttrs:el=>({emojiId:el.getAttribute('emoji-id')||'',fallback:el.textContent||'🙂'})}],
    toDOM:node=>['tg-emoji',{'emoji-id':node.attrs.emojiId},node.attrs.fallback]
  },
  time:{
    inline:true,group:'inline',atom:true,attrs:{unix:{default:''},format:{default:'wDT'},label:{default:''}},
    parseDOM:[{tag:'tg-time[unix]',getAttrs:el=>({unix:el.getAttribute('unix')||'',format:el.getAttribute('format')||'wDT',label:el.textContent||''})}],
    toDOM:node=>['tg-time',{unix:node.attrs.unix,format:node.attrs.format},node.attrs.label]
  },
  image:mediaNode('img','image'),
  video:mediaNode('video','video'),
  audio:mediaNode('audio','audio'),
  document:{
    group:'block',atom:true,attrs:{src:{default:''},caption:{default:''}},
    parseDOM:[{tag:'tg-document',getAttrs:el=>({src:media(el.getAttribute('src'))||'',caption:el.closest('figure')?.querySelector('figcaption')?.textContent||''})}],
    toDOM:node=>['figure',{},['tg-document',{src:node.attrs.src}],...(node.attrs.caption?[['figcaption',node.attrs.caption]]:[])]
  },
  map:{
    group:'block',atom:true,attrs:{lat:{default:0},long:{default:0},zoom:{default:14}},
    parseDOM:[{tag:'tg-map',getAttrs:el=>({lat:Number(el.getAttribute('lat')||0),long:Number(el.getAttribute('long')||0),zoom:Number(el.getAttribute('zoom')||14)})}],
    toDOM:node=>['tg-map',{lat:String(node.attrs.lat),long:String(node.attrs.long),zoom:String(node.attrs.zoom)}]
  },
  collage:{
    group:'block',atom:true,attrs:{items:{default:[]},caption:{default:''}},
    parseDOM:[{tag:'tg-collage',getAttrs:el=>({items:[...el.querySelectorAll(':scope > img')].map(x=>({src:media(x.getAttribute('src'))||'',alt:x.getAttribute('alt')||''})),caption:el.querySelector(':scope > figcaption')?.textContent||''})}],
    toDOM:node=>['tg-collage',{},...node.attrs.items.map(x=>['img',{src:x.src,alt:x.alt||''}]),...(node.attrs.caption?[['figcaption',node.attrs.caption]]:[])]
  },
  slideshow:{
    group:'block',atom:true,attrs:{items:{default:[]},caption:{default:''}},
    parseDOM:[{tag:'tg-slideshow',getAttrs:el=>({items:[...el.querySelectorAll(':scope > img')].map(x=>({src:media(x.getAttribute('src'))||'',alt:x.getAttribute('alt')||''})),caption:el.querySelector(':scope > figcaption')?.textContent||''})}],
    toDOM:node=>['tg-slideshow',{},...node.attrs.items.map(x=>['img',{src:x.src,alt:x.alt||''}]),...(node.attrs.caption?[['figcaption',node.attrs.caption]]:[])]
  },
  details:{
    group:'block',atom:true,attrs:{summary:{default:'Detalhes'},body:{default:''},open:{default:false}},
    parseDOM:[{tag:'details',getAttrs:el=>({summary:el.querySelector(':scope > summary')?.textContent||'Detalhes',body:[...el.children].filter(x=>x.tagName!=='SUMMARY').map(x=>x.textContent||'').join('\n'),open:el.hasAttribute('open')})}],
    toDOM:node=>['details',node.attrs.open?{open:''}:{},['summary',node.attrs.summary],['p',node.attrs.body]]
  },
  table:{
    group:'block',content:'table_row+',attrs:{bordered:{default:false},striped:{default:false},compact:{default:false}},
    parseDOM:[{tag:'table',getAttrs:el=>({bordered:el.hasAttribute('bordered'),striped:el.hasAttribute('striped'),compact:el.hasAttribute('compact')})}],
    toDOM:node=>['table',{...(node.attrs.bordered?{bordered:''}:{}),...(node.attrs.striped?{striped:''}:{}),...(node.attrs.compact?{compact:''}:{})},['tbody',0]]
  },
  table_row:{content:'(table_header|table_cell)+',parseDOM:[{tag:'tr'}],toDOM:()=>['tr',0]},
  table_cell:{
    content:'inline*',attrs:{colspan:{default:1},rowspan:{default:1},align:{default:''},valign:{default:''}},
    parseDOM:[{tag:'td',getAttrs:cellAttrs}],toDOM:node=>['td',tableAttrs(node),0]
  },
  table_header:{
    content:'inline*',attrs:{colspan:{default:1},rowspan:{default:1},align:{default:''},valign:{default:''}},
    parseDOM:[{tag:'th',getAttrs:cellAttrs}],toDOM:node=>['th',tableAttrs(node),0]
  },
  button_row:{
    group:'block',atom:true,attrs:{align:{default:'left'},buttons:{default:[]}},
    parseDOM:[{tag:'tg-button-row',getAttrs:el=>({align:el.getAttribute('align')||'left',buttons:[...el.querySelectorAll(':scope > tg-button')].map(b=>({
      type:b.getAttribute('type')||'url',style:b.getAttribute('style')||'',label:b.textContent||'',url:b.getAttribute('url')||'',
      data:b.getAttribute('data')||'',text:b.getAttribute('text')||'',query:b.getAttribute('query')||''
    }))})}],
    toDOM:node=>['tg-button-row',{align:node.attrs.align},...node.attrs.buttons.map(b=>['tg-button',{
      type:b.type,...(b.style?{style:b.style}:{}),...(b.url?{url:b.url}:{}),...(b.data?{data:b.data}:{}),...(b.text?{text:b.text}:{}),...(b.query?{query:b.query}:{})
    },b.label||'Botão'])]
  }
};

function cellAttrs(el){return{colspan:Number(el.getAttribute('colspan')||1),rowspan:Number(el.getAttribute('rowspan')||1),align:el.getAttribute('align')||'',valign:el.getAttribute('valign')||''}}
function tableAttrs(node){return{...(node.attrs.colspan!==1?{colspan:node.attrs.colspan}:{}),...(node.attrs.rowspan!==1?{rowspan:node.attrs.rowspan}:{}),...(node.attrs.align?{align:node.attrs.align}:{}),...(node.attrs.valign?{valign:node.attrs.valign}:{})}}

const schema=new Schema({nodes,marks});
const EMPTY={type:'doc',content:[{type:'paragraph'}]};
const markMap={strong:'strong',em:'em',u:'underline',s:'strike',code:'code',mark:'marked','tg-spoiler':'spoiler',sub:'sub',sup:'sup',a:'link','tg-reference':'reference'};

function cleanContainer(html){
  const box=document.createElement('div');box.innerHTML=String(html??'');
  box.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(x=>x.remove());
  box.querySelectorAll('*').forEach(el=>[...el.attributes].forEach(a=>{if(a.name.toLowerCase().startsWith('on'))el.removeAttribute(a.name)}));
  return box
}
function parseHtml(html){
  const box=cleanContainer(html),doc=PMDOMParser.fromSchema(schema).parse(box);
  return normalizeModel(doc.toJSON())
}
function normalizeModel(json){
  try{return schema.nodeFromJSON(json||EMPTY).toJSON()}catch{return structuredClone(EMPTY)}
}
function toHtml(json){
  const node=schema.nodeFromJSON(normalizeModel(json)),frag=DOMSerializer.fromSchema(schema).serializeFragment(node.content);
  const box=document.createElement('div');box.append(frag);
  for(const li of box.querySelectorAll('li[data-task]')){
    const checked=li.getAttribute('data-task')==='done',input=document.createElement('input');
    input.setAttribute('type','checkbox');if(checked)input.setAttribute('checked','');li.removeAttribute('data-task');li.prepend(input)
  }
  return box.innerHTML
}
function nodeText(node){
  let text=node.textContent||'';
  node.descendants(child=>{
    if(child.isText)return;
    if(child.type.name==='math_inline'||child.type.name==='math_block')text+=child.attrs.expression||'';
    if(child.type.name==='custom_emoji')text+=child.attrs.fallback||'';
    if(child.type.name==='time')text+=child.attrs.label||'';
    if(child.type.name==='details')text+=(child.attrs.summary||'')+(child.attrs.body||'');
    if(['image','video','audio','document'].includes(child.type.name))text+=child.attrs.caption||'';
    if(child.type.name==='collage'||child.type.name==='slideshow')text+=child.attrs.caption||'';
    if(child.type.name==='button_row')for(const b of child.attrs.buttons||[])text+=b.label||'';
  });
  return text
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
  stats(){
    const doc=this.view.state.doc;let blocks=0;
    doc.descendants(node=>{if(node.isBlock||node.type.name==='list_item')blocks++});
    return{text:[...nodeText(doc)].length,blocks}
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
  insert(html){
    const parsed=schema.nodeFromJSON(parseHtml(html)),slice=new Slice(parsed.content,0,0);
    this.view.dispatch(this.view.state.tr.replaceSelection(slice).scrollIntoView());this.view.focus()
  }
  blockHtml(html){this.insert(html)}
  undo(){const ok=undo(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok}
  redo(){const ok=redo(this.view.state,this.view.dispatch,this.view);if(ok)this.view.focus();return ok}
  destroy(){this.view.destroy()}
}

window.RMD=window.RMD||{};
Object.assign(window.RMD,{Editor,richSchema:schema,normalizeRichModel:normalizeModel,parseRichHtml:parseHtml,renderRichHtml:toHtml,EMPTY_RICH_MODEL:EMPTY});

(()=>{'use strict';
const BLOCK='P H1 H2 H3 H4 H5 H6 FOOTER BLOCKQUOTE ASIDE PRE UL OL FIGURE TG-MAP TG-COLLAGE TG-SLIDESHOW TABLE DETAILS TG-MATH-BLOCK TG-BUTTON-ROW HR'.split(' ');
const INLINE=new Set(['STRONG','EM','U','S','CODE','MARK','TG-SPOILER','A','SUB','SUP']);
const ALIAS={B:'STRONG',I:'EM',INS:'U',STRIKE:'S',DEL:'S'};
const tagName=x=>String(x||'').toUpperCase();
const inside=(root,node)=>!!node&&(node===root||root.contains(node));
const unwrap=node=>{const p=node.parentNode;if(!p)return;while(node.firstChild)p.insertBefore(node.firstChild,node);node.remove()};
class Editor{
  constructor(root,{change=()=>{}}={}){
    if(!root)throw new Error('editor_root_required');
    this.root=root;this.change=change;this.saved=null;this.past=[];this.future=[];this.timer=0;this.lock=false;this.composing=false;
    this.listen();this.remember();this.record(true);
  }
  listen(){
    document.addEventListener('selectionchange',()=>{if(this.ownsSelection())this.remember()});
    this.root.addEventListener('compositionstart',()=>{this.composing=true});
    this.root.addEventListener('compositionend',()=>{this.composing=false;this.afterInput()});
    this.root.addEventListener('input',()=>{if(!this.lock&&!this.composing)this.afterInput()});
    this.root.addEventListener('keydown',e=>{
      if(!(e.metaKey||e.ctrlKey)||e.altKey)return;
      const k=e.key.toLowerCase();
      if(k==='z'){e.preventDefault();e.shiftKey?this.redo():this.undo();return}
      if(k==='y'){e.preventDefault();this.redo();return}
      const map={b:'strong',i:'em',u:'u'};
      if(map[k]){e.preventDefault();this.format(map[k])}
    });
  }
  ownsSelection(){
    const s=getSelection();if(!s?.rangeCount)return false;const r=s.getRangeAt(0);
    return inside(this.root,r.startContainer)&&inside(this.root,r.endContainer);
  }
  range(){
    const s=getSelection();
    if(s?.rangeCount){const r=s.getRangeAt(0);if(inside(this.root,r.startContainer)&&inside(this.root,r.endContainer))return r}
    if(this.saved&&inside(this.root,this.saved.startContainer)&&inside(this.root,this.saved.endContainer))return this.saved.cloneRange();
    return null;
  }
  remember(){const r=this.range();if(r)this.saved=r.cloneRange();return this.saved}
  restore(){if(!this.saved||!inside(this.root,this.saved.startContainer)||!inside(this.root,this.saved.endContainer))return false;const s=getSelection();s.removeAllRanges();s.addRange(this.saved.cloneRange());return true}
  focus(){this.root.focus({preventScroll:true});this.restore()}
  pathMark(r=this.range()){
    if(!r)return null;
    const path=node=>{const out=[];while(node&&node!==this.root){const p=node.parentNode;if(!p)return null;out.unshift([...p.childNodes].indexOf(node));node=p}return node===this.root?out:null};
    return {start:path(r.startContainer),startOffset:r.startOffset,end:path(r.endContainer),endOffset:r.endOffset};
  }
  restorePath(mark){
    if(!mark?.start||!mark?.end)return false;
    const node=path=>{let n=this.root;for(const i of path){n=n?.childNodes?.[i];if(!n)return null}return n},sn=node(mark.start),en=node(mark.end);if(!sn||!en)return false;
    const limit=(n,o)=>n.nodeType===Node.TEXT_NODE?Math.min(o,n.data.length):Math.min(o,n.childNodes.length);
    try{const r=document.createRange();r.setStart(sn,limit(sn,mark.startOffset));r.setEnd(en,limit(en,mark.endOffset));this.select(r);return true}catch{return false}
  }
  textMark(r=this.range()){
    if(!r)return null;
    const pos=(node,offset)=>{const x=document.createRange();x.selectNodeContents(this.root);try{x.setEnd(node,offset)}catch{return 0}return x.toString().length};
    return {start:pos(r.startContainer,r.startOffset),end:pos(r.endContainer,r.endOffset)};
  }
  restoreText(mark){
    if(!mark)return this.end();
    const points=[];const w=document.createTreeWalker(this.root,NodeFilter.SHOW_TEXT);let n,total=0;
    while(n=w.nextNode()){points.push({n,start:total,end:total+n.data.length});total+=n.data.length}
    const point=value=>{for(const p of points)if(value<=p.end)return[p.n,Math.max(0,Math.min(p.n.data.length,value-p.start))];return points.length?[points.at(-1).n,points.at(-1).n.data.length]:[this.root,this.root.childNodes.length]};
    const [sn,so]=point(mark.start),[en,eo]=point(mark.end),r=document.createRange();r.setStart(sn,so);r.setEnd(en,eo);this.select(r)
  }
  select(r){const s=getSelection();s.removeAllRanges();s.addRange(r);this.saved=r.cloneRange()}
  end(){
    const r=document.createRange();r.selectNodeContents(this.root);r.collapse(false);this.select(r);return r
  }
  state(){return{html:this.root.innerHTML,mark:this.pathMark()}}
  record(force=false){
    const s=this.state(),last=this.past.at(-1);
    if(force||!last||last.html!==s.html){this.past.push(s);if(this.past.length>100)this.past.shift();this.future.length=0}
  }
  commit(){clearTimeout(this.timer);this.timer=0;this.record()}
  afterInput(){
    const mark=this.textMark(),changed=this.normalize();if(changed)this.restoreText(mark);else this.remember();
    clearTimeout(this.timer);this.timer=setTimeout(()=>this.record(),320);this.change();
  }
  normalize(){
    let changed=false;
    for(const old of [...this.root.querySelectorAll('strong,em,u,s,code,mark,tg-spoiler,sub,sup')]){
      if(!old.textContent&&!old.children.length){old.remove();changed=true}
    }
    for(const old of [...this.root.querySelectorAll('b,i,ins,strike,del')]){const name=ALIAS[old.tagName];if(!name)continue;const el=document.createElement(name.toLowerCase());while(old.firstChild)el.append(old.firstChild);old.replaceWith(el);changed=true}
    for(const n of [...this.root.childNodes]){
      if(n.nodeType===Node.TEXT_NODE&&n.data.trim()){const p=document.createElement('p');n.replaceWith(p);p.append(n);changed=true}
      else if(n.nodeType===Node.ELEMENT_NODE&&n.tagName==='DIV'){const p=document.createElement('p');while(n.firstChild)p.append(n.firstChild);n.replaceWith(p);changed=true}
    }
    if(!this.root.childNodes.length){this.root.innerHTML='<p><br></p>';changed=true}
    return changed;
  }
  mutate(fn,{mark=true}={}){
    this.commit();this.restore();const before=mark?this.textMark():null;this.lock=true;
    try{fn();this.normalize()}finally{this.lock=false}
    if(mark)this.restoreText(before);else this.remember();
    this.record();this.change();this.root.focus({preventScroll:true});
  }
  setHtml(html,{history=true}={}){
    clearTimeout(this.timer);this.lock=true;this.root.innerHTML=html||'<p><br></p>';this.normalize();this.lock=false;this.end();
    if(history){this.past=[];this.future=[];this.record(true)}else this.record();
    this.change();
  }
  insert(html){
    this.commit();this.restore();let r=this.range();if(!r){this.end();r=this.range()}
    const t=document.createElement('template');t.innerHTML=html;const frag=t.content,first=frag.firstChild,last=frag.lastChild;if(!first)return;
    this.lock=true;r.deleteContents();r.insertNode(frag);this.lock=false;
    const caret=document.createRange();caret.setStartAfter(last);caret.collapse(true);this.select(caret);this.normalize();this.record();this.change();this.root.focus({preventScroll:true});
  }
  blockHtml(html){this.insert(html+'<p><br></p>')}
  selectedTextNodes(r){
    const out=[],w=document.createTreeWalker(this.root,NodeFilter.SHOW_TEXT);let n;
    while(n=w.nextNode()){try{if(r.intersectsNode(n)&&n.data.length)out.push(n)}catch{}}
    return out;
  }
  hasFormat(tag,r){
    tag=tagName(tag);const nodes=this.selectedTextNodes(r);if(!nodes.length)return false;
    return nodes.every(n=>{let p=n.parentElement;while(p&&p!==this.root){if(p.tagName===tag)return true;p=p.parentElement}return false})
  }
  format(tag,attrs={}){
    tag=tagName(tag);if(!INLINE.has(tag))throw new Error('unsupported_inline');
    this.commit();this.restore();const r=this.range();if(!r||r.collapsed)return false;
    const remove=this.hasFormat(tag,r),frag=r.extractContents();
    if(remove){
      for(const el of [...frag.querySelectorAll(tag.toLowerCase())])unwrap(el);
      if(frag.firstElementChild?.tagName===tag)unwrap(frag.firstElementChild);
    }else{
      const w=document.createTreeWalker(frag,NodeFilter.SHOW_TEXT);const nodes=[];let n;while(n=w.nextNode())if(n.data.length)nodes.push(n);
      for(const text of nodes){let p=text.parentElement,found=false;while(p){if(p.tagName===tag){found=true;break}p=p.parentElement}if(found)continue;const el=document.createElement(tag.toLowerCase());for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);text.replaceWith(el);el.append(text)}
    }
    const first=frag.firstChild,last=frag.lastChild;if(!first)return false;
    r.insertNode(frag);const next=document.createRange();next.setStartBefore(first);next.setEndAfter(last);this.select(next);this.normalize();this.record();this.change();this.root.focus({preventScroll:true});return true
  }
  topBlock(node){
    if(node?.nodeType===Node.TEXT_NODE)node=node.parentElement;
    while(node&&node.parentElement!==this.root)node=node.parentElement;
    return node&&node.parentElement===this.root?node:null
  }
  blocks(r=this.range()){
    if(!r)return[];const out=[];
    for(const n of [...this.root.children]){try{if(r.intersectsNode(n))out.push(n)}catch{}}
    if(!out.length){const b=this.topBlock(r.startContainer);if(b)out.push(b)}
    return out
  }
  block(tag){
    tag=tagName(tag);if(!['P','H1','H2','H3','H4','H5','H6','FOOTER'].includes(tag))return false;
    const r=this.range();if(!r)return false;const nodes=this.blocks(r);if(!nodes.length)return false;
    this.mutate(()=>{for(const old of nodes){if(old.tagName===tag)continue;const el=document.createElement(tag.toLowerCase());while(old.firstChild)el.append(old.firstChild);old.replaceWith(el)}});return true
  }
  list(tag){
    tag=tagName(tag);if(!['UL','OL'].includes(tag))return false;const r=this.range();if(!r)return false;const nodes=this.blocks(r);if(!nodes.length)return false;
    this.mutate(()=>{
      if(nodes.length===1&&['UL','OL'].includes(nodes[0].tagName)){
        const list=nodes[0];
        if(list.tagName!==tag){const repl=document.createElement(tag.toLowerCase());while(list.firstChild)repl.append(list.firstChild);list.replaceWith(repl);return}
        const frag=document.createDocumentFragment();for(const li of [...list.children]){const p=document.createElement('p');while(li.firstChild)p.append(li.firstChild);frag.append(p)}list.replaceWith(frag);return
      }
      const list=document.createElement(tag.toLowerCase());nodes[0].before(list);
      for(const old of nodes){if(['UL','OL'].includes(old.tagName)){for(const li of [...old.children])list.append(li);old.remove();continue}const li=document.createElement('li');while(old.firstChild)li.append(old.firstChild);list.append(li);old.remove()}
    });return true
  }
  clear(){
    this.commit();this.restore();const r=this.range();if(!r||r.collapsed)return false;
    const frag=r.extractContents();
    for(const tag of [...INLINE])for(const el of [...frag.querySelectorAll(tag.toLowerCase())].reverse())unwrap(el);
    for(const el of [...frag.children])if(INLINE.has(el.tagName))unwrap(el);
    const marker=document.createElement('span');marker.dataset.rmdClear='';marker.append(frag);if(!marker.firstChild)return false;
    r.insertNode(marker);
    while(marker.parentElement!==this.root&&INLINE.has(marker.parentElement?.tagName)){
      const wrap=marker.parentElement,parent=wrap.parentNode,left=wrap.cloneNode(false),right=wrap.cloneNode(false);
      while(wrap.firstChild&&wrap.firstChild!==marker)left.append(wrap.firstChild);
      while(marker.nextSibling)right.append(marker.nextSibling);
      if(left.childNodes.length)parent.insertBefore(left,wrap);
      parent.insertBefore(marker,wrap);
      if(right.childNodes.length)parent.insertBefore(right,wrap);
      wrap.remove()
    }
    const parent=marker.parentNode,first=marker.firstChild,last=marker.lastChild;
    while(marker.firstChild)parent.insertBefore(marker.firstChild,marker);marker.remove();
    const next=document.createRange();next.setStartBefore(first);next.setEndAfter(last);this.select(next);
    this.normalize();this.record();this.change();this.root.focus({preventScroll:true});return true
  }
  undo(){
    this.commit();if(this.past.length<2)return false;const current=this.past.pop();this.future.push(current);this.apply(this.past.at(-1));return true
  }
  redo(){
    this.commit();const next=this.future.pop();if(!next)return false;this.past.push(next);this.apply(next);return true
  }
  apply(state){
    this.lock=true;this.root.innerHTML=state.html;this.lock=false;if(!this.restorePath(state.mark))this.end();this.change();this.root.focus({preventScroll:true})
  }
}
window.RMD=window.RMD||{};window.RMD.Editor=Editor;
})();
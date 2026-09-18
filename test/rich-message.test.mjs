import test from 'node:test';
import assert from 'node:assert/strict';
import {renderRichMessage} from '../client/rich-message.mjs';

const text=(value,marks=[])=>({type:'text',text:value,...(marks.length?{marks}:{})});

test('simple inline document uses exactly Rich HTML representation',()=>{
  const model={type:'doc',content:[{type:'paragraph',content:[text('Olá',[{type:'strong'}])]}]};
  const rendered=renderRichMessage(model,{html:'<p><strong>Olá</strong></p>',isRtl:true});
  assert.equal(rendered.mechanism,'Rich Message · Rich HTML');
  assert.deepEqual(rendered.richMessage,{html:'<p><strong>Olá</strong></p>',is_rtl:true});
  assert.equal('blocks' in rendered.richMessage,false);assert.equal('markdown' in rendered.richMessage,false)
});

test('advanced semantic document renders to Bot API 10.3 blocks without parallel representation',()=>{
  const model={type:'doc',content:[
    {type:'heading',attrs:{level:2},content:[text('Título')]},
    {type:'ordered_list',attrs:{order:3,style:'a',reversed:false},content:[{type:'list_item',attrs:{checked:null,value:7,style:'i'},content:[{type:'paragraph',content:[text('Item')]}]}]},
    {type:'details',attrs:{open:true},content:[{type:'details_summary',content:[text('Resumo',[{type:'strong'}])]},{type:'paragraph',content:[text('Corpo '),text('rico',[{type:'em'}])]}]},
    {type:'table',attrs:{bordered:true,striped:true,compact:true},content:[{type:'table_caption',content:[text('Legenda')]},{type:'table_row',content:[{type:'table_header',attrs:{colspan:1,rowspan:1,align:'center',valign:'middle'},content:[text('H')]},{type:'table_cell',attrs:{colspan:2,rowspan:1,align:'right',valign:'bottom'},content:[text('V')]}]}]},
    {type:'map',attrs:{lat:41.9,long:12.5,zoom:14,width:600,height:400},content:[text('Roma'),text('Fonte',[{type:'cite'}])]},
    {type:'slideshow',attrs:{items:[{type:'image',src:'https://example.com/a.jpg',alt:'',spoiler:false},{type:'video',src:'https://example.com/b.mp4',alt:'',spoiler:true}]},content:[text('Mídia')]},
    {type:'button_row',attrs:{align:'right'},content:[
      {type:'button',attrs:{type:'callback_data',style:'link',url:'',data:'go',text:'',query:'',forwardText:'',requestWriteAccess:false,allowUserChats:false,allowBotChats:false,allowGroupChats:false,allowChannelChats:false},content:[text('Abrir')]},
      {type:'button',attrs:{type:'disabled',style:'primary',url:'',data:'',text:'',query:'',forwardText:'',requestWriteAccess:false,allowUserChats:false,allowBotChats:false,allowGroupChats:false,allowChannelChats:false},content:[text('Off')]}
    ]}
  ]};
  const rendered=renderRichMessage(model,{html:'ignored',skipEntityDetection:true});
  assert.equal(rendered.mechanism,'Rich Message · Blocks');assert.equal('html' in rendered.richMessage,false);
  const b=rendered.richMessage.blocks;
  assert.deepEqual(b[0],{type:'heading',text:'Título',size:2});
  assert.equal(b[1].items[0].value,7);assert.equal(b[1].items[0].type,'i');
  assert.equal(b[2].type,'details');assert.equal(b[2].is_open,true);assert.equal(b[2].blocks[0].type,'paragraph');
  assert.equal(b[3].caption,'Legenda');assert.equal(b[3].is_compact,true);assert.equal(b[3].cells[0][1].colspan,2);
  assert.deepEqual(b[4].location,{latitude:41.9,longitude:12.5});assert.equal(b[4].caption.text,'Roma');assert.equal(b[4].caption.credit,'Fonte');
  assert.deepEqual(b[5].blocks.map(x=>x.type),['photo','video']);assert.equal(b[5].blocks[1].has_spoiler,true);
  assert.equal(b[6].buttons.length,2);assert.equal(b[6].buttons[0].callback_data,'go');assert.deepEqual(b[6].buttons[1].disabled,{});
  assert.equal(rendered.richMessage.skip_entity_detection,true)
});

test('reversed ordered lists preserve descending values',()=>{
  const model={type:'doc',content:[{type:'ordered_list',attrs:{order:3,style:'1',reversed:true},content:[
    {type:'list_item',attrs:{checked:null,value:null,style:''},content:[{type:'paragraph',content:[text('A')]}]},
    {type:'list_item',attrs:{checked:null,value:null,style:''},content:[{type:'paragraph',content:[text('B')]}]},
    {type:'list_item',attrs:{checked:null,value:null,style:''},content:[{type:'paragraph',content:[text('C')]}]}
  ]}]};
  const list=renderRichMessage(model,{html:'ignored'}).richMessage.blocks[0];
  assert.deepEqual(list.items.map(item=>item.value),[3,2,1])
});

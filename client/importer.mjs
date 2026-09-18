import MarkdownIt from 'markdown-it';

const markdown=new MarkdownIt({html:true,linkify:true,typographer:false,breaks:false});

function taskLists(html){
  return html.replace(/<li>\s*\[([ xX])\]\s*/g,(_,state)=>'<li><input type="checkbox"'+(state.toLowerCase()==='x'?' checked':'')+'>')
}
function compatibilityWarnings(source){
  const warnings=[];
  if(/^\s*---\s*$[\s\S]*?^\s*---\s*$/m.test(source))warnings.push('front_matter_preserved_in_original');
  if(/\[\^[^\]]+\]|^\[\^[^\]]+\]:/m.test(source))warnings.push('footnotes_preserved_in_original');
  if(/(^|\s)==[^=\n]+==(\s|$)/m.test(source))warnings.push('highlight_extension_preserved_in_original');
  if(/(^|\s)\|\|[^|\n]+\|\|(\s|$)/m.test(source))warnings.push('spoiler_extension_preserved_in_original');
  if(/<\s*(script|iframe|object|embed|style|link|meta)\b|\son[a-z]+\s*=|\b(?:href|src)\s*=\s*["']?\s*javascript:/i.test(source))warnings.push('unsafe_html_removed_from_interpretation');
  return [...new Set(warnings)]
}
export function markdownToHtml(source){
  const text=String(source??'');
  return{html:taskLists(markdown.render(text)),warnings:compatibilityWarnings(text)}
}

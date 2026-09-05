// Paper Report layout system; content comes only from the contract.
const fs = require('node:fs');
const path = require('node:path');
const PptxGenJS = require('pptxgenjs');
const pkg = path.resolve(path.dirname(require.resolve('pptxgenjs')), '../package.json');
const pptxgenVersion = JSON.parse(fs.readFileSync(pkg)).version;
if (!/^4\./.test(pptxgenVersion)) throw new Error(`Requires PptxGenJS 4.x; found ${pptxgenVersion}`);
const [input, output] = process.argv.slice(2);
if (!input || !output || process.argv.length !== 4) throw new Error('Usage: node build.cjs prepared.json output.pptx');
const d = JSON.parse(fs.readFileSync(input, 'utf8'));
const pptx = new PptxGenJS();
pptx.defineLayout({name:'REPORT', width:13.333, height:7.5}); pptx.layout='REPORT';
pptx.title=d.meta.title; pptx.subject='Paper discussion'; pptx.author=d.meta.presenter || '';
pptx.lang=d.meta.slide_language; pptx.theme={headFontFace:d.meta.font_face || 'Arial', bodyFontFace:d.meta.font_face || 'Arial', lang:d.meta.slide_language};
const C={navy:'173A5E',teal:'0E7490',teal2:'DDF2F5',green:'2F9E76',green2:'E4F4ED',gold:'E7A928',gold2:'FFF4D6',coral:'E45756',coral2:'FBE9E8',purple:'6D5BD0',purple2:'EEEAFB',ink:'1E293B',muted:'56657A',gray:'D5DDE6',light:'F5F7FA',white:'FFFFFF'};
const palette=[[C.teal,C.teal2],[C.gold,C.gold2],[C.green,C.green2],[C.coral,C.coral2],[C.purple,C.purple2]];
const S=pptx.ShapeType;
function text(s,v,x,y,w,h,opt={}) {if(v) s.addText(String(v),{x,y,w,h,fontFace:d.meta.font_face||'Arial',fontSize:18,color:C.ink,margin:0,breakLine:false,valign:'mid',...opt});}
function rect(s,x,y,w,h,fill,line=fill) {s.addShape(S.rect,{x,y,w,h,fill:{color:fill},line:{color:line,width:0.5}});}
function line(s,x,y,w,h,color=C.gray,arrow=false) {s.addShape(S.line,{x,y,w,h,line:{color,width:1.2,...(arrow?{endArrowType:'triangle'}:{})}});}
function block(s,item,x,y,w,h,i=0) {const [c,bg]=palette[i%palette.length];rect(s,x,y,w,h,bg);rect(s,x,y,.07,h,c);text(s,item.heading,x+.2,y+.13,w-.4,.48,{fontSize:17,bold:true,color:c});text(s,item.text,x+.2,y+.77,w-.4,h-.9,{fontSize:16,valign:'top'});}
function figure(s,id,x,y,w,h,align='center') {
 const a=d.assets.find(a=>a.id===id), b=fs.readFileSync(a.file);
 if(b.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw new Error('Figures must be PNG');
 const r=b.readUInt32BE(16)/b.readUInt32BE(20);
 let iw=w,ih=w/r;
 if(ih>h){ih=h;iw=h*r;}
 const bounds={x:x+(w-iw)/2,y:align==='top'?y:y+(h-ih)/2,w:iw,h:ih};
 s.addImage({path:a.file,...bounds});
 return bounds;
}
function chrome(s,p,n) {text(s,p.title,.62,.25,10.9,.5,{fontSize:27,bold:true,color:C.navy});text(s,p.section,11.45,.28,1.25,.28,{fontSize:9.5,bold:true,color:C.teal,align:'right'});line(s,.62,.84,12.05,0);text(s,p.footer,.62,7.17,10.9,.18,{fontSize:8.5,color:C.muted});text(s,n,12.05,7.11,.55,.24,{fontSize:10,bold:true,color:C.muted,align:'right'});if(p.takeaway){rect(s,.62,6.57,12.05,.45,C.teal2);rect(s,.62,6.57,.09,.45,C.teal);text(s,p.takeaway,.83,6.61,11.6,.34,{fontSize:16,bold:true,color:C.teal});}}
for (const [i,p] of d.slides.entries()) {
 const s=pptx.addSlide();s.background={color:C.white};s.addNotes(p._notes);
 if(p.layout==='cover') {
  rect(s,0,0,13.333,.18,C.teal);text(s,p.section,.9,.88,8.3,.3,{fontSize:12,bold:true,color:C.teal});
  text(s,p.title,.86,1.62,8.4,.9,{fontSize:48,bold:true,color:C.navy});text(s,p.subtitle,.88,2.65,8.4,1.2,{fontSize:30,bold:true,valign:'top'});
  text(s,p.authors,.9,4.15,8.4,.58,{fontSize:14,color:C.muted,valign:'top'});text(s,d.meta.presenter?`Presenter: ${d.meta.presenter}`:'',.9,5.05,8.4,.35,{fontSize:17,bold:true,color:C.navy});
  text(s,`${d.slides.length} slides | Planned talk: ${Math.round(d.slides.reduce((n,v)=>n+v.seconds,0)/60)} min`,.9,5.55,8.3,.28,{fontSize:13,color:C.muted});
  if(p.items) {rect(s,9.65,1.26,2.7,4.9,C.light,C.gray);p.items.forEach((it,j)=>{let y=1.7+j*1.4;text(s,it.heading,9.9,y,2.18,.48,{fontSize:17,bold:true,color:palette[j][0]});text(s,it.text,9.9,y+.58,2.18,.65,{fontSize:14,valign:'top'});});}
  line(s,.9,6.63,11.55,0);text(s,p.footer,.9,6.83,10.9,.25,{fontSize:10.5,color:C.muted});text(s,i+1,12.05,7.11,.55,.24,{fontSize:10,align:'right'});
 } else if(p.layout==='section') {
  rect(s,0,0,.2,7.5,C.gold);text(s,p.section,.85,.95,11.5,.4,{fontSize:14,bold:true,color:C.teal});text(s,p.title,.85,2.0,11.3,1.0,{fontSize:34,bold:true,color:C.navy});text(s,p.subtitle,.85,3.5,11.3,1.4,{fontSize:22,color:C.muted});line(s,.85,6.6,11.6,0);text(s,p.footer,.85,6.9,10.8,.25,{fontSize:10,color:C.muted});text(s,i+1,12.05,7.11,.55,.24,{fontSize:10,align:'right'});
 } else {
  chrome(s,p,i+1);
  if(p.layout==='bullets') {const step=5.1/p.items.length;p.items.forEach((it,j)=>{const y=1.1+j*step;rect(s,.68,y,11.94,step-.13,j%2?C.white:C.light);rect(s,.68,y,.07,step-.13,palette[j%5][0]);text(s,it.heading,.9,y+.11,3.2,step-.35,{fontSize:17,bold:true,color:C.navy});text(s,it.text,4.35,y+.11,7.95,step-.35,{fontSize:17});});}
  if(p.layout==='comparison') {const w=(12.05-(p.items.length-1)*.3)/p.items.length;p.items.forEach((it,j)=>block(s,it,.62+j*(w+.3),1.3,w,4.65,j));}
  if(p.layout==='flow') {const w=(12.05-(p.items.length-1)*.38)/p.items.length;p.items.forEach((it,j)=>{block(s,it,.62+j*(w+.38),2.05,w,3.2,j);if(j<p.items.length-1)line(s,.62+j*(w+.38)+w+.04,3.65,.29,0,C.muted,true);});}
  if(p.layout==='figure') {
   const opt=p.figure_options, wide=opt?.placement==='wide', side=!!p.items&&!wide;
   const maxH=wide&&p.items?3.1:4.7;
   const bounds=figure(s,p.figures[0],.68,1.08,side?7.8:11.9,opt?.height??maxH,opt?.align??(opt?'top':'center'));
   if(side){const h=4.7/p.items.length;p.items.forEach((it,j)=>block(s,it,8.8,1.08+j*h,3.8,h-.15,j));}
   if(wide&&p.items){const w=(12.05-(p.items.length-1)*.3)/p.items.length;p.items.forEach((it,j)=>block(s,it,.62+j*(w+.3),4.72,w,1.56,j));}
   text(s,p.caption,.68,opt?bounds.y+bounds.h+.12:5.95,opt?(side?7.8:11.9):11.9,.42,{fontSize:13.5,color:C.muted,...(opt?{valign:'top'}:{})});
  }
  if(p.layout==='two-figures') {p.figures.forEach((id,j)=>{figure(s,id,.68+j*6.12,1.1,5.8,3.7);block(s,p.items[j],.68+j*6.12,4.96,5.8,1.25,j);});text(s,p.caption,.68,6.25,11.9,.2,{fontSize:10.5,color:C.muted});}
  if(p.layout==='figure-grid') {
   const cols=p.columns??(p.figures.length===4?2:p.figures.length),rows=Math.ceil(p.figures.length/cols);
   const gap=.3,w=(11.94-(cols-1)*gap)/cols,h=(5.08-(rows-1)*gap)/rows;
   p.figures.forEach((id,j)=>{
    const x=.68+(j%cols)*(w+gap),y=1.08+Math.floor(j/cols)*(h+gap),annotation=p.items?.[j];
    const bounds=figure(s,id,x,y,w,h-(annotation?.text?1.04:0),'top');
    if(annotation){
     const ty=bounds.y+bounds.h+.12;
     text(s,annotation.heading,x,ty,w,.28,{fontSize:17,bold:true,color:palette[j%palette.length][0]});
     text(s,annotation.text,x,ty+.36,w,.56,{fontSize:16,valign:'top'});
    }
   });
   text(s,p.caption,.68,6.25,11.9,.22,{fontSize:10.5,color:C.muted});
  }
  if(p.layout==='table') {const rows=[p.columns.map(v=>({text:v,options:{bold:true,color:C.navy,fill:C.teal2}})),...p.rows];s.addTable(rows,{x:.68,y:1.3,w:11.94,h:4.55,fontFace:d.meta.font_face||'Arial',fontSize:17,color:C.ink,fill:C.light,border:{type:'solid',pt:1,color:C.white},margin:.13,rowH:4.55/rows.length,colW:p.columns.map(()=>11.94/p.columns.length),autoPage:false,verbose:false});text(s,p.caption,.68,6,11.9,.4,{fontSize:13.5,color:C.muted});}
 }
}
pptx.writeFile({fileName:output,compression:true}).then(()=>console.log(output));

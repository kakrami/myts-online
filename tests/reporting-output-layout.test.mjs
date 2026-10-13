import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {REPORT_COLUMNS} from '../src/reporting/service.js';
import {concat,pdfFont,pdfStart,pdfPage,pdfPagesObject,pdfXref} from '../src/reporting/encoders.js';
import * as legacy from './fixtures/report-encoders-939cbc5.mjs';

const out=new URL('../tmp/report-output-layout/',import.meta.url),font=pdfFont(await readFile(new URL('../web/assets/report-font.ttf',import.meta.url)));
async function encode(type,{resume=false}={}){
 const snapshot={scope_label:'Sample team · '+type,season_label:'2026/27',created_at:Date.parse('2026-10-13T12:00:00Z'),scope_note:'Immutable report · complete ordered rows. Missing values and source evidence remain explicit.'},columns=REPORT_COLUMNS[type];
 const rows=Array.from({length:137},(_,i)=>Object.fromEntries([...columns.map(c=>[c.key,c.numeric?(c.digits===undefined?i:i/3):c.key==='metric'||c.key==='player'||c.key==='opponent'?'Entry-'+String(i).padStart(3,'0')+(i%7===0?'\nSecond line with descenders gyp and a longer wrapped name':''):c.key==='date'?'2026-09-01':c.key==='value'?'A known value with descenders gyp':c.label]),['_report_note',i%3===0?'Evidence note with descenders gyp. '+('Some values are unavailable; the row remains included. '.repeat(i%7===0?5:1)):null]]));
 const start=resume?legacy.pdfStart(font):pdfStart(font),parts=[start.data],objects=[...start.objects];let state=start.state;
 if(resume){const page=legacy.pdfPage(state,snapshot,columns,rows.slice(0,50),font);parts.push(page.data);objects.push(...page.objects);state=page.state;}
 while(state.row<rows.length){const page=pdfPage(state,{...snapshot,encoder_legacy:resume},columns,rows.slice(state.row,state.row+50),font);assert.ok(page.consumed>0);parts.push(page.data);objects.push(...page.objects);state=page.state;}
 const pages=pdfPagesObject(state);parts.push(pages.data);objects.push(...pages.objects);state=pages.state;
 const xref=pdfXref(state,objects.map(o=>({object_id:o.id,byte_offset:o.offset})));assert.equal(xref.complete,true);parts.push(xref.data);
 await mkdir(out,{recursive:true});const path=new URL(type+(resume?'-legacy-resumed':'')+'.pdf',out).pathname;await writeFile(path,concat(parts));return {path,pages:state.page};
}
const inspect=String.raw`import json,sys,pdfplumber
with pdfplumber.open(sys.argv[1]) as doc:
 pages=doc.pages[int(sys.argv[2]):]
 intersections=[]; gaps=[]; rules=0; counts=[]
 for number,page in enumerate(pages):
  counts.append(len(page.chars))
  for rule in page.lines:
   if abs(rule['y0']-rule['y1'])>0.01: continue
   rules+=1
   for char in page.chars:
    if not char['text'].strip() or char['x1']<rule['x0'] or char['x0']>rule['x1']: continue
    y=rule['y0']
    gap=max(char['y0']-y,y-char['y1'])
    gaps.append(gap)
    if gap<1: intersections.append({'page':number,'text':char['text'],'line_y':y,'glyph_y':[char['y0'],char['y1']]})
 text='\n'.join(p.extract_text() or '' for p in doc.pages)
 print(json.dumps({'pages':len(doc.pages),'rules':rules,'intersections':intersections[:20],'min_gap':min(gaps),'text':text,'counts':counts}))`;

for(const type of Object.keys(REPORT_COLUMNS))test(`${type} PDF rules clear every glyph across multiline rows, notes and pages`,async()=>{
 const result=await encode(type),parsed=JSON.parse(execFileSync('python',['-c',inspect,result.path,'0'],{encoding:'utf8'}));assert.ok(result.pages>1);assert.ok(parsed.rules>=137);assert.deepEqual(parsed.intersections,[]);assert.ok(parsed.min_gap>=1);assert.deepEqual([...parsed.text.matchAll(/Entry-\d{3}/g)].map(m=>m[0]),Array.from({length:137},(_,i)=>'Entry-'+String(i).padStart(3,'0')));assert.ok(parsed.counts.every(n=>n>0));console.log(JSON.stringify({report_layout:type,pages:parsed.pages,rules:parsed.rules,minimum_glyph_clearance_pt:parsed.min_gap}));
});

test('resuming unversioned PDF preserves old pages and fixes new-page row geometry',async()=>{
 const result=await encode('season',{resume:true}),parsed=JSON.parse(execFileSync('python',['-c',inspect,result.path,'1'],{encoding:'utf8'}));assert.ok(parsed.pages>2);assert.deepEqual(parsed.intersections,[]);assert.deepEqual([...parsed.text.matchAll(/Entry-\d{3}/g)].map(m=>m[0]),Array.from({length:137},(_,i)=>'Entry-'+String(i).padStart(3,'0')));
});

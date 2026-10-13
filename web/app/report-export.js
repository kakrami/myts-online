import {bytes,concat,xlsxStart,xlsxPage,xlsxNotesStart,xlsxNotesPage,xlsxFinish,pdfFont,pdfStart,pdfPage,pdfPagesObject,pdfXref} from './reporting/encoders.js';
import {FONT_METRICS} from './reporting/font-metrics.js';

// First-page optimization only. No DOM cells, retained preview window, further
// page requests, or live source data are ever passed to the shared encoders.
export const SMALL_REPORT_LIMITS=Object.freeze({rows:50,columns:16,cells:800,inputBytes:128*1024,characters:64000,cellCharacters:8000,pages:50,outputBytes:2*1024*1024});
const types=new Set(['season','matches','players','availability']);
export function isSmallReportCandidate(model){const rows=model?.rows;return model?.state==='ready'&&Number.isSafeInteger(rows?.total)&&rows.total>=0&&rows.total<=SMALL_REPORT_LIMITS.rows&&Array.isArray(rows.items)&&rows.items.length===rows.total&&rows.next_cursor===null&&(rows.loaded===undefined||rows.loaded===rows.total)&&(rows.start===undefined||rows.start===0);}
const expired=()=>Object.assign(new Error('This report has expired. Prepare it again.'),{code:'report_expired',status:410});
const wrongScope=()=>Object.assign(new Error('This report no longer matches the selected team, season or snapshot.'),{code:'report_scope',status:403});
const time=value=>typeof value==='number'?value:Date.parse(value);

export function smallReportInput(envelope,{snapshotId,type,teamId,seasonId,now=Date.now()}={}){
 const model=envelope?.data,selection=envelope?.selection;
 if(!model||model.snapshot_id!==snapshotId||model.type!==type||selection?.team_id!==teamId||selection?.team_season_id!==seasonId)throw wrongScope();
 const expiry=time(model.expires_at);if(Number.isFinite(expiry)&&expiry<=now)throw expired();
 // Older server metadata and unsupported shapes use the existing server path.
 if(!isSmallReportCandidate(model)||model.rows.start!==0||model.captured!==model.rows.total||!Number.isFinite(expiry)||!Number.isFinite(time(model.created_at))||!types.has(type)||!Number.isSafeInteger(envelope.revision?.content))return null;
 const {columns,rows}=model,limits=SMALL_REPORT_LIMITS;
 if(!Array.isArray(columns)||!columns.length||columns.length>limits.columns||columns.length*rows.total>limits.cells)return null;
 let characters=0;const scalar=value=>{if(value==null)return true;if(typeof value==='number')return Number.isFinite(value);if(typeof value!=='string'||value.length>limits.cellCharacters)return false;characters+=value.length;return characters<=limits.characters;};
 if(![model.scope_label,model.season_label,model.scope_note].every(value=>typeof value==='string'&&scalar(value)))return null;
 const keys=new Set();for(const column of columns){if(!column||typeof column.key!=='string'||keys.has(column.key)||!scalar(column.key)||typeof column.label!=='string'||!scalar(column.label)||column.digits!==undefined&&(!Number.isInteger(column.digits)||column.digits<0||column.digits>10))return null;keys.add(column.key);}
 for(const row of rows.items){if(!row||Array.isArray(row)||typeof row!=='object'||!columns.every(column=>scalar(row[column.key]))||!scalar(row._report_note))return null;}
 // Bound the whole envelope too, including unexpected/private metadata. Only
 // whitelisted column scalars and explicit evidence notes reach the encoders.
 const serialized=JSON.stringify(envelope);if(serialized.length>limits.inputBytes||bytes(serialized).length>limits.inputBytes)return null;
 return {snapshot:{...model,content_revision:envelope.revision.content},columns,rows:rows.items,expiry};
}

let cachedFont;
export async function loadSmallReportFont(fetcher=fetch){
 if(!cachedFont)cachedFont=(async()=>{const response=await fetcher('/assets/report-font.ttf',{credentials:'same-origin'});if(!response.ok)throw new Error('Report font unavailable');const reader=response.body?.getReader();if(!reader)throw new Error('Report font unavailable');const parts=[];let size=0;try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>FONT_METRICS.byteLength)throw new Error('Report font exceeds capacity');parts.push(value);}}catch(error){await reader.cancel();throw error;}finally{reader.releaseLock();}return pdfFont(concat(parts));})().catch(error=>{cachedFont=null;throw error;});
 return cachedFont;
}

/** Synchronous bounded work after the fresh authorized snapshot read. */
export function encodeSmallReport(input,format,{font,now=Date.now()}={}){
 if(!input||!['xlsx','pdf'].includes(format))return null;
 if(input.expiry<=now)throw expired();
 const {snapshot,columns,rows}=input,parts=[],objects=[];let size=0;
 const append=data=>{size+=data.length;if(size>SMALL_REPORT_LIMITS.outputBytes)throw Object.assign(new Error('Small report capacity'),{code:'small_report_capacity'});parts.push(data);};
 try{
  if(format==='xlsx'){
   const start=xlsxStart(snapshot,columns);append(start.data);
   const page=xlsxPage(start.state,columns,rows);append(page.data);
   const notes=xlsxNotesStart(page.state,snapshot);append(notes.data);
   const evidence=xlsxNotesPage(notes.state,rows);append(evidence.data);append(xlsxFinish(evidence.state));
  }else{
   if(!font)return null;const start=pdfStart(font);append(start.data);objects.push(...start.objects);let state=start.state;
   do{if(state.page>=SMALL_REPORT_LIMITS.pages)return null;const page=pdfPage(state,snapshot,columns,rows.slice(state.row,state.row+50),font);if(rows.length&&page.consumed<1)return null;append(page.data);objects.push(...page.objects);state=page.state;}while(state.row<rows.length);
   const pages=pdfPagesObject(state);append(pages.data);objects.push(...pages.objects);
   const xref=pdfXref(pages.state,objects.map(item=>({object_id:item.id,byte_offset:item.offset})));if(!xref.complete)return null;append(xref.data);
  }
 }catch(error){if(['small_report_capacity','report_font_unavailable','report_font_unsupported','report_cell_too_large'].includes(error.code))return null;throw error;}
 return {bytes:concat(parts),type:format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',filename:({season:'season_summary',matches:'schedule',players:'players',availability:'attendance'}[snapshot.type]||'report')+'_'+snapshot.season_label.replace('/','-')+'.'+format};
}

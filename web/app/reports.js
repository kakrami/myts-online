import { reports as reportScreen } from '../ui-original/screens.js';
import { escapeHTML as e,empty,button } from '../ui-original/presentation.js';
import { AppError } from './transport.js';
const data=value=>value?.data??value;

/** Original Settings → Reports screen, backed by one immutable complete server snapshot. */
export function createReportsController({fetcher=fetch,encoderLoader=()=>import('./report-export.js')}={}) {
 const reportState={type:'season',sort:null,direction:'asc',snapshot:null,scope:null,creating:null,creatingKey:null,generation:0,exportTimer:null,sorts:{},exportGeneration:0,exportPending:null,seasonLabel:'',window:null,morePending:null};
 const captured=api=>JSON.stringify(api.context()),active=(api,scope)=>api.state.active&&api.state.view==='reports'&&captured(api)===scope;
 async function prepare(api){const scope=captured(api),key=scope+'/'+reportState.type+'/'+reportState.sort+'/'+reportState.direction;if(reportState.creating&&reportState.creatingKey===key)return reportState.creating;const generation=++reportState.generation;reportState.creatingKey=key;
   reportState.creating=(async()=>{const result=await api.transport.command('/api/reports/snapshots',{...api.context(),type:reportState.type,...(reportState.sort?{sort:reportState.sort}:{}),direction:reportState.direction});if(result.discarded||!active(api,scope)||generation!==reportState.generation)return;reportState.snapshot=data(result.data).snapshot_id;reportState.scope=scope;await api.renderView();})().finally(()=>{if(generation===reportState.generation){reportState.creating=null;reportState.creatingKey=null;}});return reportState.creating;
 }
 async function open(api){reportState.generation++;reportState.snapshot=null;reportState.window=null;reportState.scope=captured(api);await api.action('nav',{view:'reports'});}
 function saveFile(blob,filename){const link=document.createElement('a'),url=URL.createObjectURL(blob);link.href=url;link.download=filename;link.hidden=true;document.body.append(link);try{link.click();}catch(error){URL.revokeObjectURL(url);throw error;}finally{link.remove();}const timer=setTimeout(()=>URL.revokeObjectURL(url),30000);timer?.unref?.();}
 async function exportFile(dataset,api){
   const scope=captured(api),requestKey=dataset.snapshot+'/'+dataset.format;
   if(reportState.exportPending===requestKey)return;
   const exportGeneration=++reportState.exportGeneration,generation=reportState.generation,routeEpoch=api.state.routeEpoch,type=reportState.type,season=reportState.seasonLabel,snapshot=reportState.snapshot;
   reportState.exportPending=requestKey;
   let requireRoute=true;
   const current=()=>active(api,scope)&&exportGeneration===reportState.exportGeneration&&generation===reportState.generation&&(!requireRoute||routeEpoch===api.state.routeEpoch)&&snapshot===reportState.snapshot&&type===reportState.type;
   const clear=()=>{if(exportGeneration===reportState.exportGeneration)reportState.exportPending=null;};
   if(!dataset.snapshot){clear();throw new AppError('Wait until the complete report is ready.','report_not_ready',409);}
   if(!current()||dataset.snapshot!==snapshot){clear();return;}
   let result;
   try{
     const preview=data(api.state.model),rows=preview?.rows;
     // This only decides whether the optional path is worth attempting. Its
     // rows are never encoded; every export gets a new authorized first page.
     if(preview?.snapshot_id===dataset.snapshot&&preview.state==='ready'&&rows?.total<=50&&rows.total===rows.items?.length&&rows.next_cursor===null&&['xlsx','pdf'].includes(dataset.format)){
       // Static module acquisition is optional. Its failure may use the
       // independently authorized server path; data-read denials never do.
       let encoder;try{encoder=await encoderLoader();}catch{encoder=null;}
       if(encoder){
         // Finish all asynchronous static-asset work before the authorization
         // read, so a revoked viewer cannot save from a previously read preview.
         const font=dataset.format==='pdf'?await encoder.loadSmallReportFont(fetcher).catch(()=>null):null;
         if(!current()){clear();return;}
         const fresh=await api.transport.read('report-export-snapshot',api.pathFor('/api/reports',{type,snapshot_id:dataset.snapshot,limit:50}));
         if(fresh.discarded||!current()){clear();return;}
         const context=api.context(),input=encoder.smallReportInput(fresh.data,{snapshotId:dataset.snapshot,type,teamId:context.team_id,seasonId:context.team_season_id});
         const file=encoder.encodeSmallReport(input,dataset.format,{font});
         if(!current()){clear();return;}
         if(file){if(input.expiry<=Date.now())throw new AppError('This report has expired. Prepare it again.','report_expired',410);saveFile(new Blob([file.bytes],{type:file.type}),file.filename);clear();api.notice('Report downloaded.');return;}
       }
     }
     // Missing static modules and unsupported/oversized local attempts fall back.
     // An authorization, expiry or scope rejection above leaves this function.
     if(!current()){clear();return;}
     // Preserve long-running server exports through status-only repaints;
     // type/snapshot/team/season and cleanup generations still fence them.
     requireRoute=false;
     result=await api.transport.command(`/api/reports/${encodeURIComponent(dataset.snapshot)}/exports`,{format:dataset.format});
   }catch(error){if(!current()){clear();return;}clear();throw error;}
   if(result.discarded||!current()){clear();return;}
   api.notice('Preparing '+(dataset.format==='pdf'?'PDF':'Excel')+' from this report.');let status=result.data;
   const check=async()=>{
     if(!current()){clear();return;}
     try{
       if(status.state==='failed')throw new AppError(status.error_code==='report_font_unsupported'?'This report includes a character outside the PDF font. Download Excel instead.':'The export failed. Prepare a new report and try again.',status.error_code||'report_export_failed');
       if(status.state==='ready'){
         const response=await fetcher(status.download_url,{credentials:'same-origin',headers:location.pathname.startsWith('/view/')?{'x-view-key':location.pathname.split('/')[2]}:{}});
         if(!response.ok)throw new AppError('The report download failed.','report_download_failed');
         const blob=await response.blob();if(!current()){clear();return;}
         saveFile(blob,response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]||({season:'season_summary',matches:'schedule',players:'players',availability:'attendance'}[type]||'report')+'_'+season.replace('/','-')+'.'+status.format);
         clear();api.notice('Report downloaded.');return;
       }
       const next=await api.transport.read('report-export-status',`/api/reports/exports/${encodeURIComponent(status.id)}`);
       if(next.discarded||!current()){clear();return;}status=next.data;reportState.exportTimer=setTimeout(()=>void check(),1500);
     }catch(error){const show=current();clear();if(show)api.showError(error);}
   };void check();
 }
 function appendReports(view,previous,next){if(view!=='reports')return next;if(data(previous).snapshot_id!==data(next).snapshot_id)return next;const old=data(previous).rows,current=data(next).rows,loaded=(old.loaded??old.items.length)+current.items.length,items=[...old.items,...current.items].slice(-200);return {...next,data:{...data(next),rows:{...current,items,loaded},scope_label:data(next).scope_label+(loaded>200?` · Showing rows ${loaded-items.length+1}–${loaded}; downloads include all rows`:'')}};}
 async function moreRows(dataset,api){
   const scope=captured(api),snapshot=reportState.snapshot,generation=reportState.generation,cursor=dataset.cursor,key=snapshot+'/'+cursor;
   if(!snapshot||!cursor||reportState.window?.scope!==scope||data(reportState.window.envelope).rows.next_cursor!==cursor)return;
   if(reportState.morePending?.key===key)return reportState.morePending.promise;
   const pending={key,promise:null};reportState.morePending=pending;
   pending.promise=(async()=>{
     // A status/revision read uses main's view key. It must not cancel the
     // user's page request against the same ready immutable snapshot.
     const result=await api.transport.read('report-more',api.pathFor('/api/reports',{type:reportState.type,snapshot_id:snapshot,cursor}));
     if(result.discarded||!active(api,scope)||generation!==reportState.generation||snapshot!==reportState.snapshot||reportState.window?.scope!==scope||data(reportState.window.envelope).rows.next_cursor!==cursor||data(result.data).snapshot_id!==snapshot)return;
     const envelope=appendReports('reports',reportState.window.envelope,result.data);reportState.window={scope,snapshot,envelope};api.state.model=envelope;await api.renderView();
   })().finally(()=>{if(reportState.morePending===pending)reportState.morePending=null;});
   return pending.promise;
 }
 async function sortReport(dataset,api){reportState.generation++;reportState.sort=dataset.key;reportState.direction=dataset.direction;reportState.sorts[reportState.type]={key:dataset.key,direction:dataset.direction};reportState.snapshot=null;reportState.window=null;await api.renderView();}
 return {routes:{reports:'/api/reports'},handlers:{
   actions:{more:moreRows,reports:(_dataset,api)=>open(api),'report-type':async(dataset,api)=>{reportState.generation++;reportState.type=dataset.value;const saved=reportState.sorts[dataset.value];reportState.sort=saved?.key??null;reportState.direction=saved?.direction??'asc';reportState.snapshot=null;reportState.window=null;await api.renderView();},'report-first-page':async(_dataset,api)=>{reportState.generation++;reportState.window=null;reportState.morePending=null;await api.renderView();},'report-export':(dataset,api)=>exportFile(dataset,api).catch(error=>api.showError(error)),'report-sort-column':(dataset,api)=>sortReport({key:dataset.value,direction:'asc'},api),'report-sort-reverse':(dataset,api)=>sortReport({key:dataset.key,direction:reportState.sort===dataset.key&&reportState.direction==='asc'?'desc':'asc'},api)},
   viewParams:(view,api)=>{if(view!=='reports')return {};if(reportState.scope!==captured(api))reportState.window=null;return {type:reportState.type,...(reportState.scope===captured(api)&&reportState.snapshot?{snapshot_id:reportState.snapshot}:{})};},
   present:{reports:async(envelope,api)=>{let model=data(envelope);const scope=captured(api);if(model.season_label)reportState.seasonLabel=model.season_label;if(model.needs_snapshot){void prepare(api).catch(api.showError);return empty('Preparing the complete report…');}if(model.state==='capturing')return reportScreen({...model,snapshot_id:''})+`<p class="scope-caption" role="status">Preparing all ${model.rows.total} rows · ${model.captured} saved. This continues with the browser closed.</p>`;if(model.state==='failed')return reportScreen({...model,snapshot_id:''})+`<p class="source-note" role="alert">${e(model.error_code==='report_changed'?'The data changed during preparation. Choose this report again to capture the current data.':'The report could not be prepared. Choose the report again to retry.')}</p>`;if(reportState.scope!==scope){reportState.snapshot=null;reportState.scope=scope;}
     // A revision/status repaint fetches page one again, but a ready snapshot is
     // immutable. Retain only this snapshot's latest 200-row window and cursor.
     // Keep main's model in sync, so the next More appends to the retained page.
     if(model.state==='ready'&&model.snapshot_id===reportState.snapshot){const previous=reportState.window;if(previous?.scope===scope&&previous.snapshot===model.snapshot_id&&(data(previous.envelope).rows.loaded??data(previous.envelope).rows.items.length)>(model.rows.loaded??model.rows.items.length)){envelope=previous.envelope;model=data(envelope);}reportState.window={scope,snapshot:model.snapshot_id,envelope};api.state.model=envelope;}
     return reportScreen({...model,scope_label:model.scope_label+' · '+model.scope_note})+((model.rows.loaded??model.rows.items.length)>model.rows.items.length?`<p class="scope-caption">${button('report-first-page','Return to first page',{className:'text-action'})}</p>`:'');}},
   append:appendReports,
   reportSort:sortReport,
 },state:reportState,cleanup:()=>{clearTimeout(reportState.exportTimer);reportState.exportGeneration++;reportState.exportPending=null;reportState.exportTimer=null;reportState.window=null;reportState.morePending=null;reportState.creating=null;reportState.creatingKey=null;reportState.generation++;}};
}

import {escapeHTML as e,button,unwrap} from '../ui-original/presentation.js';

// A finite public scan belongs to the open match, never to a browser session
// subscription. The server keeps the work alive after this controller closes.
export function createPublicHistoryController({schedule=setTimeout,cancel=clearTimeout,now=Date.now}={}){
 const states=new WeakMap();
 const valid=(api,s)=>states.get(api)===s&&s.current();
 function cleanup(api){const s=states.get(api);if(s?.timer)cancel(s.timer);states.delete(api);}
 function render(api){
  const s=states.get(api),panel=api.host.querySelector('[data-public-history]');if(!s||!panel||!valid(api,s))return;
  const m=s.model??{},progress=m.progress,working=s.busy||!s.error&&m.state==='active',canRefresh=m.can_refresh!==false||(m.state!=='revoked'&&Number(m.cooldown_until)>0&&Number(m.cooldown_until)<=now());
  panel.innerHTML=`<p class="scope-caption" role="status">${e(s.error??m.note??'Checking saved public history…')}${progress?` ${e(progress.complete)} of ${e(progress.total)} requested scans finished.`:''}</p><div class="action-row">${m.supported===false?'':button('h2h-refresh',s.error?'Retry history check':'Refresh',{disabled:working||!canRefresh})}${s.updated?button('h2h-show-updates','Show updated meetings'):''}</div>`;
 }
 function queue(api,s){if(!valid(api,s))return;if(s.model?.state!=='active'){const wait=Number(s.model?.cooldown_until)-now();if(s.model?.can_refresh===false&&wait>0)s.timer=schedule(()=>{s.timer=null;render(api);},Math.min(wait+1,86400000));return;}const delay=Math.min(30000,Math.max(1000,Number(s.model.next_check_ms)||1500));s.timer=schedule(()=>{s.timer=null;void run(api,s,false);},delay);}
 async function run(api,s,command,force=false){
  if(!valid(api,s)||s.busy)return;const epoch=api.state.routeEpoch;s.busy=true;s.error=null;render(api);
  try{
   const previous=s.model,result=command?await api.transport.command(s.refresh,{force}):await api.transport.read('public-history',s.status);
   if(result.discarded||!valid(api,s))return;
   s.model=unwrap(result.data);const changed=previous?.state==='active'&&(s.model.state!=='active'||Number(s.model.progress?.complete)>Number(previous.progress?.complete));
   if(changed){s.updated=true;if(epoch===api.state.routeEpoch&&!api.state.modal&&!api.state.editorDirty){const accepted=await s.reload();if(!valid(api,s))return;if(accepted!==false)s.updated=false;}}
  }catch(error){if(valid(api,s)){s.error=error?.code==='history_capacity'?'Several history checks are already running. Try again shortly.':error?.status===401||error?.status===403?'Access changed. Reopen this match after signing in or restoring the shared link.':'The history check could not finish. Saved meetings are still available. Retry when ready.';s.model={...s.model,can_refresh:true};}}
  finally{if(valid(api,s)){s.busy=false;render(api);if(!s.error)queue(api,s);}}
 }
 function start(api,{eventId,current,reload}){
  cleanup(api);if(!api.transport.command)return;
  const s={current,reload,refresh:api.pathFor(`/api/matches/${encodeURIComponent(eventId)}/h2h/refresh`),status:api.pathFor(`/api/matches/${encodeURIComponent(eventId)}/h2h/history`),model:null,busy:false,timer:null};states.set(api,s);void run(api,s,true,false);
 }
 return {start,render,cleanup,refresh:api=>{const s=states.get(api);if(!s||!valid(api,s))return;if(s.timer)cancel(s.timer);s.timer=null;return run(api,s,true,true);},showUpdates:async api=>{const s=states.get(api);if(!s||!valid(api,s)||api.state.editorDirty)return;const accepted=await s.reload();if(valid(api,s)){if(accepted!==false)s.updated=false;render(api);}}};
}

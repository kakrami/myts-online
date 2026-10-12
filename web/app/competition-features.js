import {competitionCard,competitions} from '../ui-original/screens.js';
import {unwrap,escapeHTML as e,button} from '../ui-original/presentation.js';
const items=value=>Array.isArray(value)?value:value?.items??[];
const scope=api=>JSON.stringify([api.state.team,api.state.season,api.state.bootstrap.session.role]);
const nodes=api=>[...api.host.querySelectorAll('#root [data-inline-competition]')];
const cardNode=(api,id)=>nodes(api).find(node=>node.dataset.competitionId===id);
const mergeRows=(old,next)=>{const rows=[...new Map([...items(old),...items(next)].map(row=>[row.id,row])).values()];return {...next,items:rows.slice(-200),windowed:rows.length>200||old?.windowed};};
function mergeStandings(old,next){const pools=new Map();for(const pool of [...old?.pools??[],...next?.pools??[]]){const prior=pools.get(pool.id);pools.set(pool.id,{...pool,rows:[...new Map([...prior?.rows??[],...pool.rows??[]].map(row=>[row.id,row])).values()]});}let count=[...pools.values()].reduce((n,p)=>n+p.rows.length,0),drop=Math.max(0,count-200);return {...next,pools:[...pools.values()].map(pool=>{const remove=Math.min(drop,pool.rows.length);drop-=remove;const rows=pool.rows.slice(remove);return {...pool,rows,complete:rows.length===pool.total};}).filter(pool=>pool.rows.length),windowed:count>200||old?.windowed};}

/** In-card original competition interaction; every data page still comes from
 * the bounded, scoped server read model. No provider request runs in the UI. */
export function createCompetitionFeatures(){
 const states=new WeakMap();
 const local=api=>{let s=states.get(api);if(!s||s.scope!==scope(api)){s={scope:scope(api),cards:new Map(),envelope:null,revision:null,filter:'all'};states.set(api,s);}return s;};
 const valid=(api,s,card,token,epoch,node)=>api.state.active&&api.state.view==='competitions'&&!api.state.details.length&&scope(api)===s.scope&&s.cards.get(card.id)===card&&card.token===token&&card.open&&node.open&&node.isConnected&&cardNode(api,card.id)===node;
 const model=(s,card)=>({...card.base,...card.model?.competition,...card.model, id:card.id,open:card.open,active_tab:card.tab,team_filter:card.filter,standings_sorts:card.sorts,loading:!!card.token,error:card.error,loaded:!!card.model});
 function paint(api,s,card,{focus=null}={}){const node=cardNode(api,card.id);if(!node)return;const active=document.activeElement;if(!focus&&node.contains(active)&&active?.matches('button'))focus=Object.fromEntries(Object.entries(active.dataset).filter(([key])=>key!=='direction'));const template=document.createElement('template');template.innerHTML=competitionCard(model(s,card),s.envelope,{inline:true});const replacement=template.content.firstElementChild;node.innerHTML=replacement.innerHTML;node.open=card.open;api.applyCapabilities?.();if(focus&&!api.state.modal&&!api.state.details.length)[...node.querySelectorAll('button')].find(button=>Object.entries(focus).every(([key,value])=>button.dataset[key]===value))?.focus();}
 async function load(api,card,{cursor=null,tab=card.tab,poolCursor=null,reset=false,focus=null}={}){
  const s=local(api),node=cardNode(api,card.id);if(!node||!card.open||api.state.details.length)return;
  const epoch=api.state.routeEpoch,token=card.token={};card.error=null;if(reset)card.model=null;paint(api,s,card,{focus});
  try{
   const result=await api.transport.read('competition-inline:'+card.id,api.pathFor(`/api/competitions/${encodeURIComponent(card.id)}`,{tab,view:card.filter==='ours'?'own':'all',...(cursor?(tab==='standings'?{standings_cursor:cursor}:{cursor}):{}),...(poolCursor?{pool_counts_cursor:poolCursor}:{}),standings_limit:100}));
   if(result.discarded||!valid(api,s,card,token,epoch,node))return;
   const hydrated=await api.hydrateModel(result.data);if(!valid(api,s,card,token,epoch,node))return;
   const next=unwrap(hydrated),prior=card.model;
   if(cursor&&prior&&card.revision!=null&&hydrated.revision?.content!=null&&card.revision!==hydrated.revision.content){card.token=null;return load(api,card,{reset:true,focus});}
   card.model=cursor&&prior?{...next,...(tab==='standings'?{standings:mergeStandings(prior.standings,next.standings),events:prior.events}:{events:mergeRows(prior.events,next.events),standings:prior.standings})}:next;card.revision=hydrated.revision?.content;card.stale=false;card.token=null;paint(api,s,card);
  }catch(error){if(!valid(api,s,card,token,epoch,node))return;card.token=null;if(['sign_in_required','password_changed'].includes(error.code)){api.showError(error);return;}if(error.code==='cursor_restart'&&cursor)return load(api,card,{reset:true,focus});card.error=error.message||'Saved competition could not be loaded.';card.stale=false;paint(api,s,card);}
  finally{if(card.token===token){card.token=null;card.stale=true;}}
 }
 const get=(data,api)=>local(api).cards.get(data.id);
 const select=(data,api)=>{const card=get(data,api);if(!card||!['matches','standings'].includes(data.value))return;card.tab=data.value;card.open=true;const focus={action:'competition-inline-tab',value:card.tab};if(card.model||card.token){paint(api,local(api),card,{focus});if(card.stale&&!card.token)return load(api,card);return;}return load(api,card,{focus});};
 const actions={
  'competition-inline-tab':select,
  'competition-inline-team':(data,api)=>{const s=local(api);if(!get(data,api)||!['all','ours'].includes(data.value))return;s.filter=data.value;const pending=[];for(const card of s.cards.values()){card.filter=data.value;card.model=null;card.token=null;if(card.open)pending.push(load(api,card,{focus:card.id===data.id?{action:'competition-inline-team',value:card.filter}:null}));else paint(api,s,card);}return Promise.all(pending);},
  'competition-inline-more':(data,api)=>{const card=get(data,api);if(card&&!card.token)return load(api,card,{cursor:data.cursor,tab:data.tab??card.tab});},
  'competition-inline-retry':(data,api)=>{const card=get(data,api);if(card)return load(api,card,{reset:true});},
  'competition-inline-sort':(data,api)=>{const card=get(data,api);if(!card)return;card.sorts[data.pool]={key:data.key,direction:data.direction};paint(api,local(api),card,{focus:{action:'competition-inline-sort',key:data.key,pool:data.pool}});},
  'competition-inline-pools':(data,api)=>{const card=get(data,api),page=card?.model?.standings?.pool_counts;if(!page)return;api.openModal({title:'Pool counts',kind:'standings-pools',html:`<p class="scope-caption">${e(page.total??0)} pools · Complete source counts</p>${(page.items??[]).map(pool=>`<div class="fact"><span>${e(pool.name)}</span><b>${e(pool.total)}</b></div>`).join('')}${page.next_cursor?button('competition-inline-pools-more','More pool counts',{data:{id:data.id,cursor:page.next_cursor}}):''}`});},
  'competition-inline-pools-more':async(data,api)=>{const card=get(data,api);if(!card)return;const modal=api.state.modal,epoch=api.state.routeEpoch,s=local(api),token={};card.poolToken=token;try{const result=await api.transport.read('competition-inline-pools',api.pathFor(`/api/competitions/${encodeURIComponent(card.id)}`,{pool_counts_cursor:data.cursor}));if(result.discarded||api.state.modal!==modal||api.state.routeEpoch!==epoch||scope(api)!==s.scope||card.poolToken!==token)return;const next=unwrap(result.data).standings?.pool_counts;if(next){card.model.standings.pool_counts=next;actions['competition-inline-pools'](data,api);}}catch(error){if(api.state.modal===modal&&api.state.routeEpoch===epoch&&scope(api)===s.scope&&card.poolToken===token)api.showError(error);}},
 };
 return {actions,
  resumeLater(api){queueMicrotask(()=>{if(!api.state.active||api.state.view!=='competitions'||api.state.details.length)return;const s=local(api);for(const card of s.cards.values())if(card.open&&(!card.model||card.stale)&&!card.token&&cardNode(api,card.id))void load(api,card);});},
  present(envelope,api){const s=local(api),revision=JSON.stringify(envelope.revision??null),changed=s.revision!==revision;s.envelope=envelope;s.revision=revision;const m=unwrap(envelope),list=items(m.competitions),ids=new Set(list.map(c=>c.id));for(const id of s.cards.keys())if(!ids.has(id))s.cards.delete(id);for(const base of list){let card=s.cards.get(base.id);if(!card){card={id:base.id,open:!!base.open,tab:base.active_tab??'matches',filter:s.filter,sorts:{},model:null};s.cards.set(base.id,card);}card.base=base;card.token=null;if(changed)card.stale=true;}return competitions({...envelope,data:{...m,competitions:{...m.competitions,items:list.map(base=>model(s,s.cards.get(base.id)))}}},{inline:true});},
  afterRender(view,api){if(view!=='competitions')return;const s=local(api);for(const card of s.cards.values())if(card.open&&(!card.model||card.stale)&&!card.token)void load(api,card);},
  interactions:{
   // Native details toggle events may coalesce. Fence at the user's click,
   // before the browser changes open, so rapid close/reopen cannot retain an
   // abandoned in-flight token and leave the card permanently loading.
   click(event,api){const summary=event.target.closest?.('#root [data-inline-competition] > summary');if(!summary||event.target.closest('a,button'))return;const card=local(api).cards.get(summary.parentElement.dataset.competitionId);if(card){card.open=!summary.parentElement.open;card.token=null;}},
   toggle(event,api){const node=event.target;if(!node.matches?.('#root [data-inline-competition]'))return;const card=local(api).cards.get(node.dataset.competitionId);if(!card)return;card.open=node.open;if(!card.open){card.token=null;return;}if((!card.model||card.stale)&&!card.token)void load(api,card);},
   keydown(event,api){const node=event.target.closest?.('[data-action="competition-inline-tab"]');if(!node||!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();const buttons=[...node.closest('[role="tablist"]').querySelectorAll('[role="tab"]')],index=buttons.indexOf(node),next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowRight'?1:-1)+buttons.length)%buttons.length;void api.action('competition-inline-tab',{id:node.dataset.id,value:buttons[next].dataset.value});},
  },
  cleanup(api){const s=states.get(api);if(s)for(const card of s.cards.values()){card.token=null;card.poolToken=null;}states.delete(api);},
 };
}

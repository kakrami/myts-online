const KEY='myts.connection.v1';
const PROVIDERS=new Set(['teamsnap','trace','gotsport']);
const pick=(value,keys)=>Object.fromEntries(keys.filter(key=>value?.[key]!==undefined).map(key=>[key,value[key]]));
const sourceKeys=['id','provider','name','season_label','archived','club','age','gender','region'];
const draftKeys=['destination','name','season_year','kind','q','state','age','gender','filtersRequested'];
function snapshot(flow){
  if(!flow||!PROVIDERS.has(flow.provider))return null;
  const pending=flow.pending&&(flow.pending.path==='/api/connections'||/^\/api\/teams\/[A-Za-z0-9%_-]+\/attachments$/.test(flow.pending.path))?flow.pending:null;
  return {
    ...pick(flow,['id','provider','stage','intent','accountId','accountName','attempt','attemptExpires','requestId']),
    destination:pick(flow.destination,['teamId','teamName','seasonId']),
    source:flow.source?pick(flow.source,sourceKeys):null,
    draft:pick(flow.draft,draftKeys),
    // This is an owner command intent, never an authentication response. Do not
    // retain arbitrary request/response objects, email, codes or OAuth tokens.
    pending:pending?{
      path:pending.path,
      requestId:flow.pending.requestId,
      body:{...pick(flow.pending.body,['request_id','source_team_id','account_id','team_id','season_id','kind','revision','connection_generation']),
        ...(flow.pending.body?.scope?{scope:{...pick(flow.pending.body.scope,['mode']),...(Array.isArray(flow.pending.body.scope.season_ids)?{season_ids:[...flow.pending.body.scope.season_ids]}:{})}}:{}),
        ...(flow.pending.body?.club_choice?{club_choice:pick(flow.pending.body.club_choice,['kind','keep','profile_revision','current_logo_revision','source_logo_revision','current_club_team_count','source_club_team_count'])}:{}),
        ...(flow.pending.body?.new_team?{new_team:pick(flow.pending.body.new_team,['name','timezone','timezone_source','season_year','kind'])}:{})},
      ...pick(flow.pending,['teamId','seasonId']),
    }:null,
  };
}

/** One user-visible connection intent. A dismissed flow cannot publish late UI. */
export class ConnectionFlow {
  constructor({storage,uuid=()=>crypto.randomUUID()}={}){
    this.storage=storage;this.uuid=uuid;this.version=0;this.active=false;this.value=null;
    try{const saved=JSON.parse(storage?.getItem(KEY)||'null');if(saved?.id&&PROVIDERS.has(saved.provider))this.value=snapshot(saved);}catch{}
  }
  begin(provider,destination={}){
    if(!PROVIDERS.has(provider))throw new TypeError('Unknown provider.');
    this.version++;this.active=true;
    this.value={id:this.uuid(),provider,stage:'accounts',intent:destination.teamId?'existing':'add',destination:{...destination},draft:{},source:null,pending:null};
    this.save();return this.ticket();
  }
  resume(){if(!this.value)return null;this.version++;this.active=true;return this.ticket();}
  ticket(){return {id:this.value?.id,version:this.version};}
  current(ticket){return !!ticket&&this.active&&ticket.id===this.value?.id&&ticket.version===this.version;}
  update(values){if(!this.value)return;Object.assign(this.value,values);this.save();}
  save(){try{if(this.value)this.storage?.setItem(KEY,JSON.stringify(snapshot(this.value)));else this.storage?.removeItem(KEY);}catch{}}
  dismiss(){this.version++;this.active=false;this.save();}
  clear(){this.version++;this.active=false;this.value=null;this.save();}
  pending(path,body,{teamId,seasonId}={}){
    if(this.value?.pending)return this.value.pending;
    const requestId=this.value?.requestId||this.uuid();
    const pending={path,body:JSON.parse(JSON.stringify(body)),requestId,...pick({teamId,seasonId},['teamId','seasonId'])};
    if(path==='/api/connections')pending.body.request_id=requestId;
    this.update({stage:'connecting',requestId,pending});return pending;
  }
}

export function ownerSessionExpired(error){return error?.status===401&&error?.code==='sign_in_required';}

export function discoveryMessage(model){
  const state=model?.discovery?.state;
  if(['queued','running'].includes(state))return 'Finding your teams. You can leave this screen and return while discovery continues.';
  if(state==='blocked')return 'This provider needs your attention. Reconnect the account, then try finding teams again.';
  if(state==='failed')return 'We could not finish finding teams. Saved teams are still available; try again or reconnect.';
  return model?.total===0?'No accessible teams were found. Check the account and its team access, or use another account.':'Choose the team you want to import.';
}

export function importPhase(groups=[]){
  if(groups.some(g=>['blocked','failed'].includes(g.state)||['restricted','unsupported'].includes(g.coverage)))return 'Some content needs attention. Saved data remains available; review the provider details below.';
  if(groups.some(g=>['running','retrying'].includes(g.state)))return 'Importing available data. Updates continue when this app is closed.';
  if(groups.some(g=>g.state==='queued'))return 'Import queued. The server will keep working when this app is closed.';
  if(groups.length&&groups.every(g=>g.state==='ready'&&g.coverage==='complete'))return 'Ready. Available data is saved; recurring updates continue in the background.';
  if(groups.some(g=>['partial','unpublished'].includes(g.coverage)))return 'Available data is saved. Some content is partial or not published by the provider.';
  return 'Connected. Check the saved background stages below for import progress.';
}

import { bytes, requireValue, stamp, datePriority } from "./common.js";
import { collectGotSport } from "./gotsport.js";
import { collectTeamSnap } from "./teamsnap.js";
import { collectTrace } from "./trace.js";
export { SourceTransport } from "./http.js";
const PRIVATE=new Set(["teamsnap","trace"]);
const PROVIDERS=new Set(["gotsport","live",...PRIVATE]);
const KINDS=new Set(["clubs","teams","players","competitions","divisions","memberships","identity_links","team_players","references_data","standings","attendance","trace_parts","trace_stats"]);
/** Collect one resumable provider page. Persistence and authorization fences belong to the caller. */
export async function collectSource({provider,kind,scope,args={},cursor={},transport,credential=null,account=null,scanId=""}) {
  requireValue(PROVIDERS.has(provider),"Unsupported provider.","invalid_job");
  requireValue(transport?.get&&typeof kind==="string"&&typeof scope==="string","Incomplete source job.","invalid_job");
  if(PRIVATE.has(provider)) requireValue(account?.id&&account.provider===provider&&account.native_id&&credential,"Private source authorization is required.","authentication_required");
  else requireValue(!account,"Public source cannot use private account scope.","contract_violation");
  const collect=provider==="teamsnap"?collectTeamSnap:provider==="trace"?collectTrace:collectGotSport;
  const page=await collect({j:{provider,kind,scope,scan_id:scanId},args,cursor,transport,credential,account});
  requireValue(page&&typeof page.complete==="boolean"&&page.checkpoint&&page.records,"Collector returned an invalid source page.");
  page.fixtures||=[];page.children||=[];page.replacements||=[];
  for(const [type,rows] of Object.entries(page.records)) {
    requireValue(KINDS.has(type)&&Array.isArray(rows),"Collector emitted an unsupported source kind.");
    for(const row of rows) {
      requireValue(row&&typeof row==="object"&&bytes(row)<=64000,"Source record exceeded its bound.","record_too_large");
      if(PRIVATE.has(provider)) { requireValue(!row.account_id||row.account_id===account.id,"Collector crossed private account scopes."); row.account_id=account.id; }
    }
  }
  for(const row of page.fixtures) {
    requireValue(row.provider===provider&&bytes(row)<=64000,"Invalid source fixture contract.");
    if(PRIVATE.has(provider)) { requireValue(!row.account_id||row.account_id===account.id,"Fixture crossed private account scopes."); row.account_id=account.id; }
  }
  const rowCount=Object.values(page.records).reduce((n,rows)=>n+rows.length,0)+page.fixtures.length;
  requireValue(rowCount<=500&&bytes(page.records)+bytes(page.fixtures)<=1750000,"Source page requires a smaller slice.","record_too_large");
  requireValue(page.children.length<=128&&bytes(page.checkpoint)<=8192,"Collector continuation exceeded its bound.");
  page.children=page.children.map((child)=>{
    requireValue(PROVIDERS.has(child.provider)&&child.kind&&child.scope&&bytes(child.args||{})<=8192,"Invalid source child spec.");
    requireValue(!PRIVATE.has(child.provider)||child.provider===provider,"Source child cannot grant another private provider access.");
    const recent=["roster","events","upcoming","division","game"].includes(child.kind);
    const dated=child.args?.reported_date?datePriority(child.args.reported_date):null;
    const priority=Number.isFinite(child.priority)?child.priority:dated!==null?dated:recent?80:["analytics","tracking","radar"].includes(child.kind)?20:60;
    return {provider:child.provider,component:child.kind,scope:child.scope,resourceKey:child.scope,args:child.args||{},stage:"source",priority,subscriberMode:"inherit",...(PRIVATE.has(child.provider)?{accountId:account.id,accountGeneration:account.generation}:{} )};
  });
  page.observations=(transport.observations||[]).map((o)=>({endpoint:o.endpoint,params:o.params,status:o.status,at:o.at,retrieved_at:o.retrieved_at||null,hash:o.hash,bytes:o.bytes,rows_count:o.rows_count,code:o.code||null}));
  const successful=page.observations.filter((o)=>o.status>=200&&o.status<300&&!o.code&&Number.isFinite(Date.parse(o.at)));
  page.retrievedAt=successful.length?successful.map((o)=>o.retrieved_at||o.at).sort().at(-1):null;
  const rawCoverage=page.coverage;
  page.sourceCoverage=Array.isArray(rawCoverage)?rawCoverage:rawCoverage&&typeof rawCoverage==="object"?[{provider,scope,...rawCoverage,observed_at:page.retrievedAt||stamp()}]:[{provider,scope,kind,complete:page.complete,summary:typeof rawCoverage==="string"?rawCoverage:page.complete?"complete":"partial",observed_at:page.retrievedAt||stamp()}];
  page.coverage=typeof rawCoverage==="string"?rawCoverage:page.sourceCoverage.some((v)=>v.availability==="restricted")?"restricted":page.sourceCoverage.some((v)=>v.availability==="unpublished")?"unpublished":page.complete?"complete":"partial";
  if(provider==='teamsnap'&&['events','attendance'].includes(kind)&&page.checkpoint?.refresh?.protocol==='teamsnap-refresh-v1') {
    requireValue(['complete','partial'].includes(page.coverageState),'Invalid TeamSnap collection coverage.');
    page.coverage=page.coverageState;
  }
  return page;
}

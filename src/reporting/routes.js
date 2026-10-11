import { assertSameOrigin,requestSession } from '../security/index.js';
import { readAuthBody } from '../application/auth-routes.js';
import { invalid } from '../read-model/selection.js';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}});

/** Safe reports retain viewer sharing. Dataset/evidence endpoints remain owner-only. */
export async function reportingRoutes(request,{security,reports}) {
 const url=new URL(request.url),path=url.pathname,method=request.method;if(!path.startsWith('/api/reports'))return null;
 let owner=null;if(!request.headers.has('x-view-key'))try{owner=await security.requireOwnerSession(requestSession(request));}catch(error){if(error.status!==401)throw error;}
 if(!['GET','HEAD'].includes(method))assertSameOrigin(request);
 const authorize=async teamId=>{if(owner)return owner;return security.authorizeViewer(request.headers.get('x-view-key'),teamId,'reports');};
 const snapshotScope=async id=>{const snapshot=await reports.snapshot(id);await authorize(snapshot.app_team_id);return snapshot;};
 if(path==='/api/reports'&&method==='GET'){
   const snapshot=url.searchParams.get('snapshot_id');if(!snapshot){await authorize(url.searchParams.get('team_id'));return json({data:{needs_snapshot:true,type:url.searchParams.get('type')||'season',rows:{items:[],total:0}}});}
   await snapshotScope(snapshot);
   const result=await reports.preview(snapshot,{limit:Number(url.searchParams.get('limit')||50),cursor:url.searchParams.get('cursor')});
   if(url.searchParams.get('team_id')&&result.selection.team_id!==url.searchParams.get('team_id')||url.searchParams.get('team_season_id')&&result.selection.team_season_id!==url.searchParams.get('team_season_id'))throw invalid('The report belongs to a different selected team or season.','report_scope',403);
   return json(result,result.data.state==='capturing'?202:200);
 }
 if(path==='/api/reports/snapshots'&&method==='POST'){const body=await readAuthBody(request);await authorize(body.team_id);const result=await reports.create(body,{type:body.type,sort:body.sort,direction:body.direction});return json(result,202);}
 let match=path.match(/^\/api\/reports\/([0-9a-f-]{36})\/exports$/);if(match&&method==='POST'){await snapshotScope(match[1]);const body=await readAuthBody(request);const result=await reports.requestExport(match[1],body.format);return json(result,result.state==='ready'?200:202);}
 match=path.match(/^\/api\/reports\/exports\/([0-9a-f-]{36})(\/download)?$/);if(match&&method==='GET'){const status=await reports.exportStatus(match[1]);await snapshotScope(status.snapshot_id);return match[2]?reports.download(match[1]):json(status);}
 return null;
}

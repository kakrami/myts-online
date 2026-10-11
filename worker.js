import {DOMAIN_SCHEMA,DOMAIN_SCHEMA_VERSION} from './src/domain/schema.js';
import {SECURITY_SCHEMA} from './src/security/schema.js';
import {SYNC_SCHEMA} from './src/sync/schema.js';
import {COACH_SCHEMA} from './src/coaching/schema.js';
import {ANALYSIS_SCHEMA} from './src/analysis/schema.js';
import {REPORT_SCHEMA} from './src/reporting/schema.js';
import {DATA_FILE_SCHEMA} from './src/reporting/data-schema.js';
import {TRACKING_CAPTURE_SCHEMA} from './src/tracking/schema.js';
import {trackingCaptureService,collectTrackingCaptureJob} from './src/application/tracking.js';
import {TEAM_FEATURE_SCHEMA} from './src/application/team-features.js';
import {CATALOG_SCHEMA} from './src/application/team-catalog.js';
import {AWARDS_SCHEMA} from './src/read-model/feature-schema.js';
import {FreshInstallation} from './src/application/fresh-install.js';
import {VERSION} from './src/application/version.js';
import {applicationRoutes} from './src/application/routes.js';
import {json,errorResponse} from './src/application/http.js';
import {BudgetDB} from './src/sync/budget.js';
import {createApplicationRuntime,ApplicationSyncService} from './src/application/sync-service.js';
import {collectReportJob,reportService,dataFileService} from './src/application/reports.js';
import {wakeSync} from './src/sync/runtime.js';
import {coachingRoutes} from './src/coaching/routes.js';

const SCHEMA=[...DOMAIN_SCHEMA,...SECURITY_SCHEMA,...SYNC_SCHEMA,...TEAM_FEATURE_SCHEMA,...CATALOG_SCHEMA,...COACH_SCHEMA,...ANALYSIS_SCHEMA,...REPORT_SCHEMA,...DATA_FILE_SCHEMA,...TRACKING_CAPTURE_SCHEMA,...AWARDS_SCHEMA];
const SEED=[{sql:`INSERT INTO domain_installation(id,schema_version,created_at) VALUES(1,${DOMAIN_SCHEMA_VERSION},strftime('%Y-%m-%dT%H:%M:%fZ','now')) ON CONFLICT(id) DO NOTHING`,params:[]}];
export const SyncRuntime=createApplicationRuntime({reportCollector:collectReportJob,trackingCollector:collectTrackingCaptureJob,runtimeOptions:{
  // Keep the existing 48-query job allowance plus the two read-only installation
  // checks inside the same 50-query invocation ceiling.
  statementLimit:50,
  async inspectInstallation({db,env}){
    const state=await new FreshInstallation(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:env.ADMIN_KEY}).inspect();
    if(state.state!=='ready')return state;
    return {...state,identity:state.schema_fingerprint+':'+state.started_at};
  },
}});
const HEADERS={'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self' https://auth.teamsnap.com"};
export default {
  async fetch(request,env,ctx){
    const url=new URL(request.url);
    try{
      if(url.pathname==='/api/health'&&request.method==='GET')return json({service:'myTS',version:VERSION});
      if(url.pathname.startsWith('/api/')){
        if(!env.DB)return json({error:{code:'database_unconfigured',message:'Connect a new database to this installation.'}},503);
        const db=new BudgetDB(env.DB),installation=new FreshInstallation(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:env.ADMIN_KEY});
        return await applicationRoutes(request,env,{db,installation,extraRoutes:[coachingRoutes]});
      }
      if(!['GET','HEAD'].includes(request.method))return json({error:{code:'method_not_allowed',message:'Use a supported request method.'}},405);
      const target=new URL(request.url);
      const shell=url.pathname==='/'||url.pathname==='/admin'||/^\/view\/[A-Za-z0-9_-]{43}$/.test(url.pathname);
      if(shell)target.pathname='/app/';
      const response=await env.ASSETS.fetch(new Request(target,request)),headers=new Headers(response.headers);
      Object.entries(HEADERS).forEach(([key,value])=>headers.set(key,value));headers.set('Cache-Control',shell||target.pathname.endsWith('.html')?'no-store':'public, max-age=300');
      return new Response(response.body,{status:response.status,headers});
    }catch(error){return errorResponse(error);}
  },
  async scheduled(controller,env,ctx){ctx.waitUntil((async()=>{
    if(!env.DB)return;
    const db=new BudgetDB(env.DB),installation=new FreshInstallation(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:env.ADMIN_KEY});
    if((await installation.inspect()).state!=='ready')return;
    try{
      if(db.remaining>=7)await trackingCaptureService(db,env).pruneExpired();
      if(db.remaining>=7)await reportService(db,env).pruneExpired({limit:5});
      if(db.remaining>=8)await dataFileService(db,env).pruneExpired({limit:5});
      if(db.remaining>=12)await trackingCaptureService(db,env).recover({limit:1});
      await new ApplicationSyncService(db,env).recoverDemand({wake:false});
    }finally{await wakeSync(env);}
  })());},
};

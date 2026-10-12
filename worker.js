import {trackingCaptureService,collectTrackingCaptureJob} from './src/application/tracking.js';
import {SCHEMA,SEED} from './src/application/installation-schema.js';
import {InstallationUpgrade} from './src/application/schema-upgrade.js';
import {wrapDatabase} from './src/application/installation-epoch.js';
import {VERSION} from './src/application/version.js';
import {applicationRoutes} from './src/application/routes.js';
import {json,errorResponse} from './src/application/http.js';
import {BudgetDB} from './src/sync/budget.js';
import {createApplicationRuntime,ApplicationSyncService} from './src/application/sync-service.js';
import {collectReportJob,reportService,dataFileService} from './src/application/reports.js';
import {wakeSync} from './src/sync/runtime.js';
import {coachingRoutes} from './src/coaching/routes.js';

const installationFor=(db,env)=>new InstallationUpgrade(db,{schema:SCHEMA,seed:SEED,bootstrapPassword:env.ADMIN_KEY,upgradeMode:env.MYTS_UPGRADE_MODE});
export const SyncRuntime=createApplicationRuntime({reportCollector:collectReportJob,trackingCollector:collectTrackingCaptureJob,runtimeOptions:{
  // Readiness and every N+2 guarded write batch share the same unchanged
  // 50-statement invocation ceiling; collectors reserve the actual overhead.
  statementLimit:50,
  wrapDatabase,
  async advanceInstallation({db,env}){return installationFor(db,env).advanceUpgrade();},
  async recoverConnections({db,env}){return new ApplicationSyncService(db,env).recoverLocalDemand({wake:false});},
  async inspectInstallation({db,env}){
    const state=await installationFor(db,env).inspect();
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
        if(!env.DB)return json({error:{code:'database_unconfigured',message:'The existing database binding is unavailable. Preserve the installation and review its configuration.'}},503);
        const budget=new BudgetDB(env.DB),installation=installationFor(budget,env),db=wrapDatabase(budget);
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
    const budget=new BudgetDB(env.DB),installation=installationFor(budget,env),state=await installation.inspect();
    if(['upgrade_required','upgrading'].includes(state.state)){await wakeSync(env);return;}
    if(state.state!=='ready')return;
    const db=wrapDatabase(budget);
    try{
      if(db.remaining>=7)await trackingCaptureService(db,env).pruneExpired();
      if(db.remaining>=7)await reportService(db,env).pruneExpired({limit:5});
      if(db.remaining>=8)await dataFileService(db,env).pruneExpired({limit:5});
      if(db.remaining>=12)await trackingCaptureService(db,env).recover({limit:1});
      await new ApplicationSyncService(db,env).recoverDemand({wake:false});
    }finally{await wakeSync(env);}
  })());},
};

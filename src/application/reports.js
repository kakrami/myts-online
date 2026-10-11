import {ReportingService} from '../reporting/service.js';
import {DataFileService} from '../reporting/data-files.js';
import {JobCoordinator} from '../sync/coordinator.js';
import {wakeSync} from '../sync/runtime.js';

export function reportService(db,env,{cursor,wake=()=>wakeSync(env)}={}) {
  return new ReportingService(db,{coordinator:new JobCoordinator(db),cursor,wake,fontLoader:async()=>{
    const response=await env.ASSETS.fetch(new Request('https://myts.local/assets/report-font.ttf'));
    if(!response.ok)throw new Error('The report font is unavailable.');
    return new Uint8Array(await response.arrayBuffer());
  }});
}
export function dataFileService(db,env,{wake=()=>wakeSync(env),now=Date.now}={}) {
  return new DataFileService(db,{coordinator:new JobCoordinator(db,{clock:now}),wake,now});
}
export function collectReportJob({db,env,...job}){
  return ['data-export','data-import'].includes(job.lease.component)
    ? dataFileService(db,env).collect(job)
    : reportService(db,env).collect(job);
}
export async function pruneReportArtifacts(db,env){
  const reports=await reportService(db,env).pruneExpired({limit:5});
  const files=await dataFileService(db,env).pruneExpired({limit:5});
  return {reports:reports.removed,data_files:files.removed};
}

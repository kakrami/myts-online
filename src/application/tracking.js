import {TrackingCaptureService} from '../tracking/service.js';
import {JobCoordinator} from '../sync/coordinator.js';
import {wakeSync} from '../sync/runtime.js';
export function trackingCaptureService(db,env,options={}){return new TrackingCaptureService(db,{coordinator:new JobCoordinator(db,{clock:options.now||Date.now}),wake:()=>wakeSync(env),...options});}
export async function collectTrackingCaptureJob(context,options={}){return trackingCaptureService(context.db,context.env,options).collect(context);}

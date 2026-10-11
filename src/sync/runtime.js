import { JobCoordinator } from './coordinator.js';
import { BudgetDB } from './budget.js';
import { classifyFailure } from './errors.js';

// Production and tests inject their source/projection collector. No provider,
// credential, canonical identity, or user-facing team creation lives here.
export function createSyncRuntime(collector, options = {}) {
  return class SyncRuntime {
    constructor(ctx, env) {
      this.ctx = ctx; this.env = env; this.running = null; this.arming = Promise.resolve();
    }
    async installation(db=new BudgetDB(this.env.DB,options.statementLimit ?? 48)) {
      if(!options.inspectInstallation)return {state:'ready',identity:null};
      try{return await options.inspectInstallation({db,env:this.env});}
      catch(error){
        if(!['fresh_database_required','installation_incomplete'].includes(error.code))throw error;
        return {state:'blocked',error:{code:error.code,kind:'blocked',message:'The database does not match this application installation.'}};
      }
    }
    installationStatus(installation) {
      return installation.state==='blocked'?{state:'blocked',error:installation.error}:{state:'waiting_for_initialization',setup_state:installation.state};
    }
    async arm(at = Date.now() + (options.alarmDelayMs ?? 500)) {
      const prior = this.arming;
      // A prior failure stays observable to its caller; a later wake can retry.
      const next = prior.then(async () => {
        const current = await this.ctx.storage.getAlarm();
        if (current === null || current > at || current < Date.now() - 60000) await this.ctx.storage.setAlarm(at);
      }, async () => {
        await this.ctx.storage.setAlarm(at);
      });
      this.arming = next;
      return next;
    }
    async wake() {
      const task = async () => {
        const installation=await this.installation();
        if(installation.state!=='ready'){
          await this.ctx.storage.deleteAlarm();return {queued:false,...this.installationStatus(installation)};
        }
        const sequence = (await this.ctx.storage.get('wake_sequence') || 0) + 1;
        await this.ctx.storage.put('wake_sequence',sequence);
        const at = Date.now() + (options.alarmDelayMs ?? 500);
        const current = await this.ctx.storage.getAlarm();
        if (current === null || current > at) await this.ctx.storage.setAlarm(at);
        return {queued:true};
      };
      const next = this.arming.then(task,task); this.arming = next; return next;
    }
    async scheduleAfterRun(nextAt, startedWakeSequence) {
      const task = async () => {
        const sequence = await this.ctx.storage.get('wake_sequence') || 0;
        // A wake arriving during collection must survive a stale due-queue read.
        if (sequence !== startedWakeSequence) {
          const soon = Date.now() + (options.alarmDelayMs ?? 500);
          const current = await this.ctx.storage.getAlarm();
          if (current === null || current > soon) await this.ctx.storage.setAlarm(soon);
        } else if (nextAt === null) await this.ctx.storage.deleteAlarm();
        else await this.ctx.storage.setAlarm(Math.max(Date.now()+(options.alarmDelayMs ?? 500),nextAt));
      };
      const next = this.arming.then(task,task); this.arming = next; return next;
    }
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === '/wake' && request.method === 'POST') {
        return Response.json(await this.wake(),{status:202});
      }
      if (path === '/status' && request.method === 'GET') {
        try{
          const installation=await this.installation();
          if(installation.state!=='ready')return Response.json(this.installationStatus(installation));
          const last=await this.ctx.storage.get('last_run');
          return Response.json(last&&(!options.inspectInstallation||last.installation_id===installation.identity)?last:{state:'not_started'});
        }catch(error){return Response.json({state:'error',error:classifyFailure(error)});}
      }
      return Response.json({error:'not_found'},{status:404});
    }
    async alarm() {
      if (this.running) return this.running;
      this.running = this.run().finally(()=>{this.running=null;});
      return this.running;
    }
    async run() {
      const started = Date.now(), db = new BudgetDB(this.env.DB,options.statementLimit ?? 48);
      let installation;
      try {
        const wakeSequence = await this.ctx.storage.get('wake_sequence') || 0;
        installation=await this.installation(db);
        // Existing namespace alarms survive deployment. They must not query or
        // modify a fresh, partial, or foreign schema before owner setup finishes.
        if(installation.state!=='ready'){
          await this.scheduleAfterRun(null,wakeSequence);return this.installationStatus(installation);
        }
        const coordinator = new JobCoordinator(db,options);
        // Persist recovery before external work. An interrupted invocation cannot
        // strand a running lease until somebody opens the browser.
        await this.arm(started + (options.leaseMs ?? 45000) + (options.alarmDelayMs ?? 500));
        const result = await coordinator.runOne(collector,{env:this.env});
        // A page may legitimately use the whole invocation. It has already
        // saved its checkpoint: schedule another bounded invocation rather
        // than turn the due-queue read into a fictitious source failure.
        const next = db.remaining ? await coordinator.nextWake() : Date.now()+(options.alarmDelayMs ?? 500);
        await this.ctx.storage.put('last_run',{...result,...(options.inspectInstallation?{installation_id:installation.identity}:{}),started_at:started,finished_at:Date.now(),statements:db.used,rows_read:db.rowsRead,rows_written:db.rowsWritten});
        await this.scheduleAfterRun(next,wakeSequence);
      } catch (error) {
        const failure = classifyFailure(error);
        await this.ctx.storage.put('last_run',{state:'error',error:failure,...(options.inspectInstallation?{installation_id:installation?.identity??null}:{}),started_at:started,finished_at:Date.now(),statements:db.used});
        await this.arm(Date.now()+(options.runtimeRetryMs ?? 60000));
      }
    }
  };
}
export async function wakeSync(env) {
  if (!env.SYNC) throw new Error('The SYNC Durable Object binding is missing.');
  const response = await env.SYNC.get(env.SYNC.idFromName('scheduler')).fetch('https://sync/wake',{method:'POST'});
  if (!response.ok) throw new Error('The background scheduler could not be woken.');
}
export function scheduledSync(controller, env, ctx) { ctx.waitUntil(wakeSync(env)); }

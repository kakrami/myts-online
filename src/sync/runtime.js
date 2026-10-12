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
        if(!['fresh_database_required','installation_incomplete','installation_schema_mismatch','installation_integrity','installation_mode_invalid'].includes(error.code))throw error;
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
          if(['upgrade_required','upgrading'].includes(installation.state)&&options.advanceInstallation){await this.ctx.storage.setAlarm(Date.now()+(options.alarmDelayMs??500));return {queued:true,...this.installationStatus(installation)};}
          await this.ctx.storage.deleteAlarm();return {queued:false,...this.installationStatus(installation)};
        }
        if(options.recoverConnections)await this.ctx.storage.put('connection_recovery_pending',true);
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
      const started = Date.now(), rawDb = new BudgetDB(this.env.DB,options.statementLimit ?? 48);
      let db=rawDb;
      let installation;
      try {
        const wakeSequence = await this.ctx.storage.get('wake_sequence') || 0;
        installation=await this.installation(db);
        // Existing namespace alarms survive deployment. They must not query or
        // modify a fresh, partial, or foreign schema before owner setup finishes.
        if(installation.state!=='ready'){
          if(['upgrade_required','upgrading'].includes(installation.state)&&options.advanceInstallation){
            const progress=await options.advanceInstallation({db:rawDb,env:this.env});
            await this.ctx.storage.put('last_run',{state:'upgrading',setup_state:progress.state,started_at:started,finished_at:Date.now(),statements:rawDb.used});
            await this.scheduleAfterRun(Date.now()+(options.alarmDelayMs??500),wakeSequence);
            return this.installationStatus(progress);
          }
          await this.scheduleAfterRun(null,wakeSequence);return this.installationStatus(installation);
        }
        if(options.wrapDatabase)db=options.wrapDatabase(rawDb,{installation,env:this.env});
        const coordinator = new JobCoordinator(db,options);
        if(options.recoverConnections&&await this.ctx.storage.get('connection_recovery_pending')){
          const recovery=await options.recoverConnections({db,env:this.env});
          await this.ctx.storage.put('connection_recovery_pending',!!recovery.more||!!recovery.deferred);
          await this.ctx.storage.put('last_run',{state:'recovering_connections',...recovery,started_at:started,finished_at:Date.now(),statements:db.used});
          await this.scheduleAfterRun(Date.now()+(options.alarmDelayMs??500),wakeSequence);
          return;
        }
        // Persist recovery before external work. An interrupted invocation cannot
        // strand a running lease until somebody opens the browser.
        await this.arm(started + (options.leaseMs ?? 45000) + (options.alarmDelayMs ?? 500));
        const result = await coordinator.runOne(async context=>{
          // Record the obligation before any imported source page can commit.
          // A restarted alarm can recover it even if the final commit's reply
          // or subsequent storage promotion was interrupted.
          if(options.recoverConnections&&context.lease.provider==='reports'&&context.lease.component==='data-import')await this.ctx.storage.put('data_import_recovery_pending',true);
          return collector(context);
        },{env:this.env});
        // A page may legitimately use the whole invocation. It has already
        // saved its checkpoint: schedule another bounded invocation rather
        // than turn the due-queue read into a fictitious source failure.
        const importTerminal=result.provider==='reports'&&result.component==='data-import'&&['ready','failed','blocked','retrying'].includes(result.state);
        const importIdle=result.state==='idle'&&!!options.recoverConnections&&await this.ctx.storage.get('data_import_recovery_pending');
        // Intermediate import pages stay coalesced. Explicit owner wakes and
        // provider/projection commits still request their immediate recovery.
        const recover=!!options.recoverConnections&&(importTerminal||importIdle||result.committed&&(['gotsport','live','teamsnap','trace'].includes(result.provider)||result.provider==='domain'&&result.component==='projection'));
        if(recover){
          await this.ctx.storage.put('connection_recovery_pending',true);
          // Never clear the deferred obligation before its replacement is
          // durable. Recovery consumes all dirty roots, including other imports.
          if(importTerminal||importIdle)await this.ctx.storage.put('data_import_recovery_pending',false);
        }
        const next = recover?Date.now()+(options.alarmDelayMs??500):db.remaining?await coordinator.nextWake():Date.now()+(options.alarmDelayMs??500);
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

export class AppError extends Error {
  constructor(message, code = 'request_failed', status = 0, details = null) { super(message); this.code=code; this.status=status; this.details=details; }
}
export class RequestCoordinator {
  constructor(fetcher = fetch, {cacheLimit = 24} = {}) {
    this.fetcher=fetcher; this.generation=0; this.scope=null; this.controllers=new Map(); this.cache=new Map(); this.cacheLimit=cacheLimit;
  }
  select(scope) {
    const key=JSON.stringify(scope);
    if (key===this.scope) return this.generation;
    this.scope=key; this.generation++; this.abortAll(); this.cache.clear(); return this.generation;
  }
  abortAll() { for(const c of this.controllers.values()) c.abort(); this.controllers.clear(); }
  invalidate() { this.cache.clear(); }
  async read(key, path, {cache=false, revision=null} = {}) {
    const generation=this.generation, scope=this.scope, requestKey=`${scope}/${key}/${revision??''}`;
    if(cache && this.cache.has(requestKey)) return {data:this.cache.get(requestKey),generation,scope,discarded:false};
    this.controllers.get(key)?.abort(); const controller=new AbortController(); this.controllers.set(key,controller);
    try {
      const response=await this.fetcher(path,{credentials:'same-origin',signal:controller.signal,headers:{Accept:'application/json'}});
      const data=await this.decode(response);
      if(controller.signal.aborted || generation!==this.generation || scope!==this.scope || this.controllers.get(key)!==controller) return {discarded:true};
      if(cache) { this.cache.set(requestKey,data); if(this.cache.size>this.cacheLimit) this.cache.delete(this.cache.keys().next().value); }
      return {data,generation,scope,discarded:false};
    } catch(error) {
      if(controller.signal.aborted || generation!==this.generation || scope!==this.scope) return {discarded:true};
      throw error;
    } finally { if(this.controllers.get(key)===controller) this.controllers.delete(key); }
  }
  async command(path, body, {method='POST',idempotencyKey} = {}) {
    const generation=this.generation, scope=this.scope;
    const response=await this.fetcher(path,{method,credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/json',...(idempotencyKey?{'Idempotency-Key':idempotencyKey}:{})},body:JSON.stringify(body)});
    const data=await this.decode(response); this.invalidate();
    return {data,generation,scope,discarded:generation!==this.generation||scope!==this.scope};
  }
  async decode(response) {
    let body;
    try { body=await response.json(); } catch { throw new AppError('The server returned an unreadable response.','invalid_response',response.status); }
    if(!response.ok) throw new AppError(body.error?.message || body.message || 'The request failed.',body.error?.code || body.code,response.status,body.error?.details || body.details);
    return body;
  }
}
export class RevisionRefresh {
  constructor(coordinator, onChange, onError, {interval=15000}={}) { this.coordinator=coordinator; this.onChange=onChange; this.onError=onError; this.interval=interval; this.previous=null; this.timer=null; this.running=null; this.epoch=0; }
  start(path) { this.stop(); this.path=path; this.previous=null; this.timer=setInterval(()=>this.check(),this.interval); return this.check(); }
  stop() { if(this.timer) clearInterval(this.timer); this.timer=null; this.previous=null; this.path=null; this.epoch++; }
  async check() {
    const epoch=this.epoch, path=this.path;
    if(this.running===epoch || !path) return;
    this.running=epoch;
    try {
      const result=await this.coordinator.read('revisions',path);
      if(result.discarded || epoch!==this.epoch) return;
      const signature=JSON.stringify(result.data.revision || result.data.revisions || result.data);
      if(this.previous!==null && signature!==this.previous) { this.coordinator.invalidate(); await this.onChange(result.data); }
      this.previous=signature;
    } catch(error) { if(epoch===this.epoch) this.onError(error); }
    finally { if(this.running===epoch) this.running=null; }
  }
}

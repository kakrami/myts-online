import assert from 'node:assert/strict';
const phases=['boundaries','identity','native_period','periods','events','roster','roster_review','cleanup','members','finish'];
export function committedProgress({now=Date.now,stallMs=60000}={}) {
  const previous=new Map();let lastAdvance=now(),advances=0;
  return {observe(jobs){
    const at=now();let advanced=false;
    for(const job of jobs){
      assert.ok(!['failed','blocked','retrying'].includes(job.state),'Native job failed: '+JSON.stringify({id:job.id,provider:job.provider,component:job.component,state:job.state,code:job.last_error_code||null}));
      const prior=previous.get(job.id),checkpoint=JSON.parse(job.checkpoint||'{}');
      assert.ok(Number.isSafeInteger(job.pages_saved)&&job.pages_saved>=0,'Invalid committed page count');
      if(prior){
        assert.ok(job.pages_saved>=prior.pages,'Committed pages regressed for '+job.id);
        if(job.pages_saved>prior.pages){
          advanced=true;advances+=job.pages_saved-prior.pages;
          if(job.provider==='domain'&&job.component==='connection'&&job.generation===prior.generation&&Number.isInteger(checkpoint.passRevision)&&Number.isInteger(prior.checkpoint.passRevision)){
            assert.ok(checkpoint.passRevision>=prior.checkpoint.passRevision,'Connection pass revision regressed');
            if(checkpoint.passRevision===prior.checkpoint.passRevision){
              const currentPhase=phases.indexOf(checkpoint.phase),priorPhase=phases.indexOf(prior.checkpoint.phase);
              assert.ok(currentPhase>=priorPhase,'Connection phase regressed within one pass');
              if(checkpoint.phase===prior.checkpoint.phase&&typeof checkpoint.after===typeof prior.checkpoint.after&&['string','number'].includes(typeof checkpoint.after))assert.ok(checkpoint.after>=prior.checkpoint.after,'Connection cursor regressed within one phase');
            }
          }
        }
      }else if(job.pages_saved>0){advanced=true;advances+=job.pages_saved;}
      previous.set(job.id,{pages:job.pages_saved,generation:job.generation,checkpoint});
    }
    if(advanced)lastAdvance=at;
    assert.ok(at-lastAdvance<stallMs,`Native committed progress stalled for ${at-lastAdvance}ms`);
    return {committed_pages:[...previous.values()].reduce((sum,job)=>sum+job.pages,0),observed_advances:advances,job_count:previous.size,root_cursors:jobs.filter(job=>job.provider==='domain'&&job.component==='connection').map(job=>({id:job.id,generation:job.generation,pages_saved:job.pages_saved,checkpoint:JSON.parse(job.checkpoint||'{}')}))};
  }};
}
export function completeScaleProviderGraph(jobs,{team,count=101}={}) {
  const expected=new Map([['profile|'+team,1],['catalog|'+team,1],['history|'+team,3]]);
  for(let i=0;i<count;i++)for(const [component,scope]of [['event',`${30000+i}:${50000+i}`],['division',`gotsport:${40000+i}`],['bridge',`${team}:${30000+i}`],['standings',`gotsport:${40000+i}`]])expected.set(component+'|'+scope,1);
  const actual=jobs.filter(job=>job.provider==='gotsport');
  if(actual.length!==expected.size)return false;
  return actual.every(job=>expected.has(job.component+'|'+job.scope)&&job.state==='ready'&&job.coverage==='complete'&&job.pages_saved>=expected.get(job.component+'|'+job.scope))&&actual.filter(job=>job.component==='history').every(job=>job.pages_saved===3)&&new Set(actual.map(job=>job.component+'|'+job.scope)).size===expected.size;
}

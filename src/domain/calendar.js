/** UTC instant for a team's local calendar midnight. Season cutoffs are
 * persisted once, so SQL consumers can filter instants without timezone guesses. */
export function localMidnight(day,timeZone) {
  const target=Date.parse(day+'T00:00:00Z');
  const format=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant=target;
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    if(represented===target)return new Date(instant).toISOString();
    instant+=target-represented;
  }
  throw Object.assign(new Error('The season boundary is unavailable in this timezone.'),{code:'invalid_request',status:400});
}

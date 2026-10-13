/** UTC instant for a team's local calendar midnight (or requested whole hour). Season cutoffs are
 * persisted once, so SQL consumers can filter instants without timezone guesses. */
export function localMidnight(day,timeZone,hour=0) {
  if(!Number.isInteger(hour)||hour<0||hour>23)throw Object.assign(new Error('Choose a valid local calendar hour.'),{code:'invalid_request',status:400});
  const target=Date.parse(day+'T'+String(hour).padStart(2,'0')+':00:00Z');
  const format=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  let instant=target,afterGap=null;
  for(let i=0;i<4;i++) {
    const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(part=>[part.type,part.value]));
    const represented=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
    if(represented===target)return new Date(instant).toISOString();
    // Only corrected offset candidates can describe a nonexistent local hour;
    // the initial UTC guess is not a forward-gap resolution.
    if(i&&hour&&represented>target&&(!afterGap||represented-target<afterGap.distance))afterGap={instant,distance:represented-target};
    instant+=target-represented;
  }
  throw Object.assign(new Error('The season boundary is unavailable in this timezone.'),{code:'invalid_request',status:400,...afterGap?{calendar_gap_forward:new Date(afterGap.instant).toISOString()}:{} });
}

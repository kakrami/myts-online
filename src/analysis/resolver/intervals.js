/** Pure half-local seconds helpers. Endpoints are not rounded; inputs are never mutated.
 * Clock origin fields must come from verified provider metadata, not an observed first moment.
 */
export const MAX_INTERVALS = 4096;
const finite=(value,label)=>{
 if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(label+' must be finite');
 if(value<0)throw new RangeError(label+' must be nonnegative');return value;
};
const halfId=value=>{if(value!==1&&value!==2)throw new RangeError('half must be 1 or 2');return value;};
const readWindow=window=>{
 if(!window||typeof window!=='object'||Array.isArray(window))throw new TypeError('window must be an object');
 const start=finite(window.start,'window.start'),end=finite(window.end,'window.end');
 if(end<=start)throw new RangeError('window.end must exceed window.start');
 if(window.id!==undefined)halfId(window.id);
 for(const key of ['clockOriginMs','reportedClockOriginSeconds'])if(window[key]!=null)finite(window[key],key);
 return {start,end};
};
export function validateHalfWindows(windows){
 if(!Array.isArray(windows))throw new TypeError('windows must be an array');
 if(windows.length>2)throw new RangeError('at most two half windows are supported');
 const seen=new Set();return windows.map(window=>{readWindow(window);halfId(window.id);if(seen.has(window.id))throw new RangeError('duplicate half window');seen.add(window.id);return {...window};});
}
const boundedPush=(result,interval)=>{if(result.length>=MAX_INTERVALS)throw new RangeError('interval result exceeds limit');result.push(interval);};
export function normalizeSegments(segments,window=null){
 if(!Array.isArray(segments))throw new TypeError('segments must be an array');
 if(segments.length>MAX_INTERVALS)throw new RangeError('interval input exceeds limit');
 const bounds=window==null?null:readWindow(window),ordered=[];
 for(const segment of segments){if(!Array.isArray(segment)||segment.length!==2)throw new TypeError('interval must be [start,end]');let start=finite(segment[0],'interval.start'),end=finite(segment[1],'interval.end');if(end<start)throw new RangeError('interval.end precedes start');if(bounds){start=Math.max(start,bounds.start);end=Math.min(end,bounds.end);}if(end>start)ordered.push([start,end]);}
 ordered.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);const merged=[];
 for(const [start,end] of ordered){const last=merged[merged.length-1];if(last&&start<=last[1])last[1]=Math.max(last[1],end);else boundedPush(merged,[start,end]);}
 return merged;
}
export function intervalDuration(segments,window=null){return normalizeSegments(segments,window).reduce((sum,[start,end])=>sum+(end-start),0);}
export function intersectSegments(left,right,window=null){
 const a=normalizeSegments(left,window),b=normalizeSegments(right,window),result=[];let i=0,j=0;
 while(i<a.length&&j<b.length){const start=Math.max(a[i][0],b[j][0]),end=Math.min(a[i][1],b[j][1]);if(end>start)boundedPush(result,[start,end]);if(a[i][1]<b[j][1])i++;else j++;}
 return result;
}
export function subtractSegments(left,right,window=null){
 const a=normalizeSegments(left,window),b=normalizeSegments(right,window),result=[];let j=0;
 for(const [start,end] of a){while(j<b.length&&b[j][1]<=start)j++;let cursor=start,k=j;while(k<b.length&&b[k][0]<end){if(b[k][0]>cursor)boundedPush(result,[cursor,Math.min(b[k][0],end)]);cursor=Math.max(cursor,b[k][1]);if(cursor>=end)break;k++;}if(cursor<end)boundedPush(result,[cursor,end]);j=k;}
 return result;
}
/** Absolute verified origin takes precedence. null means unavailable, never confirmed zero. */
export function momentClock(moment,windows){
 if(!moment||typeof moment!=='object'||Array.isArray(moment))throw new TypeError('moment must be an object');
 const half=halfId(moment.half),checked=validateHalfWindows(windows);
 for(const key of ['startTimeMs','reportedSeconds'])if(moment[key]!=null)finite(moment[key],key);
 const window=checked.find(item=>item.id===half);let seconds=null,basis='missing_clock';
 if(window&&moment.startTimeMs!=null&&window.clockOriginMs!=null){seconds=(moment.startTimeMs-window.clockOriginMs)/1000;basis='absolute_timestamp';}
 else if(window&&moment.reportedSeconds!=null&&window.reportedClockOriginSeconds!=null){seconds=moment.reportedSeconds-window.reportedClockOriginSeconds;basis='legacy_reported_clock';}
 if(seconds!==null&&(!Number.isFinite(seconds)||seconds<0))throw new RangeError('moment clock precedes its verified origin');
 return {half,seconds,basis};
}

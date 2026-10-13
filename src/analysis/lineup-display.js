// Presentation of explicit ordinal owner intent only. These coordinates carry
// no duration, participation inference, role quantity, or capacity evidence.
const slots={7:[['GK',50,91],['LB',25,70],['RB',75,70],['LM',20,45],['CM',50,45],['RM',80,45],['ST',50,18]],9:[['GK',50,91],['LB',18,71],['CB',50,73],['RB',82,71],['LM',20,45],['CM',50,45],['RM',80,45],['LF',35,18],['RF',65,18]]};
export function manualLineupDisplay(format,assignments,labels=[]){
 if(!slots[format]||!assignments.length)return null;
 return {state:'manual',clock_unavailable:true,note:'Saved lineup · Match clock unavailable',formation:null,slots:slots[format].map(([position,x,y],i)=>{const a=assignments.find(v=>v.slot_kind==='field'&&v.slot===i+1),p=labels.find(v=>v.player_id===a?.player_id)||a;return {id:String(i+1),slot:i+1,position:a?.position||position,x,y,player_id:a?.player_id||null,name:p?.name||(a?'Unavailable saved player':null),jersey:p?.jersey??null,available:a?a.available!==false&&a.available!==0:null,state:a?'manual':'unknown'};}),bench_count:assignments.filter(v=>v.slot_kind==='bench').length,unknown_count:null};
}

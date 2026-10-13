export function historyBridgeProof(now){const at=new Date(now).toISOString();return {team_id:'1',live_team_id:'1',item_id:'1',external_key:'1',club:'22',season:'33',season_name:'2026/27',external_source_name:'GotSport',external_source_id:6,default_season:true,verified_at:at,expires_at:new Date(now+21600000).toISOString(),observations:['initclubteams','getteams'].map(path=>({endpoint:'https://gotsportlive-api.azurewebsites.net/api/clubapi/'+path,params:{ClubID:'22',SeasonID:'33'},status:200,hash:'a'.repeat(64),at}))};}
export function historyBridgeStatements(now,{reverse=false}={}){const proof=historyBridgeProof(now);return [
 {sql:'INSERT INTO source_team_links(a,b,kind,evidence) VALUES(?,?,\'provider_external_key\',?)',params:reverse?['live/public/1','gotsport/public/1',JSON.stringify(proof)]:['gotsport/public/1','live/public/1',JSON.stringify(proof)]},
 {sql:'UPDATE source_teams SET evidence=? WHERE id=?',params:[JSON.stringify({proof}),'live/public/1']},
 {sql:"INSERT INTO team_source_connections(id,app_team_id,source_team_id,scope_mode,created_at) VALUES('bridge-donor','team','live/public/1','observed_history',?)",params:[new Date(now).toISOString()]},
];}
export function historyBridgeDivisionStatements(now){const at=new Date(now).toISOString(),rows=[];
 rows.push({sql:"INSERT INTO divisions(id,created_at) VALUES('bridge-canonical-division',?)",params:[at]});
 for(const provider of ['gotsport','live']){
  const evidence=JSON.stringify({season_id:'33',season_name:'2026/27'});
  rows.push({sql:'INSERT INTO source_competitions(id,provider,scope,native_id,name,kind,evidence,content_hash,observed_at) VALUES(?,?,\'public\',?,\'Competition\',\'league\',?,\'fixture\',?)',params:[provider+'-bridge-competition',provider,'competition',evidence,at]});
  rows.push({sql:'INSERT INTO source_divisions(id,provider,competition_id,name,evidence,content_hash,observed_at) VALUES(?,?,?,\'Division\',\'{}\',\'fixture\',?)',params:[provider+'-bridge-division',provider,provider+'-bridge-competition',at]});
  rows.push({sql:"INSERT INTO division_source_links VALUES(?,'bridge-canonical-division','fixture','{}')",params:[provider+'-bridge-division']});
  rows.push({sql:"INSERT INTO source_competition_memberships(id,source_team_id,source_division_id,evidence,content_hash,observed_at) VALUES(?,?,?,'{}','fixture',?)",params:[provider+'-bridge-membership',provider+'/public/1',provider+'-bridge-division',at]});
 }
 rows.push({sql:"UPDATE source_events SET division_key='gotsport-bridge-division',competition_key='gotsport-bridge-competition' WHERE id='gotsport/public/event-current'",params:[]});
 return rows;
}

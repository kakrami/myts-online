import {acceptedGameSeason} from '../domain/game-season-state.js';

// Re-evaluated inside the domain CAS transaction. A read authorization before
// deletion starts cannot authorize a write after its durable lifecycle marker.
export function activeAnalysisWrite(selection,precondition,{eventId='',playerId='',playerIds=null}={}) {
  const clauses=[`EXISTS(SELECT 1 FROM app_teams t JOIN team_seasons s ON s.app_team_id=t.id WHERE t.id=? AND s.id=? AND NOT EXISTS(SELECT 1 FROM team_lifecycle l WHERE l.team_id=t.id))`],params=[selection.team_id,selection.team_season_id];
  if(eventId){const accepted=acceptedGameSeason(selection.team_id,selection.team_season_id,eventId);clauses.push('EXISTS(SELECT 1 FROM team_events WHERE app_team_id=? AND team_season_id=? AND event_id=?)',accepted.sql);params.push(selection.team_id,selection.team_season_id,eventId,...accepted.params);}
  if(playerId){clauses.push('EXISTS(SELECT 1 FROM team_players p JOIN canonical_player_ids c ON c.input_id=p.player_id AND c.canonical_id=p.player_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.player_id=?)');params.push(selection.team_id,selection.team_season_id,playerId);}
  if(playerIds){clauses.push(`NOT EXISTS(SELECT 1 FROM json_each(?) chosen WHERE NOT EXISTS(SELECT 1 FROM team_players p JOIN canonical_player_ids c ON c.input_id=p.player_id AND c.canonical_id=p.player_id WHERE p.app_team_id=? AND p.team_season_id=? AND p.player_id=chosen.value))`);params.push(JSON.stringify([...new Set(playerIds)]),selection.team_id,selection.team_season_id);}
  return {sql:`(${clauses.join(' AND ')}) AND (${precondition.sql})`,params:[...params,...precondition.params]};
}

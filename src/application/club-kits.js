import {invalid} from '../read-model/selection.js';

export const KIT_LIMIT=32;
const palette={black:'#111111',white:'#ffffff',red:'#dc2626',gray:'#808080',blue:'#2563eb',navy:'#172554',green:'#15803d',yellow:'#facc15',orange:'#f97316',purple:'#9333ea',pink:'#ec4899'};
export const kitNameKey=name=>String(name??'').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-US');
export const effectiveKitColor=kit=>/^#[0-9a-f]{6}$/i.test(kit?.color??'')?kit.color.toLowerCase():palette[kitNameKey(kit?.name).replace(/\s+(kit|uniform|jersey)$/,'').replace(/^grey$/,'gray')]??'';
const colorOrigin=kit=>/^#[0-9a-f]{6}$/i.test(kit?.color??'')?'owner_color':effectiveKitColor(kit)?'name_palette':'unset';
export function validateKits(items){
  if(items===null)return null;
  if(!Array.isArray(items)||items.length>KIT_LIMIT)throw invalid('Choose up to 32 named kits.');
  const names=new Set();
  return items.map(item=>{
    if(!item||typeof item.name!=='string'||!item.name.trim()||item.name.length>80||typeof item.color!=='string'||item.color!==''&&!/^#[0-9a-f]{6}$/i.test(item.color))throw invalid('Each kit needs a name of up to 80 characters and an optional six-digit color.');
    const name=item.name.trim().replace(/\s+/g,' '),key=kitNameKey(name);if(names.has(key))throw invalid('Each kit needs a distinct name.');names.add(key);
    return {name,color:item.color.toLowerCase()};
  });
}
export function clubKitsQuery(db,teamId,seasonId){
  return db.prepare(`WITH selected AS(SELECT s.year,p.club_id FROM team_seasons s LEFT JOIN team_profiles p ON p.app_team_id=s.app_team_id AND p.active=1 WHERE s.id=? AND s.app_team_id=?),source_names AS(SELECT DISTINCT trim(l.uniform) AS name FROM source_event_logistics l JOIN team_source_attachments a ON a.source_team_id=l.source_team_id AND a.account_id=l.account_id AND a.active=1 JOIN team_seasons s ON s.id=a.team_season_id JOIN source_events e ON e.id=l.source_event_id WHERE a.app_team_id=? AND a.team_season_id=? AND l.uniform IS NOT NULL AND length(trim(l.uniform)) BETWEEN 1 AND 80 AND ((e.starts_at>=s.start_at AND e.starts_at<s.end_at) OR(e.starts_at IS NULL AND e.local_day>=s.start_day AND e.local_day<s.end_day))),source_items AS(SELECT name,'' AS color FROM source_names ORDER BY name COLLATE NOCASE,name LIMIT 32) SELECT q.club_id,q.year AS season_year,COALESCE(k.revision,0) AS revision,COALESCE(k.overridden,0) AS overridden,(SELECT json_group_array(json_object('name',r.name,'color',r.color)) FROM(SELECT name,color FROM club_season_kit_rows WHERE club_id=q.club_id AND season_year=q.year ORDER BY ordinal) r) AS items,(SELECT json_group_array(json_object('name',name,'color',color)) FROM source_items) AS source_items,(SELECT count(*) FROM source_names) AS source_total FROM selected q LEFT JOIN club_season_kits k ON k.club_id=q.club_id AND k.season_year=q.year`).bind(seasonId,teamId,teamId,seasonId);
}
export function clubKitsModel(row){
  const parse=value=>{try{return JSON.parse(value??'[]');}catch{return [];}};
  const source=parse(row?.source_items),items=parse(row?.items),overridden=!!row?.overridden;
  return {club_id:row?.club_id??null,season_year:row?.season_year??null,revision:row?.revision??0,overridden,items,effective_items:(overridden?items:source).map(item=>({...item,color:effectiveKitColor(item),color_origin:colorOrigin(item),origin:overridden?'owner':'source_uniform'})),source_items:source.map(item=>({...item,color:effectiveKitColor(item),color_origin:effectiveKitColor(item)?'name_palette':'unset',origin:'source_uniform'})),source_total:row?.source_total??0,source_available:source.length>0,source_truncated:(row?.source_total??0)>KIT_LIMIT};
}
export function uniformKit(uniform,kits){
  if(typeof uniform!=='string'||!uniform.trim())return null;
  const found=kits.effective_items.find(item=>kitNameKey(item.name)===kitNameKey(uniform));
  return found?{...found,instructions:uniform,matched:true}:{name:uniform,color:effectiveKitColor({name:uniform}),color_origin:effectiveKitColor({name:uniform})?'name_palette':'unset',origin:'source_uniform',instructions:uniform,matched:false};
}

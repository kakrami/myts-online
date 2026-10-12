/** Whole-snapshot ordering, before bounded capture or preview pagination.
 * SQLite/D1 has no ICU numeric collation. Tokenize digit runs rather than
 * sorting only the loaded browser page (Q2Z must precede Q10Z).
 * The base ordinal keeps equal values in the reconciled input order.
 */
export const MAX_REPORT_SORT_CHARACTERS=1024,MAX_REPORT_SORT_STEPS=64;
export function reportSortBounds(key){const value=`COALESCE(CAST(q.${key} AS TEXT),'')`,withoutDigits=Array.from({length:10},(_,i)=>i).reduce((sql,digit)=>`replace(${sql},'${digit}','')`,value);return `MAX(length(${value})) AS sort_characters,MAX(2*min(length(${value})-length(${withoutDigits}),length(${withoutDigits}))+1) AS sort_step_bound`;}
export function orderedReportQuery(query,columns,{key,direction='asc'}={}) {
 const output=`json_object(${[...columns.map(c=>[c.key,'q.'+c.key]),['_report_id','q.id'],...(query.note?[['_report_note','q._report_note']]:[])].flatMap(([k,v])=>["'"+k+"'",v]).join(',')})`;
 const base=`report_source AS MATERIALIZED (${query.sql}),report_base AS MATERIALIZED (SELECT q.*,ROW_NUMBER() OVER(${query.orderBy?'ORDER BY '+query.orderBy:''})-1 AS _base FROM report_source q)`;
 if(!key)return `WITH ${base} SELECT ${output} AS row_json,q._base AS ordinal FROM report_base q ORDER BY ordinal`;
 const column=columns.find(c=>c.key===key);if(!column||!['asc','desc'].includes(direction))throw new Error('Invalid report sort.');
 const dir=direction.toUpperCase(),raw=`trim(COALESCE(CAST(q.${key} AS TEXT),''))`,empty=`(${raw} IN('','—'))`;
 // Real quantities retain signed/decimal ordering. Percentage strings and
 // jersey numbers use that same comparison; ISO dates sort chronologically.
 if(query.natural===false)return `WITH ${base} SELECT ${output} AS row_json,ROW_NUMBER() OVER(ORDER BY ${empty},CASE WHEN ${empty} THEN '' ELSE lower(${raw}) END ${dir},q._base ASC)-1 AS ordinal FROM report_base q ORDER BY ordinal`;
 const number=column.numeric||['jersey','attendance','yes_pct'].includes(key),clean=`replace(replace(${raw},',',''),'%','')`,numeric=number?`(${clean}<>'' AND ${clean} NOT GLOB '*[^0-9.+-]*' AND ${clean} GLOB '*[0-9]*')`:'0';
 const nextDigit=`min(${Array.from({length:10},(_,i)=>`COALESCE(NULLIF(instr(rest,'${i}'),0),length(rest)+1)`).join(',')})`;
 const len="length(rest)-length(ltrim(rest,'0123456789'))",digits=`substr(rest,1,${len})`,significant=`COALESCE(NULLIF(ltrim(${digits},'0'),''),'0')`;
 return `WITH RECURSIVE ${base},report_tokens(_base,rest,token,steps) AS(
 SELECT _base,CASE WHEN trim(COALESCE(CAST(${key} AS TEXT),''))='—' THEN '' ELSE lower(trim(COALESCE(CAST(${key} AS TEXT),''))) END,'',0 FROM report_base
 UNION ALL SELECT _base,substr(rest,CASE WHEN substr(rest,1,1) GLOB '[0-9]' THEN ${len}+1 ELSE ${nextDigit} END),token||CASE WHEN substr(rest,1,1) GLOB '[0-9]' THEN char(1)||printf('%08d',length(${significant}))||${significant}||char(2) ELSE substr(rest,1,${nextDigit}-1) END,steps+1 FROM report_tokens WHERE rest<>'' AND steps<${MAX_REPORT_SORT_STEPS}),
 report_keys AS MATERIALIZED(SELECT _base,token,rest FROM report_tokens WHERE rest='' OR steps=${MAX_REPORT_SORT_STEPS}),report_key_mode AS(SELECT MAX(rest<>'') AS fallback FROM report_keys)
 SELECT ${output} AS row_json,ROW_NUMBER() OVER(ORDER BY ${empty},${number?`CASE WHEN ${numeric} THEN 0 ELSE 1 END ${dir},CASE WHEN ${numeric} THEN CAST(${clean} AS REAL) END ${dir},`:''}CASE WHEN mode.fallback THEN lower(${raw}) ELSE k.token END ${dir},q._base ASC)-1 AS ordinal FROM report_base q JOIN report_keys k ON k._base=q._base CROSS JOIN report_key_mode mode ORDER BY ordinal`;
}

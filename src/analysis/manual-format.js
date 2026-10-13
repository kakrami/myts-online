/** Internal decision metadata never comes from an owner request. Generic row
 * updated_at remains the last mutation time; legacy rows use it as a fallback. */
export const FORMAT_CHOICE_TIME='_format_chosen_at';
export function formatChoiceTime(fields,updatedAt){const value=fields?.[FORMAT_CHOICE_TIME];return typeof value==='string'&&/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value)&&Number.isFinite(Date.parse(value))?value:updatedAt;}
export function publicCorrectionFields(fields){const result={...fields};delete result[FORMAT_CHOICE_TIME];return result;}
/** Newer explicit format wins, with a deterministic lineup tie. Resetting
 * either layer reveals the other without erasing its saved decision. */
export function ownerFormat(match,lineup){
 const fields=typeof match?.fields==='string'?JSON.parse(match.fields):match?.fields;
 const correction=fields?.format,placement=lineup?.format;
 if(correction==null)return placement??null;
 if(placement==null)return correction;
 const time=value=>{const n=Date.parse(value);return Number.isFinite(n)?n:0;};
 return time(lineup.updated_at)>=time(formatChoiceTime(fields,match.updated_at))?placement:correction;
}

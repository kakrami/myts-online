import {invalid,stableSelectionKey} from './selection.js';
const utf8=new TextEncoder();
function encode(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=',''); }
function decode(value) {
  if(!/^[A-Za-z0-9_-]+$/.test(value)) throw invalid('The list cursor is invalid.','cursor_invalid');
  const raw=value.replaceAll('-','+').replaceAll('_','/');
  try { const bytes=Uint8Array.from(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'=')),c=>c.charCodeAt(0));if(encode(bytes)!==value)throw new Error('Noncanonical encoding.');return bytes; }
  catch { throw invalid('The list cursor is invalid.','cursor_invalid'); }
}
export class CursorCodec {
  constructor(key,{now=Date.now,ttl=3600000}={}) {
    if(!(key instanceof Uint8Array)||key.byteLength<32) throw new Error('A cursor signing key is required.');
    this.key=crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);this.now=now;this.ttl=ttl;
  }
  async issue({selection,revision,scope,position}) {
    const bytes=utf8.encode(JSON.stringify({v:1,selection:stableSelectionKey(selection),revision,scope,position,expires:this.now()+this.ttl}));
    return encode(bytes)+'.'+encode(new Uint8Array(await crypto.subtle.sign('HMAC',await this.key,bytes)));
  }
  async verify(token,{selection,revision,scope}) {
    if(typeof token!=='string'||token.length>5000) throw invalid('The list cursor is invalid.','cursor_invalid');
    const parts=token.split('.');if(parts.length!==2) throw invalid('The list cursor is invalid.','cursor_invalid');
    const bytes=decode(parts[0]),signature=decode(parts[1]);
    if(!await crypto.subtle.verify('HMAC',await this.key,signature,bytes)) throw invalid('The list cursor is invalid.','cursor_invalid');
    let value;try { value=JSON.parse(new TextDecoder().decode(bytes)); } catch { throw invalid('The list cursor is invalid.','cursor_invalid'); }
    if(value.v!==1||value.scope!==scope||value.selection!==stableSelectionKey(selection)) throw invalid('The cursor belongs to another selection.','cursor_selection');
    if(value.expires<=this.now()||value.revision!==revision) throw invalid('The list changed. Reload this selection.','cursor_restart',409);
    return value.position;
  }
}

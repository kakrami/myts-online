// Names, dates and jerseys never participate in native resource identity. The
// namespace includes private account scope before hashing; public providers can
// safely share the same opaque app identity across consumers and imports.
export async function nativeCanonicalId(kind,sourceId) {
  const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`myts-domain-v1:${kind}:${sourceId}`)));
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const h=Array.from(bytes.slice(0,16),b=>b.toString(16).padStart(2,'0')).join('');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}

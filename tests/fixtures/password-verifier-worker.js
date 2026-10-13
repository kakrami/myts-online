import { passwordVerifier, base64url } from '../../src/security/crypto.js';

// Test instrumentation models the hosted native limit even though the local
// workerd binary may permit larger calls. No production code uses this guard.
const nativeImportKey = crypto.subtle.importKey.bind(crypto.subtle);
const nativeDeriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
let nativePBKDF2Calls = 0;
Object.defineProperty(crypto.subtle, 'deriveBits', {
  configurable: true,
  value: async (algorithm, ...args) => {
    if (algorithm?.name === 'PBKDF2') {
      nativePBKDF2Calls++;
      if (algorithm.iterations > 100_000)
        throw new DOMException('PBKDF2 iterations above 100,000 are unsupported.', 'NotSupportedError');
      throw new Error('Native PBKDF2 forbidden by portable-verifier test.');
    }
    return nativeDeriveBits(algorithm, ...args);
  },
});
Object.defineProperty(crypto.subtle, 'importKey', {
  configurable: true,
  value: async (format, data, algorithm, ...args) => {
    if (algorithm === 'PBKDF2' || algorithm?.name === 'PBKDF2') {
      nativePBKDF2Calls++;
      throw new Error('Native PBKDF2 forbidden by portable-verifier test.');
    }
    return nativeImportKey(format, data, algorithm, ...args);
  },
});

export default {
  async fetch(request) {
    const body = await request.json();
    if (body.probe_native_limit) {
      // Use the original import only to exercise the installed deriveBits cap.
      const key = await nativeImportKey('raw', new TextEncoder().encode('limit-probe'), 'PBKDF2', false, ['deriveBits']);
      try {
        await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new Uint8Array([1]),iterations:600_000}, key, 256);
        return Response.json({rejected:false}, {status:500});
      } catch (error) {
        return Response.json({rejected:true,name:error.name,message:error.message});
      }
    }
    const before = nativePBKDF2Calls;
    const results = [];
    for (const vector of body.vectors) {
      const bytes = await passwordVerifier(vector.password, vector.salt, vector.iterations);
      results.push({hash:base64url(bytes),length:bytes.length});
    }
    return Response.json({results,native_pbkdf2_calls:nativePBKDF2Calls-before});
  },
};

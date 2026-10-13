# Vendored @noble/hashes 1.7.1

The seven ESM modules are the exact PBKDF2-HMAC-SHA256 dependency closure from the pinned npm release. No npm runtime dependency or network access is required. The sole change relocates the package alias import in utils.js to its local crypto.js file. SOURCE.json records tarball integrity and upstream/vendored SHA-256 digests; LICENSE contains the upstream MIT license.

The project documents an independent Cure53 audit of version 1.0.0 in January 2022, including PBKDF2, HMAC and SHA-256. This pinned later version is in that library lineage; it has not been represented as independently audited at version 1.7.1. See https://github.com/paulmillr/noble-hashes/tree/1.7.1 and https://github.com/paulmillr/noble-hashes/blob/1.7.1/audit/2022-01-05-cure53-audit-nbl2.pdf.

myTS uses its standard PBKDF2-HMAC-SHA256 algorithm once, with the stored iteration count and a 32-byte output. It does not reduce the work factor, chain independent native derivations, or fall back after a platform failure. Existing password hashes and the ready schema are preserved.

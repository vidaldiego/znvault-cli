# Existing device-login wire codec

Exact copies of the portable Node/browser helpers and interoperability fixture
from vidaldiego/zn-vault v1.81.2, commit 3845089091bed0d65594ccd19333d7aba335c7f1.
These helpers encode/decode envelopes; Vault retains authentication, session
publication, revocation, grants and authorization. Do not fork the algorithms.

- `src/lib/device-login/mobile-device-login.ts` from `src/shared/mobile-device-login.ts`; SHA-256 `364e114df87b3dc3074ea603e7f3e52fc9afd8d8d82fa5bfd8cb1316dc0aed05`.
- `src/lib/device-login/device-key-envelope.ts` from `src/shared/device-key-envelope.ts`; SHA-256 `14a49bb064cf593fe6cf8d58d0f545085429f2132f8fe213e03207bf1f3b58d9`.
- `test/fixtures/mobile-device-login/device-envelope-v1.json` from `test/fixtures/mobile-device-login/device-envelope-v1.json`; SHA-256 `a82a909a1a0b7042321b2c0e24187f521617880a7ec7ffc1473463facc257ef6`.

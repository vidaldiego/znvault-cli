# CLI QR sign-in — minimal design

Status: approved for implementation by the owner on 29-Oct-2026, after Astra GO
and incorporation of its profile/transport/codec precisions. Publication is a
separate release action; this document does not claim it has happened.

## User experience

`znvault --profile vault-sec-tenant login --qr` displays a QR in the terminal,
the requested Vault and the remaining lifetime. In ZnVault Authenticator the
user chooses Scan QR, selects an eligible account and approves with biometrics.
The waiting CLI stores the resulting session in the selected profile. No browser
or callback listener is needed; the same command works through an SSH terminal.

Use the existing 120-second deadline. Denial, expiry and Ctrl+C end the attempt
with a clear result; retries require a new invocation. Keep `login --web` and
password login available. Reject conflicting login methods, API-key profiles,
`--json` and non-interactive output before starting. An SSH session must allocate
a terminal; credentials belong to the machine running the CLI. If the QR does
not fit, report the required width rather than truncating its quiet zone.

## Approaches

Recommended: the CLI is another initiator of the existing device-login protocol.
Print its existing public app locator as a terminal QR and consume the response
through the current server. The installed iOS app and Vault 1.81.2 already expose
the required flow; their compatibility must be verified by tests.

Encoding the current CLI browser URL is insufficient: its loopback callback
would point at the phone. Adding another device-code service, a headless browser
or another authentication issuer introduces work that this feature does not need.

## Existing owners and implementation boundary

- Change the independent CLI repository, based on 5.4.0 / `7e7bd800`.
- Add `--qr` to the existing login command and reuse its result presentation and
  credential store. Capture the initial profile, origin and authentication state;
  use the existing session guards and credential-store mutation lock to check
  that snapshot before complete and inside the final write. A changed profile or
  session aborts rather than overwriting another process's login. Preserve the
  old credentials throughout a pending or failed attempt.
- Use existing HTTP RequestOptions `skipAuth`, `signal` and `sessionGuard` for
  anonymous requests without refresh or inherited API keys. Honor the configured
  TLS policy, prohibit redirects and never silently downgrade verification. Add
  `User-Agent: znvault-cli/<version>` through the existing headers mechanism.
- Call the existing `/auth/mfa/iphone/protocol` and
  `/auth/mfa/iphone/device-login/{start,status,complete,cancel}` contracts. Check
  the configured HTTPS origin, installation, protocol and unchanged deadline.
- Generate the initiator's ephemeral P-256 key in memory. The QR contains only
  the existing versioned `znvault-authenticator://login` public locator. Keep the
  claimant, private key, decrypted transfer and tokens out of terminal output.
- Use the existing device-key envelope wire format and WebCrypto of Node. The
  two pure core helpers `src/shared/mobile-device-login.ts` and
  `src/shared/device-key-envelope.ts` have no published import for this separate
  CLI repo. Incorporate those helpers with identified source SHA/path/version
  from core `3845089091bed0d65594ccd19333d7aba335c7f1`, semantic changes prohibited
  except necessary packaging/import adaptation. Include the canonical
  `test/fixtures/mobile-device-login/device-envelope-v1.json` vectors. This is a
  bounded copy of the existing codec; do not rewrite HKDF/AAD/AES-GCM or copy the
  React controller. Do not create a package, repository or synchronization
  service for two helpers. Authentication and authorization stay on the server.
- Check the exact transfer context and initiator binding before completing.
  Distinguish the public challengeId from Mobile MFA's requestId. Release the
  non-exportable CryptoKey and zero decrypted byte buffers in finally; do not
  promise guaranteed erasure of JavaScript strings or heap. Persist credentials
  only after a successful response and validated identity. Never repeat complete
  after a lost response, nor report a failed storage write as a persisted login.
- The common server finalizer issues an independent session. Existing device
  revocation, refresh, tenant isolation, RBAC/ABAC and User-Sealed grants apply.
  Login does not grant crypto unseal or the separate User-Sealed approval window.
- No new server route, migration, feature gate or iOS build is planned. Preserve
  `--web`'s PKCE and loopback behavior. CLI 30-day recovery and workstation arm
  remain outside this change. The phone must already be paired and device sign-in
  enabled. Cover tenant users with key transfer and superadmins without one.

## Acceptance

Test success against the existing wire contract, both Vault origins, wrong
origin/installation/initiator, tampered transfer, disabled protocol, denial,
expiry, serial polling with the unchanged deadline, cancellation, late responses,
uncertain completion, concurrent profile/session changes and credential-store
atomicity. Check that
the rendered QR encodes the public locator only; cover narrow terminals and
conflicting/JSON options. Retain password and web-login regressions. Run the
CLI's required typecheck/build/unit/lint checks, then Astra review before
integration and a real phone-to-terminal acceptance when delivering the CLI.

This document does not claim implementation, publication or physical acceptance.

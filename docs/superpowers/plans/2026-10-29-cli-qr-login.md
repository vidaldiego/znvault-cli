# CLI QR Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `znvault login --qr` using the paired iPhone, without a browser.

**Architecture:** The terminal initiates the existing device-login protocol and
prints only its public locator. Vault retains all authentication, authorization,
key custody and session-finalization decisions. Reuse the CLI HTTP transport,
profile mutation owner and the core's unchanged portable envelope modules.

**Tech Stack:** TypeScript, Node WebCrypto, existing RequestOptions/Conf/Commander,
the existing core's qrcode 1.5.4 renderer, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-29-cli-qr-login-design.md` (owner approved).

## Global Constraints

- CLI-only change based on 5.4.0 / 7e7bd800; no Vault routes, migration or iOS build.
- One 120-second attempt; serial polling; no replay of uncertain complete.
- QR contains only public v/origin/installationId/challengeId, never claimant/keys.
- Preserve unseal/User-Sealed independent approvals and existing login methods.
- Capture named profile, origin and initial auth; guard transport and locked write.
- Reject incompatible login flags, API-key profiles, JSON and non-TTY before start.
- Preserve configured TLS; no redirects or automatic verification downgrade.
- Tests use disposable/mocked config, no real credentials or production mutations.

## Review Focus

- Another process refreshes/logs in while QR is pending: preserve its credentials.
- Cancellation/expiry during complete: no late profile writes or silent retry.
- Malformed origin/transfer/identity: fail without reflecting private response data.
- Superadmin has no key transfer: permit the existing server branch without fake keys.
- Terminal QR width/quiet zone and SSH: readable QR, explicit errors, remote storage.

---

### Task 1: Terminal login protocol, command and packaging

**Files:**
- Create `src/lib/qr-login.ts` (bounded initiator and existing profile guards).
- Create `src/lib/qr-login-presentation.ts` (terminal QR and cancellation).
- Copy `src/lib/device-login/{mobile-device-login,device-key-envelope}.ts` and
  `test/fixtures/mobile-device-login/device-envelope-v1.json` from core38450890;
  record provenance in `src/lib/device-login/PROVENANCE.md`.
- Modify `src/commands/auth.ts`, `package.json`, `package-lock.json`, `README.md`.
- Test `test/lib/qr-login.test.ts`, `test/lib/qr-login-presentation.test.ts`,
  `test/lib/device-login-envelope.test.ts`, `test/commands/auth.test.ts`.
- Extend `scripts/verify-package.mjs` to require the installed `login --qr` surface.

**Interfaces:** `qrLogin(peer: HttpClient, options: QrLoginOptions): Promise<QrLoginResult>`;
options contain AbortSignal and an async onPending({locator,origin,expiresAt}) callback.
The command owns terminal checks/SIGINT/rendering; the initiator owns one attempt,
response binding, memory cleanup and guarded storage. Result uses the same user
fields needed by existing login output; no token is returned to the command.

- [ ] Run the existing unit baseline and record its exit/result.
- [ ] Add behavioral tests first: happy path, no key for superadmin, malformed
  origin/installation/transfer, serial pending, deadline, abort/late response,
  uncertain complete once, failed write, and changed profile/auth during final lock.
  Command tests require --qr routing/conflicts and preserve --web/password.
  Presentation tests require locator-only rendering and narrow/JSON/non-TTY rejection.
- [ ] Run focused tests and observe expected failures before product changes.
- [ ] Incorporate the two unmodified algorithms and canonical vectors; add the
  existing renderer dependency with a pinned version. Use skipAuth/signal/sessionGuard
  and explicit CLI User-Agent; keep generic HTTP/profile machinery unchanged.
- [ ] Implement one initiator and command presentation. Zero decoded bytes in finally;
  retain old auth on failure. Do not refactor browser/password auth beyond shared output.
- [ ] Run focused tests to green, then full typecheck/build/unit/lint. Check canonical
  module hashes/semantic diff and test fixture vectors; record all actual results.
- [ ] Build/pack and verify the exact installable package with disposable config;
  require help for QR and existing Trust/User-Sealed/DR surfaces.
- [ ] Request final Astra review of the complete diff and evidence. Fix Important
  findings with focused regressors, then obtain exact-SHA CI and a reviewable PR.

Expected checks: all required commands exit0; no secrets printed; source changes
remain confined to the CLI. Real iPhone-to-terminal acceptance and npm publication
are reported separately, never inferred from tests or this plan.

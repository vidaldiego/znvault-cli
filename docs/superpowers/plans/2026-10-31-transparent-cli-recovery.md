# Transparent CLI recovery Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development for the
> isolated CLI deliverable; parent owns server/app separately. Preserve TDD and
> independent Astra review before integration. No production changes here.

**Goal:** Recover remembered HUMAN CLI authentication automatically for terminal
and agent requests, preserving data channels and all existing authority fences.
**Architecture:** One callback in common HTTP request orchestration, existing
recovery protocol plus shared coordinator/presentation and async lock helper.
**Tech Stack:** Current TypeScript/Commander/Vitest/Node-supported matrix.
**Spec:** [Design](../specs/2026-10-31-transparent-cli-recovery-design.md).

**Local status:** Code `a1710390` and 5.7.0 metadata have [Astra GO](../reviews/2026-10-31-transparent-cli-recovery-astra-review.md).
1805 tests pass with 5 pre-existing skips; focused Node 20/22 suites each pass
87/87. Typecheck, lint, build and exact installable package pass. Delivery is
pending; this record does not claim a registry publication or production grant.

## Global Constraints

One recovery per operation; 120s total; original 30 days; stderr-only instructions;
no stdin; no APIkey/env/local/auth-control fallback; no 403/423/429/network/TLS/
5xx or concurrent 409 fallback. Server owns revocation/validity. Never resend a
marked refresh or uncertain write. No new auth service/store/schema/dependency.
Use temporary config and disable plugins/update checks for direct CLI tests.

## Review Focus

- Concurrent clients/processes including a dead owner never queue pushes.
- Original sent writes and raw/JSON output are never duplicated/contaminated.
- Logout, URL/TLS changes and generation replacement cancel continuation.
- Internal MFA/auth requests cannot recurse; caller guards remain enforced.
- Agent cancellation cleans listeners and does not extend the 30-day deadline.

### Task 1: Shared fallback, coordinator and IO

**Files:** src/index.ts, src/lib/client/{http,types}.ts,
src/lib/{cli-recovery,qr-login-presentation}.ts, commands/auth.ts if needed;
reuse client/refresh-lock.ts and config primitives. Neutral approval messaging
in lib/session-approval.ts and commands/user-sealed.ts/current unseal presenter.
Extend test/lib/{cli-recovery,http-refresh,http-error-details}.test.ts and
existing crossproc/presentation/packed command test suites.

**Interfaces:** configureAutomaticRecovery({present}: {present:(peer:QrLoginPeer,
signal:AbortSignal)=>Promise<QrLoginResult>}|null):void in common HTTP module;
bootstrap supplies existing presenter to all domain clients. Add only internal
RequestOptions recovery budget/replay-safe marker. A local RecoveryReceipt
contains profileName, authGeneration, grantId, expiresAtSec and known principal/
transport identity; no tokens or new persistence. recoverCliLogin retains all
protocol validation and reports the installed generation. A coordinating wrapper
shares one result and uses acquireRefreshLock(key,{timeoutMs:0}); a follower
never starts. Extend the existing presentation to stderr/nonTTY with caller
signal, SIGINT/SIGTERM and a single 120s deadline.

- [x] Baseline targeted HTTP/recovery tests on clean 460, recording results.
- [x] RED real behavioral tests: valid refresh 0 push; missing/expired auth→one
  recovery→one request; stderr-only nonTTY/JSON; excluded errors/auth-control
  never push; approval requests never recurse; cancellation no late tokens.
- [x] RED concurrency/fences/replay tests: two domain clients/two processes one
  push; owner cancellation/death no follower promotion; same-grant generation
  success continues, logout/origin/TLS replacement fails; unsent write 1 send,
  uncertain write 0 replay, authenticated write rejection conservative.
- [x] Implement minimum shared fallback/coordinator/presentation. Preserve
  structured error status/code/Retry-After/failure phase; no text classifiers.
- [x] GREEN focused suites; run npm run typecheck, npm run lint,
  npm run test:unit and npm run build; verify installable package using existing
  scripts. Smoke CLI with disposable config/CI=1/ZNVAULT_NO_PLUGINS=1/
  ZNVAULT_NO_UPDATE_CHECK=1, never real profiles.
- [x] Self-review and commit exact CLI files/docs only; report RED/GREEN/logs,
  assumptions/deferred issues to parent. No push/merge/version/tag/install.
- [x] Independent Astra whole-branch review. Parent handles any findings,
  remaining delivery under the existing goal.

### Task 2: Delivery

- [ ] One PR, exact PR/main CI, normal release publication and verified install.
- [ ] Production protocol activation after current fleet/TLS/epoch preflight.
- [ ] Owner acceptance of enrollment, automatic recovery, deadline and retirement;
  final operational Astra. No workstation arm.

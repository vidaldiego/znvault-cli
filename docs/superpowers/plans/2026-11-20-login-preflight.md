# CLI login preflight implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement each task.

**Goal:** Preserve an existing session and recovery binding when live-login preflight fails.

**Architecture:** Validate read-only server capabilities before retiring recovery or
calling beginProfileAuthentication. Retain all existing authority fences after admission.

**Tech Stack:** TypeScript, Vitest, installed Node CLI, npm Trusted Publishing.

**Spec:** `docs/superpowers/specs/2026-11-20-login-preflight-design.md`

## Global constraints

- Cryptographic protocol 3 and waitEvents protocol 1 remain required.
- No application polling, expired-authority restoration or lifetime increase.
- Real credentials are never used for local tests.

## Review focus

- Remembered QR login must preserve both tokens and grant on failed preflight.
- Concurrent profile/default/preference changes must not be overwritten.
- Recovery preflight must preserve its original deadline and installation binding.
- Rejected preflight never starts, polls, retires or completes an attempt.
- Successful admission and failures after admission retain existing revocation fences.

### Task 1: Read-only admission

**Files:** `src/lib/qr-login.ts`, `src/lib/cli-recovery.ts`, `src/commands/auth.ts`,
`test/lib/qr-login.test.ts`, `test/lib/cli-recovery.test.ts`,
`test/commands/auth-enrollment.test.ts`.

**Interfaces:** QR admission validates the complete local/protocol/installation/
remember-policy state. A beforeStart(expectedFingerprint) callback retires the
old binding only after admission, returns its exact resulting Profile and commits
an explicit preference there. Retirement compares the supplied fingerprint inside
its mutation. QR compares the returned Profile at the next atomic generation
change; it never adopts a concurrent logout or replacement. Recovery and results
retain their existing public interfaces.

- [ ] Add assertions preserving credentials/generation/grant on missing events,
  disabled sign-in, malformed/wrong installation, network failure and cancellation.
- [ ] Run the focused tests and observe the preservation failures.
- [ ] Move admission before mutation; guard capability reads against concurrent changes.
- [ ] Run focused tests, typecheck, lint, build and the complete unit suite.
- [ ] Independently review and commit the fix and documentation.

### Task 2: Release and installed-artifact acceptance

**Files:** `package.json`, `package-lock.json`, `VERSION`, `CHANGELOG.md`, `README.md`.

- [ ] Prepare a patch version only after confirming release authority and tag availability.
- [ ] Follow RELEASING.md: exact-source CI, packed-package verification, reviewed
  main integration, main CI, version tag and OIDC publication/provenance.
- [ ] Preserve the previous official package, install the exact published patch,
  and rerun the isolated installed-code reproduction with unchanged real config.
- [ ] Record operational results and remove task-owned dependencies/build/runtime outputs.

# CLI release discipline

Run releases from the independent `~/Drive/vault/znvault-cli` repository.
A release distributes CLI code; it does not deploy the Vault server, commission
Trust Root or activate an Emergency DR environment.

## Gates

1. Classify the compatibility impact. Removing commands or changing automatic
   local/API selection requires a major release. Update package.json, both
   lockfile version fields, VERSION and CHANGELOG together.
2. Run typecheck, lint, the unit suite with a disposable PostgreSQL through
   DRILL_TEST_DATABASE_URL, and the real MySQL/MariaDB client-security tests.
   CI validates Node 20 and 22. Never point these tests at a production DB.
3. Run `npm run release:check -- vX.Y.Z`, then `npm run build:prod` (cleans dist).
   Pack once with `npm pack --ignore-scripts --pack-destination <temporary-dir>`.
   Verify that exact tarball with `npm run release:verify-package -- <tgz> X.Y.Z`.
   This installs in a temporary prefix with disposable config and checks Trust,
   User-Sealed and DR command surfaces; retired compiled modules must be absent.
4. Commit the complete validated change, push a review branch, and obtain green
   CI on its exact SHA. Integrate on main without rewriting existing history.
   Tag the final main SHA as vX.Y.Z only after CI passes for that main SHA.
5. Push that tag. The publish workflow re-runs the complete CI workflow, checks
   the tag against all version files and current main, builds cleanly, packs
   once, verifies the tarball and digest, then publishes that same artifact
   using npm Trusted Publishing/OIDC with provenance. Branch dispatch cannot
   publish; only version tags trigger the workflow.
6. Verify workflow success, npm version/dist-tag and provenance before installing
   the exact version locally. Preserve the previous installed version for
   rollback. Smoke-test with temporary config first; do not mutate real Vault
   data or run an escrow/DR action as a release smoke test.

## Operational boundaries

The current repo has no protected main branch or rulesets. The workflow checks
are enforced for publication; direct pushes to main remain technically possible.
Do not treat the absence of branch protection as permission to bypass CI.

`zn-trust-root` owns creation and custody ceremonies. CLI v5 keeps verification
and restoration of historical bundles, but removes ceremony/snapshot creation.
Preflight now requires the server's authenticated `/v1/superadmin/lmk/preflight`
endpoint. Its inventory transaction is read-only; the server writes an audit
record that it ran. User-Sealed grants/recovery and DR permit lookup remain.
Never enable legacy trust anchors, provider fallback or DR activation during
release validation.

The canonical workstation is this Mac. Claude Remote is the normal remote work
path; Codex Handoff is deferred until the end of the overall reorganization.

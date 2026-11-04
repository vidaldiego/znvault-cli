# CLI release discipline

Run releases from the independent `~/Drive/vault/znvault-cli` repository.
A release distributes CLI code; it does not deploy the Vault server, commission
Trust Root or activate an Emergency DR environment.

## 6.0.0 compatibility decision

The backup-recovery integration is the unpublished **6.0.0** candidate. Upstream
5.8.1 declares Node >=20.0.0; this candidate requires >=24.22.1 for its native
bounded gzip/zstd recovery codecs. Dropping Node 20/22 support is a breaking
compatibility change and must not be published as a 5.8.1 patch. Upgrade Node
before installing 6.0.0. CI validates the exact minimum and Node 26; an engine
range alone is not evidence that both runtimes passed. Candidate version metadata
does not authorize a tag, npm publication, global installation or deployment.

The recovery feature branch and pull requests targeting main run validation only.
`publish.yml` accepts version-tag pushes only and checks that the tag names the
current main commit. Feature-branch pushes and CI dispatches cannot publish.

## Gates

1. Classify the compatibility impact. Removing commands or changing automatic
   local/API selection, or dropping a previously supported Node version, requires
   a major release. Update package.json, both
   lockfile version fields, VERSION and CHANGELOG together.
2. Run typecheck, lint, the unit suite with a disposable PostgreSQL through
   DRILL_TEST_DATABASE_URL, and the real MySQL/MariaDB client-security tests.
   CI validates Node 24.22.1 and 26. The runtime floor is Node 24.22.1. Never point these tests at a production DB.
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

Recovery artifact qualification uses `node scripts/pack-recovery-package.mjs
ABSOLUTE_NEW_DIRECTORY EXACT_CLI_COMMIT` from a clean candidate. Its public
`candidate.json` pins the tarball, source commit, lockfile and reviewed Archon
snapshot. `node scripts/verify-recovery-package.mjs ABSOLUTE_TGZ
ABSOLUTE_CANDIDATE_JSON ABSOLUTE_SYNTHETIC_FIXTURE_DIRECTORY` installs that exact
package and dependencies during preparation, then exercises recovery under an
OS network denial with hostile profiles/plugins. The npm tarball is not a
self-contained offline installer. Linux uses Docker network none; macOS uses
sandbox-exec deny network. macOS records a tested OS denial and independent
canary observations, not an unavailable raw packet capture. Windows is not
qualified. Recovery only writes authenticated local files, never imports SQL.

Prepare synthetic acceptance inputs once with
`node scripts/prepare-recovery-fixtures.mjs ABSOLUTE_BUILT_CLI_ROOT
ABSOLUTE_ORIGINAL_WRITER_FIXTURES ABSOLUTE_NEW_DIRECTORY`, then pass that new
directory to both verifiers. This preserves identical encrypted pre/post sets
across npm/bundle and platform runs. Linux containers run as the invoking UID
and GID so private recovery outputs remain removable by that same identity.

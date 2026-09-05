# CLI development workspace

These instructions apply to this independent `@zincapp/znvault-cli` repository.
Its primary clone is `~/Drive/vault/znvault-cli`; core, agent, SDKs and plugins
are siblings with their own instructions. Use CLAUDE.md for the CLI architecture.

Install with `npm ci`. Validate with `npm run typecheck`, `npm run build`,
`npm run test:unit` and `npm run lint`. Unit tests mock the configuration store;
integration suites have separate local environment requirements. Use a disposable
`ZNVAULT_CONFIG_DIR` for direct CLI smoke tests and disable plugins and update
checks (`CI=1 ZNVAULT_NO_PLUGINS=1 ZNVAULT_NO_UPDATE_CHECK=1`). Do not use real
profiles or credentials to make local tests pass.

The September 5 recovery branch preserves four unpublished mainline commits:
local DB mode requires explicit selection; LMK preflight goes through the API;
ceremony and escrow creation belong to Trust; existing escrow verification and
restore remain available for legacy artifacts. These changes form the v5 compatibility boundary;
consult RELEASING.md and the release receipt for publication status. Other legacy feature branches remain separately preserved.

Do not recreate nested repositories, reactivate old Mutagen dev-sync, or rewrite
legacy session files. Git hooks are temporarily disabled for recovery. Personal
`.claude/settings.local.json` permissions stay untracked; the legacy copy is
preserved in the recovery evidence and Git history. Local validation does not
require `npm link`, global package updates, tags, pushes or deployment.

This Mac is canonical; Claude Remote is the normal remote workflow. Handoff is deferred.

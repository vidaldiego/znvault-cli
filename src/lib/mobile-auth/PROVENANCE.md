# Portable mobile-auth waiter

Canonical repository: https://github.com/vidaldiego/zn-vault

Canonical paths: `src/shared/mobile-auth-wait.ts` and
`test/fixtures/mobile-auth-wait/v1.json`. These files are copied byte for byte;
no authentication, authorization or completion rules are vendored here.

Canonical source commit: `f3e6bd98d216b2c93b8e4b6537ddcbaa8fa58e10`.
The source commit contains the helper, its tests and the v1 wire fixture.
The SHA-256 digests below pin the exact vendored bytes.

- Helper SHA-256: `8998c9244404e2988d0eeb916ddb14abb510c1f9e22d111b875d6b3bbdecb804`
- Fixture SHA-256: `ef8b412d4a1ae9f45e556075ecf1e85140c1480cc048faf29d8a37f0dc444607`

When updating the helper, copy both canonical files, run both repositories'
fixture and cursor tests, and update these digests together. The CLI never
substitutes its own polling loop, auth proof or completion state machine.

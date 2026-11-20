# Preserve CLI sessions when live authentication is unavailable

The owner requested correction of QR/live failures, premature CLI session loss
and superadmin iPhone pairing after the production diagnosis on 20 November.
This CLI patch covers the session-loss portion; notification transport and the
owner's HUMAN/SERVICE identity decision have separate operational ownership.

QR and recovery must validate the server protocol, installation, event support
and client stream implementation before starting a new authentication generation.
A rejected or failed preflight preserves the existing credentials, recovery grant
and generation. A fresh QR command with a remembered grant must preflight before
retiring that grant. Once a real authentication attempt begins, existing clearing,
revocation, cancellation, identity, generation and profile fences still apply.

The chosen correction moves non-mutating validation before the existing mutation.
Restoring snapshots after failure was rejected because it can resurrect authority
after a concurrent logout or replacement. Increasing JWT lifetimes does not fix
the reproduced credential deletion and is outside this patch.

Keep protocol 3, event protocol 1, token lifetimes, secret custody and the explicit
retry model unchanged. Add no business-state polling or fallback. The default
implementation is native execution with an independent review before integration.

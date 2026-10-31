# Transparent CLI recovery, including agents

Owner chooses automatic recovery also for agents/scripts on 31 October; existing
app is confirmed working. The previous technical draft and Astra recon guide
this change. Current base CLI 5.6.0/460f0bf; server 1.82.1 already supports recovery.

## Behavior and shared authority

A normal command uses current tokens and ordinary refresh. If authentication
cannot continue and its HUMAN profile retains a valid remembered-iPhone grant,
try the existing recovery before returning an error; approve with the original
iPhone and continue the safe request once. `login --recover` remains a manual
entry to the same flow. Initial enrollment is still fresh QR plus signed
30-day consent; no deadline extension, primary-key recovery, unseal or additional
User-Sealed approval. Workstation arm is excluded.

Use one common HttpClient orchestration, not per-command wrappers or a new
server issuer. The server remains the authority for grant validity/revocation
before push. The CLI does not replicate that policy. Missing tokens, terminal
401 after normal refresh or a genuinely orphaned refresh marker may recover.
Never re-present a marked refresh. A current 409/owner contention, 403/423/429,
network/TLS/5xx, API keys, environment credentials, local mode and authentication
control operations do not trigger automatic push.

TTY, nonTTY, agents, scripts, JSON, pipes and quiet mode all support recovery.
Number/login approval/progress go only to stderr; stdout retains the original
data/JSON/raw bytes. No stdin read, password prompt, browser or autoapproval.
A shared 120s deadline includes waiting for a peer, SIGINT/SIGTERM and caller
cancellation; cleanup removes listeners. Internal skipAuth/skipAuthRefresh and
single-use approval requests never start the fallback; one recovery budget
belongs to the outer operation and survives recursion.

One shared Promise per config/profile/origin/grant covers domain clients.
Use the existing async lock helper with a stable namespaced key and initial
nonblocking acquisition. Only the initial owner initiates recovery; followers
wait for valid installed tokens of the same grant or fail, never queue another
push after cancellation/failure/death. No new durable attempt store or keys;
no Conf write lock while awaiting the phone. Release refresh lock first.

Accept only the installed recovery generation for the same profile/principal,
grant/deadline/origin/TLS. Rearm the ordinary guard for that transition; retain
caller-specific guards. Logout, profile replacement and unrelated login stop
continuation. Before transport any method may send once after recovery. After
an actual 401, ordinary reads may repeat once; sent writes require proven
pre-handler rejection or existing idempotency, otherwise recover the session
but report that the operation was not reissued. An uncertain write never repeats.

## Compatible approval messages

The parallel server/app change retains comparisonNumber:string. Unseal and
User-Sealed instructions become neutral: approve on iPhone; if an older app
requests a number use N. They remain separate approvals and never auto-replay.

## Verification and delivery

Use disposable config and mock/ephemeral servers; no production profile tests.
Cover triggers/exclusions, one-flight cross-process concurrency/dead owner,
TTY/nonTTY/JSON/raw/quiet channels, cancellation/120s, profile/transport/identity
fences, sent/unsent writes and original deadline/keylessness. Full current
unit/typecheck/lint/build/package checks and independent Astra before one PR,
normal publication/install and live owner-approved enrollment/recovery. Existing
server capability/gates are used; no server change is required for this block.

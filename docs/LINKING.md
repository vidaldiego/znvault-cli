# Vault linking commands

Requires a server release with linking/schema/fleet capability 1; User-Sealed also needs sealed-link capability 1. A code release does not activate a connection automatically.

1. With source/destination **superadmin** profiles, create pending metadata and explicit tenant mapping:

   ```sh
   znvault --profile principal-admin superadmin linking create offsite \
     --destination-profile offsite-admin --tenant zincapp --peer-tenant zincapp --json
   ```

2. Delegate existing least-scope API keys: destination `linking:receive` only; source selected UUIDs in `conditions.resources.secrets`, with `secret:read:metadata` and STANDARD decrypt and/or strict `linking:export-sealed`. No automatic permission widening or account creation occurs. Use two **tenant JWT** profiles to consent to the returned bindings:

   ```sh
   znvault superadmin linking consent --source-profile zincapp \
     --destination-profile zincapp-offsite --source-binding SOURCE_UUID \
     --destination-binding DESTINATION_UUID
   ```

   Keys enter hidden prompts, or owner-only regular files via `--receiver-key-file` and `--export-key-file`. Never put key values in argv. HTTPS is fixed from each named profile. No stored active-profile switch or credential printing occurs; normal session refresh keeps its existing behaviour. If setup is interrupted, inspect both installations' metadata before retrying creation.

3. Select an individual source secret with a tenant human holding strict `secret:replicate` and applicable source access:

   ```sh
   znvault --profile zincapp secret replication enable app/credential \
     --link offsite --alias retained/app/credential
   znvault --profile zincapp secret replication status app/credential --link offsite --json
   znvault --profile zincapp secret replication sync app/credential --link offsite
   ```

`sync` queues work; it does not claim a remote receipt. `stop`/`resume` operate on a selection; superadmin `linking {test,sync,pause,resume,revoke} BINDING_UUID` operate on transport. Use `--selection UUID` if retained/current selections share a source UUID. Names must resolve unambiguously. Metadata and JSON output exclude values, credential envelopes and encrypted grants.

For User-Sealed, the destination HUMAN first logs in there with their independent password/key. The source human needs a current password-unlocked session, explicit native grant, ordinary read/update and strict replicate rights:

```sh
znvault --profile zincapp secret grants SOURCE_UUID --link offsite --recipients --json
znvault --profile zincapp secret grant SOURCE_UUID --link offsite \
  --user DESTINATION_USER_UUID --fingerprint SHA256:VERIFIED_FINGERPRINT
znvault --profile zincapp secret grants SOURCE_UUID --link offsite --json
znvault --profile zincapp secret revoke SOURCE_UUID --link offsite --user DESTINATION_USER_UUID
```

Verify the user UUID/current key version/fingerprint. A changed key requires regrant. `grants --recipients` explicitly prepares destination keys; ordinary status/grants are metadata-only. No flag keeps existing local-grant behaviour; linked operations never fall back to root recovery. Human revocation is separate from transport revocation and remains pending until received. A storage ACK never proves destination human decrypt.

Destination copies are read only. Origin deletion retains the last received copy/history and remaining grants; a deletion before first copy has no value. A protection/SAK change permanently closes the old selection even while stopped; a new selection needs a new target alias/UUID/grants. During source isolation, only last-received authorisation applies and is marked stale. Post-activation rollback needs a linking-capable server with retained schema.

For a destination-local stop while source is unavailable, use a destination **tenant JWT** profile with strict replicate permission:

```sh
znvault --profile zincapp-offsite superadmin linking revoke-local DESTINATION_BINDING_UUID \
  --request-id RETAINED_REQUEST_UUID --yes --json
```

Keep and reuse that request UUID after an unknown/lost outcome. If reconciling an existing source revocation, use its `revoke_request_id` from source status so the sender can recover the matching receipt. Otherwise create one UUID once. The operation stops all incoming copies on that binding and retains values/grants. The namespace does not grant superadmin authority on the tenant route.

Two-profile create/consent refuses `ZNVAULT_API_KEY`, `ZNVAULT_USERNAME` or `ZNVAULT_PASSWORD` in the process environment and profiles lacking stored JWT sessions or containing API keys. Use an invocation without those overrides; the CLI does not modify or clear your environment. This prevents the shared HTTP client's ordinary ambient authentication from being sent to the other installation.

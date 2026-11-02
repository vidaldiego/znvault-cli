# Assisted backup recovery

Recovery produces authenticated local files only; it does not import SQL, install files or start an application.

```sh
znvault --profile offsite recovery status
znvault --profile offsite recovery keys
znvault --profile offsite recovery status --id SELECTION_RECORD_UUID
znvault --profile offsite recovery keys --id MATERIAL_UUID
znvault --profile offsite recovery extract --key-source vault --backup SELECTION_RECORD_UUID --manifest manifest.json --input dump.arcn --companion-input companion.enc --output NEW_DIRECTORY
znvault --profile offsite recovery verify --key-source vault --expect custodied-selection.json --manifest manifest.json --input dump.arcn --companion-input companion.enc
znvault recovery extract --expect custodied-selection.json --key-file protected-key --manifest manifest.json --input dump.arcn --output NEW_DIRECTORY
```

`--backup` is an exact catalog selection **record UUID**, not a numeric backup ID or latest alias. `--expect` and `--backup` are mutually exclusive. `keys` lists metadata with an optional material ID; `status` lists selections with an optional record ID. Lists return `nextAfter`; pass it with `--after` for the next page. Native metadata permission never grants value access.

Assisted operations require an explicit existing named profile, HTTPS with certificate verification, and its already-stored native session or API key. Profiles configured as insecure are refused. A global URL, environment API key/login, active profile, automatic refresh or CLI session recovery cannot override the chosen profile. Missing/expired credentials require an explicit existing native login before rerunning. The profile's origin and native authentication remain fixed and are rechecked around transport. An optional global `--tls-spki-sha256` applies the native verified pin. There is no failover or local-key fallback.

The resolver returns an accredited exact native binding. Source version and receiver local version may differ; native current/history authorization applies to the receiver version. HUMAN, User-Sealed, ZK, API-key and revocation restrictions remain server-owned. No new value endpoint or credentials format is introduced. Key responses never enter logs/cache/files. Provider-owned buffers and input/decoded local-key buffers are erased on completion, failure or cancellation; this cannot promise erasure of immutable JavaScript strings, TLS internals or operating-system memory.

Local keys remain independent of all profile/client imports. Existing protected raw32 and exactly64 ASCII hex bytes with optional single LF are decoded in memory with the maintained shared codec. Repeated `--key-file` supports independently keyed components without modifying custody files. Other local file protection, limits and atomic complete-set publication rules remain as documented in command help. S3 credentials remain explicit and separate from the key profile.

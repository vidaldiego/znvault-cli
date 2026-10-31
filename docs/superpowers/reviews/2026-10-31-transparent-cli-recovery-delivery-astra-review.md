# Astra — publicación e instalación CLI 5.7.0

31-10-2026. **GO del hito de publicación e instalación CLI 5.7.0, compatible con servidor 1.82.1 / 279f6b2e. Sin findings bloqueantes. La aceptación física de enrollment/recovery continúa pendiente.** Revisión acotada de evidencia operativa y artefactos, sin reauditar producto.

## Identidad, CI y publicación

Inspeccionados `main-ci-qualified.json` y `published-package-qualified.json`, incluidos jobs/steps: main `66e169780fa618ee486ed6e88fec0e1a51e7657f`, CI `41211143895` success (build/tests/typecheck Node20/22, lint y mysql-client-security); publicación `41211712294` success desde tag `v5.7.0`, mismo SHA. El workflow verifica tag/main/version, construye limpio, verifica el tarball y publica ese mismo artefacto mediante OIDC. Readback Git local: árbol idéntico al head revisado `ee8bd8f2351cf7674c40477d721ea8cee31c88e4`; respecto del GO de producto a1710390 solo hay metadata y documentación.

Recalculé SHA256 sobre **ambos tarballs conservados** — artefacto de workflow y copia de registry—: `d89eb3c02e317a60eea3db232942bebbb204bd2f7b0d0018d12e460dae21d2fb`, idénticos. Recalculé también SHA1 e integridad SHA512 y coinciden con dist. Este es el digest publicado; los digests anteriores de paquetes locales no se presentan como identidad del release.

`published-package-verified.log` confirma instalación verificable y superficies Trust/User-Sealed/linking/DR. `published-signatures.log` registra 210 firmas de registry y 38 attestations verificadas. Decodifiqué las dos declaraciones DSSE de `published-attestations.json`: ambos subjects corresponden a @zincapp/znvault-cli@5.7.0 y su SHA512 coincide con el tarball recalculado. Provenance vincula source 66e16978, tag v5.7.0, `.github/workflows/publish.yml`, repositorio vidaldiego/znvault-cli y run 41211712294/attempts/1. La comprobación criptográfica se acredita por el terminal npm conservado; no volví a ejecutarla ni consulté red.

## Instalación local y reversibilidad

`znvault` resuelve a `/opt/homebrew/bin/znvault` → `/opt/homebrew/lib/node_modules/@zincapp/znvault-cli/dist/index.js`. Comparé directamente, byte por byte, package.json, dist/index.js, dist/lib/client/http.js y dist/lib/cli-recovery.js instalados contra el tarball publicado: **4/4 idénticos**; metadata instalada 5.7.0. `global-install-5.7.0.log` registra la instalación y `installed-5.7.0-qualified.json` vincula SHA de fuente/publicación y preservación de configuración. Esta última es evidencia del ejecutor: deliberadamente no abrí configuración, tokens ni secretos para repetirla.

Rollback CLI 5.6.0 conservado; SHA256 recalculado: `ef73a994f41faa7141cc19abeeade90f783c2f6c861f5ba2d8fcd5572a7e461a`. No ejecuté rollback ni cambié npm, binarios, tags o instalación.

## Compatibilidad y límites operativos

Leídos los receipts core `post-enable-fleet-qualified.json` y `post-enable-public-protocols.json`: ambos orígenes 1.82.1/279f6b2e, TLS validado, healthy/ready y recovery ON epoch1; seis procesos observados con el mismo gate. Son observaciones guardadas (14:41–14:42 UTC), no un nuevo sondeo de este revisor. `rollbackReady:false` queda preservado: este GO CLI no acredita un rollback de servidor.

No hay dependencia del despliegue 1.82.2 ni del build nativo7. El contrato de recovery de 1.82.1 ya revisado conserva matching, biometría, PKCE, grant con deadline fijo y sesión sin clave primaria User-Sealed. La ayuda neutral del CLI muestra el número compatible cuando la app/servidor aún lo requieren; no omite ni rellena decisiones. Los cambios biométricos operacionales posteriores mantienen su propio gate. Tener la app archivada o un protocolo ON no demuestra enrollment ni recuperación física.

No se consumieron los QR pendientes ni se infirió aceptación del dueño. Native upload/aceptación, rollout 1.82.2, workstation arm y capacidades User-Sealed adicionales quedan fuera. Única escritura del revisor: este informe; resto lecturas locales de fuentes públicas de paquete/evidencia, sin red ni perfiles reales.

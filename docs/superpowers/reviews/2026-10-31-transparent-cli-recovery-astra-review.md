# Astra — cierre de código CLI y contrato combinado

31-10-2026. **GO de código CLI exacto `a1710390ae4be2383e3e91466d8d830a40996c65`; GO del delta local de metadata 5.7.0; GO de coherencia combinada con servidor/app `4f70fbde1bd4f7a50aaf3ecae2d08f0a8ad5f59f`. Sin findings Critical, Important o Minor abiertos.** Estos dictámenes permiten continuar los gates de PR/CI; no certifican publicación, despliegue, activación de recovery ni aceptación física.

## Alcance exacto y evidencia CLI

Readback de HEAD coincide con el SHA indicado. La revisión completa de fuentes/tests y sus tres findings corregidos está en `implementation-astra.md`; este cierre relee las correcciones en la fuente comprometida y consume los terminales finales, no solo mensajes del implementador. El commit contiene los mismos 25 archivos revisados sobre base `460f0bfa189d028fa0b1c17d87bb353cc7c703a3`. El único delta posterior observado consta de CHANGELOG.md, VERSION, package.json y package-lock.json: versión 5.7.0 consistente, sin cambio de dependencias, runtime ni tests. `git diff --check` sin errores.

Terminales inspeccionados en este workspace:

- `full-reviewed.log`: 112 archivos correctos / 1 omitido; **1805 tests correctos / 5 omitidos**, sin fallos. Mantiene warnings previos de hoisting de mocks MySQL; no se presentan como lint de producto.
- `node20-reviewed.log` y `node22-reviewed.log`: **87/87 cada uno**, los cinco archivos enfocados finales. `typecheck-reviewed.log`, `lint-reviewed.log`, `build-reviewed.log` y `release-check.log` contienen los gates terminales sin diagnósticos de fallo; el reporte de ejecución registra PASS.
- `package-verified.log`: verificación instalada exacta 5.6.0, incluidas superficies Trust/User-Sealed/linking/DR. SHA256 registrado en `package-sha256.txt`: `2fdfca3c20cfcc5d5b59404247b9f46f2ee377156e5c537153fa8863052e7688`.
- Metadata 5.7.0: `build-5.7.0.log`, `release-check-5.7.0-green.log` y `package-5.7.0-verified.log` confirman build, metadata coherente y paquete instalado verificable. Receipt `package-5.7.0-receipt.json` vincula el código a a1710390 y registra SHA256 `4e1d86c6ac66a4972befc8391bfb66b0214aa81b1401f0c3984640b6797e52d6`. Los tarballs temporales fueron eliminados por su dueño: inspeccioné recibos/manifiesto/logs, no recalculé esos hashes sobre un artefacto conservado.

Las regresiones de entorno, refresh alternativo marcado y cesión durante import permanecen corregidas (`http.ts:469`, `:402`, `:477`). Se mantiene la auditoría de tests previa: expectativas nonTTY legítimas, assertions de seguridad intactas, dos presupuestos multiproceso ampliados sin relajar resultados, fixtures bin HTTPS reales con stdout raw/JSON exacto y stdin abierto. No hay nueva excepción authN/authZ ni reenvío de refresh marcado.

## Contrato combinado servidor/app/CLI

Consumidos los dictámenes independientes `task1-astra.md` y `task2-astra.md` de `.superpowers/sdd/2026-10-31-biometric-operation-approvals` del core; confirmada la ascendencia de producto `6e54612efafd6073ff4a8047830b7e3302d38e2d` + `19932fd3a946c9dd3e57cc10e0b9c9545b66b5fc` hasta 4f70fbde, cuyo delta posterior es metadata/documentación. Contraste puntual de fuentes y diseño, sin repetir la auditoría completa de app:

- `MobileMfaService.startRecovery` sigue devolviendo `comparisonNumber: string`; `validApprovalSelection` exige matching en legacy/login/recovery y rechaza cualquier marca en propósito no operacional. Solo operaciones válidas crypto/root/User-Sealed reciben `approvalInteraction: biometric-only` en los bytes almacenados y firmados. El cuerpo del caller no selecciona esta política.
- iOS valida marca, propósito e intent y compara approve/deny antes de ofrecer el botón sin número; envía nil explícito, sin autofill. La firma/biometría y autoridad siguen en el coordinador/keystore existentes. El CLI solo cambia instrucciones neutrales para aprobaciones operacionales; su presentación de recovery mantiene número, vencimiento y separación unseal/User-Sealed.
- `CliRecoveryService.start` verifica grant/owner/epoch/revocación bajo el fence existente antes de crear request; el push ocurre después. `complete` revalida intent, dispositivo, PKCE y consume único; usa el emisor común con `absoluteExpiresAtSec: grant.expires_at_sec`, cambia familia sin extender el grant. No recupera clave primaria User-Sealed ni concede ventana de aprobación.
- El HTTP compartido decide cuándo coordinar, nunca si el usuario tiene autorización. Conserva refresh primero, exclusiones de transporte/403/423/429/5xx/409 y auth-control, una recuperación/120 s, single-flight y lock sin promoción del seguidor, recibo de generación/perfil/origen/TLS y una sola continuación segura. Un envío de escritura incierto no se reproduce. No hay controlador de MFA, custodia o política de autorización duplicado.

Terminales core inspeccionados: `server-final-all.log` **43/43**; `dashboard-tests.log` **149/149**; `native-green.log`, `native-large-27.log`, `native-duo.log` **102/102, cero fallos/omitidos, TEST SUCCEEDED** cada uno. Se conserva el límite del dictamen previo: intento iOS 26.5 inconcluso de harness, no aprobado; full lint dashboard con deuda ajena al delta, no declarado verde. La matriz aprobada es Pro/Max iOS 27.0 y Duo iOS 27.1.

## Límite del GO

Revisión de fuentes y evidencia local; no ejecuté tests/red ni toqué perfiles reales, producto o Git. Única escritura: este informe. El SHA futuro que incorpore los cuatro archivos 5.7.0 debe fijarse y pasar CI/entrega normal. No se hereda ninguna excepción operativa de 1.82.1 ni aceptación de una app anterior. Workstation arm, nuevas capacidades User-Sealed, publicación, rollout y aceptación física siguen fuera.

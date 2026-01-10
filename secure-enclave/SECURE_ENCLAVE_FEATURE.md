# Secure Enclave Device Enrollment Feature

## Current Status

The feature is implemented but **Secure Enclave access requires proper code signing**.

### What Works Now

1. **Software Key Mode** - Use `--software-key` flag to bypass Secure Enclave (for testing/development)
2. **Auto-detection** - Unseal command automatically detects if you have a software or Secure Enclave key
3. **Full enrollment flow** - Generate key, register with server, unseal with device

### Commands

```bash
# Enroll with software key (works without special signing)
znvault device enroll --software-key -n "My MacBook"

# Enroll with Secure Enclave (requires proper signing - see below)
znvault device enroll -n "My MacBook"

# Unseal (auto-detects key type)
znvault unseal --device

# Or let it auto-detect
znvault unseal
```

### Files

- `znvault-cli/secure-enclave/` - Swift helper binary
  - `Package.swift` - Swift package definition
  - `Sources/main.swift` - Helper implementation
  - `entitlements.plist` - Code signing entitlements

- `znvault-cli/src/commands/device.ts` - Device enrollment CLI
- `znvault-cli/src/commands/unseal.ts` - Unseal with device support

### Environment Variables

- `ZNVAULT_USE_SOFTWARE_KEYS=1` - Force software key mode in the Swift helper

## Secure Enclave Signing Requirements

To use actual Secure Enclave with Touch ID, the helper binary must be properly signed.

### Option 1: Developer ID Application Certificate (Recommended)

1. Go to Apple Developer Portal > Certificates
2. Create a "Developer ID Application" certificate
3. Download and install in Keychain
4. Sign the binary:

```bash
cd znvault-cli/secure-enclave
swift build -c release

codesign --sign "Developer ID Application: ZincApp SL (679CYHH847)" \
  --entitlements entitlements.plist \
  --options runtime \
  --force \
  .build/release/znvault-secure-enclave
```

### Option 2: Provisioning Profile

1. Create App ID in Apple Developer Portal with bundle ID `com.zincapp.znvault.secure-enclave-helper`
2. Enable "Keychain Sharing" capability
3. Create provisioning profile
4. Sign with profile embedded

### Current Certificates Available

```
Apple Development: Diego Alberto Vidal (B3HK8FSCVQ)
Apple Development: info@zincapp.com (LXARXDH89S)
Apple Development: Diego Alberto Vidal Giorno (ND9Z8CH973)
```

None of these are Developer ID Application certificates - they're development certificates which require provisioning profiles for keychain access.

## Testing Without Secure Enclave

Use software keys for development/testing:

```bash
# 1. Unseal with OTP first
znvault unseal --otp

# 2. Enroll with software key
znvault device enroll --software-key -n "Test Device"

# 3. Seal
znvault seal

# 4. Unseal with device key
znvault unseal --device
```

## Architecture

```
┌─────────────────┐     execSync      ┌──────────────────────┐
│  znvault CLI    │ ───────────────── │  znvault-secure-     │
│  (TypeScript)   │   JSON stdout     │  enclave (Swift)     │
└─────────────────┘                   └──────────────────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │  Secure Enclave  │
                                      │  (or Keychain    │
                                      │   for software)  │
                                      └──────────────────┘
```

## API Endpoints Used

- `POST /v1/devices/enroll` - Register device with server
- `POST /v1/auth/unseal/challenge` - Get challenge for signing
- `POST /v1/auth/unseal/verify` - Verify signature and unseal

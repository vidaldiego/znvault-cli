// Path: znvault-cli/secure-enclave/Sources/main.swift

import Foundation
import Security
import LocalAuthentication
import CryptoKit

// MARK: - Output Structures

struct GenerateOutput: Codable {
    let success: Bool
    let publicKeyPem: String?
    let credentialId: String?
    let error: String?
}

struct SignOutput: Codable {
    let success: Bool
    let signature: String?
    let error: String?
}

struct DeleteOutput: Codable {
    let success: Bool
    let error: String?
}

struct CheckOutput: Codable {
    let success: Bool
    let exists: Bool
    let error: String?
}

// MARK: - Constants

let keyTag = "com.zincapp.znvault.secure-enclave-key"
let keychainService = "com.zincapp.znvault"

// Environment variable to force software keys (for testing or when Secure Enclave unavailable)
let useSoftwareKeys = ProcessInfo.processInfo.environment["ZNVAULT_USE_SOFTWARE_KEYS"] == "1"

// MARK: - Helpers

func outputJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = .prettyPrinted
    if let data = try? encoder.encode(value), let json = String(data: data, encoding: .utf8) {
        print(json)
    }
}

func getKeyTag() -> Data {
    return keyTag.data(using: .utf8)!
}

// MARK: - Key Management

func generateKey(deviceName: String) {
    // Check if key already exists
    let existingKey = getPrivateKey()
    if existingKey != nil {
        outputJSON(GenerateOutput(
            success: false,
            publicKeyPem: nil,
            credentialId: nil,
            error: "A key already exists. Use 'delete' first to remove it."
        ))
        return
    }

    var privateKey: SecKey

    if useSoftwareKeys {
        // Software key mode - no biometrics, stored in keychain
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: getKeyTag(),
                kSecAttrLabel as String: "ZnVault Device Key (\(deviceName)) [Software]"
            ] as [String: Any]
        ]

        var createError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &createError) else {
            let errorDesc = createError?.takeRetainedValue().localizedDescription ?? "Unknown error"
            outputJSON(GenerateOutput(
                success: false,
                publicKeyPem: nil,
                credentialId: nil,
                error: "Failed to generate software key: \(errorDesc)"
            ))
            return
        }
        privateKey = key
    } else {
        // Secure Enclave mode - requires biometrics
        let context = LAContext()
        context.localizedReason = "Create secure key for ZnVault"

        // Access control: require biometric authentication for key use
        var accessError: Unmanaged<CFError>?
        guard let accessControl = SecAccessControlCreateWithFlags(
            kCFAllocatorDefault,
            kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
            [.privateKeyUsage, .biometryCurrentSet],
            &accessError
        ) else {
            outputJSON(GenerateOutput(
                success: false,
                publicKeyPem: nil,
                credentialId: nil,
                error: "Failed to create access control: \(accessError?.takeRetainedValue().localizedDescription ?? "unknown")"
            ))
            return
        }

        // Key attributes for Secure Enclave
        let attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
            kSecUseDataProtectionKeychain as String: true,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: getKeyTag(),
                kSecAttrAccessControl as String: accessControl,
                kSecAttrLabel as String: "ZnVault Device Key (\(deviceName))"
            ] as [String: Any],
            kSecUseAuthenticationContext as String: context
        ]

        var createError: Unmanaged<CFError>?
        guard let key = SecKeyCreateRandomKey(attributes as CFDictionary, &createError) else {
            let errorDesc = createError?.takeRetainedValue().localizedDescription ?? "Unknown error"
            outputJSON(GenerateOutput(
                success: false,
                publicKeyPem: nil,
                credentialId: nil,
                error: "Failed to generate key: \(errorDesc)"
            ))
            return
        }
        privateKey = key
    }

    // Get public key
    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        outputJSON(GenerateOutput(
            success: false,
            publicKeyPem: nil,
            credentialId: nil,
            error: "Failed to get public key"
        ))
        return
    }

    // Export public key as PEM
    var exportError: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
        outputJSON(GenerateOutput(
            success: false,
            publicKeyPem: nil,
            credentialId: nil,
            error: "Failed to export public key: \(exportError?.takeRetainedValue().localizedDescription ?? "unknown")"
        ))
        return
    }

    // Convert to PEM format (SEC1/X9.63 to SubjectPublicKeyInfo)
    let pemKey = convertToPEM(publicKeyData: publicKeyData)

    // Generate credential ID (UUID)
    let credentialId = UUID().uuidString

    // Store credential ID in Keychain for reference
    storeCredentialId(credentialId)

    outputJSON(GenerateOutput(
        success: true,
        publicKeyPem: pemKey,
        credentialId: credentialId,
        error: nil
    ))
}

func signChallenge(_ challenge: String) {
    guard let privateKey = getPrivateKey() else {
        outputJSON(SignOutput(
            success: false,
            signature: nil,
            error: "No key found. Please enroll a device first."
        ))
        return
    }

    // Decode challenge (base64)
    guard let challengeData = Data(base64Encoded: challenge) else {
        // Try as plain string
        guard let challengeData = challenge.data(using: .utf8) else {
            outputJSON(SignOutput(
                success: false,
                signature: nil,
                error: "Invalid challenge format"
            ))
            return
        }
        signData(privateKey: privateKey, data: challengeData)
        return
    }

    signData(privateKey: privateKey, data: challengeData)
}

func signData(privateKey: SecKey, data: Data) {
    // Sign with ECDSA SHA-256
    var signError: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        privateKey,
        .ecdsaSignatureMessageX962SHA256,
        data as CFData,
        &signError
    ) as Data? else {
        outputJSON(SignOutput(
            success: false,
            signature: nil,
            error: "Failed to sign: \(signError?.takeRetainedValue().localizedDescription ?? "unknown")"
        ))
        return
    }

    // Return base64-encoded signature
    outputJSON(SignOutput(
        success: true,
        signature: signature.base64EncodedString(),
        error: nil
    ))
}

func deleteKey() {
    var query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: getKeyTag(),
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom
    ]

    // Only use data protection keychain for Secure Enclave keys
    if !useSoftwareKeys {
        query[kSecUseDataProtectionKeychain as String] = true
    }

    let status = SecItemDelete(query as CFDictionary)

    if status == errSecSuccess || status == errSecItemNotFound {
        // Also delete credential ID
        deleteCredentialId()

        outputJSON(DeleteOutput(
            success: true,
            error: nil
        ))
    } else {
        outputJSON(DeleteOutput(
            success: false,
            error: "Failed to delete key: \(status)"
        ))
    }
}

func checkKey() {
    let exists = getPrivateKey() != nil
    outputJSON(CheckOutput(
        success: true,
        exists: exists,
        error: nil
    ))
}

func getPrivateKey() -> SecKey? {
    var query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: getKeyTag(),
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true
    ]

    // Only use data protection keychain for Secure Enclave keys
    if !useSoftwareKeys {
        query[kSecUseDataProtectionKeychain as String] = true
    }

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    if status == errSecSuccess {
        return (item as! SecKey)
    }
    return nil
}

// MARK: - Credential ID Storage

func storeCredentialId(_ credentialId: String) {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: "credential-id",
        kSecValueData as String: credentialId.data(using: .utf8)!
    ]

    // Delete existing if any
    SecItemDelete(query as CFDictionary)

    // Add new
    SecItemAdd(query as CFDictionary, nil)
}

func getCredentialId() -> String? {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: "credential-id",
        kSecReturnData as String: true
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    if status == errSecSuccess, let data = item as? Data {
        return String(data: data, encoding: .utf8)
    }
    return nil
}

func deleteCredentialId() {
    let query: [String: Any] = [
        kSecClass as String: kSecClassGenericPassword,
        kSecAttrService as String: keychainService,
        kSecAttrAccount as String: "credential-id"
    ]
    SecItemDelete(query as CFDictionary)
}

// MARK: - PEM Conversion

func convertToPEM(publicKeyData: Data) -> String {
    // EC P-256 public key from Secure Enclave is in X9.63 format (65 bytes: 04 || X || Y)
    // We need to wrap it in SubjectPublicKeyInfo ASN.1 structure

    // OID for EC public key: 1.2.840.10045.2.1
    // OID for P-256 curve: 1.2.840.10045.3.1.7
    let ecPublicKeyOID: [UInt8] = [0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01]
    let prime256v1OID: [UInt8] = [0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]

    // Build AlgorithmIdentifier SEQUENCE
    var algorithmIdentifier: [UInt8] = [0x30] // SEQUENCE tag
    let algContent = ecPublicKeyOID + prime256v1OID
    algorithmIdentifier.append(UInt8(algContent.count))
    algorithmIdentifier.append(contentsOf: algContent)

    // Build BIT STRING for public key
    var bitString: [UInt8] = [0x03] // BIT STRING tag
    let bitStringContent: [UInt8] = [0x00] + Array(publicKeyData) // 0x00 = no unused bits
    bitString.append(UInt8(bitStringContent.count))
    bitString.append(contentsOf: bitStringContent)

    // Build SubjectPublicKeyInfo SEQUENCE
    var spki: [UInt8] = [0x30] // SEQUENCE tag
    let spkiContent = algorithmIdentifier + bitString

    // Handle length encoding
    if spkiContent.count < 128 {
        spki.append(UInt8(spkiContent.count))
    } else {
        // Long form length encoding
        let lengthBytes = withUnsafeBytes(of: spkiContent.count.bigEndian) { Array($0).drop(while: { $0 == 0 }) }
        spki.append(0x80 | UInt8(lengthBytes.count))
        spki.append(contentsOf: lengthBytes)
    }
    spki.append(contentsOf: spkiContent)

    // Base64 encode and format as PEM
    let base64 = Data(spki).base64EncodedString(options: [.lineLength64Characters, .endLineWithLineFeed])
    return "-----BEGIN PUBLIC KEY-----\n\(base64)\n-----END PUBLIC KEY-----"
}

// MARK: - Main

func printUsage() {
    print("""
    znvault-secure-enclave - Secure Enclave key management for ZnVault

    Usage:
      znvault-secure-enclave generate <device-name>  Generate new key pair
      znvault-secure-enclave sign <challenge>        Sign a challenge (base64)
      znvault-secure-enclave delete                  Delete the key
      znvault-secure-enclave check                   Check if key exists
      znvault-secure-enclave credential-id           Get stored credential ID

    All output is JSON for easy parsing.
    """)
}

let args = CommandLine.arguments

if args.count < 2 {
    printUsage()
    exit(1)
}

let command = args[1]

switch command {
case "generate":
    if args.count < 3 {
        outputJSON(GenerateOutput(
            success: false,
            publicKeyPem: nil,
            credentialId: nil,
            error: "Device name required"
        ))
        exit(1)
    }
    generateKey(deviceName: args[2])

case "sign":
    if args.count < 3 {
        outputJSON(SignOutput(
            success: false,
            signature: nil,
            error: "Challenge required"
        ))
        exit(1)
    }
    signChallenge(args[2])

case "delete":
    deleteKey()

case "check":
    checkKey()

case "credential-id":
    if let credentialId = getCredentialId() {
        print(credentialId)
    } else {
        print("")
        exit(1)
    }

case "help", "--help", "-h":
    printUsage()

default:
    printUsage()
    exit(1)
}

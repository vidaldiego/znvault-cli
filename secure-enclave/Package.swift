// swift-tools-version:5.9
// Path: znvault-cli/secure-enclave/Package.swift

import PackageDescription

let package = Package(
    name: "znvault-secure-enclave",
    platforms: [
        .macOS(.v12)
    ],
    products: [
        .executable(name: "znvault-secure-enclave", targets: ["SecureEnclaveHelper"])
    ],
    targets: [
        .executableTarget(
            name: "SecureEnclaveHelper",
            path: "Sources"
        )
    ]
)

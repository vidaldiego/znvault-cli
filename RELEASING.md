# Releasing

This CLI uses automated tag-based releases via GitHub Actions with npm Trusted Publishing (OIDC).

## How to Release

1. **Update version** in `package.json`:
   ```json
   "version": "X.Y.Z"
   ```

2. **Commit and push**:
   ```bash
   git add package.json package-lock.json
   git commit -m "chore: bump version to X.Y.Z"
   git push origin main
   ```

3. **Create and push tag**:
   ```bash
   git tag vX.Y.Z
   git push origin vX.Y.Z
   ```

GitHub Actions will automatically:
- Build and test the project
- Publish to npm using OIDC (no tokens required!)

## npm Trusted Publishing

This repository uses [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers/) via OpenID Connect (OIDC). This means:
- No npm tokens stored in GitHub secrets
- Secure, short-lived credentials per workflow run
- Automatic provenance attestation

## Installation

Users install globally:
```bash
npm install -g @zincapp/znvault-cli
```

## Verifying Release

After pushing a tag, check:
1. [GitHub Actions](https://github.com/vidaldiego/znvault-cli/actions) - workflow status
2. [npm](https://www.npmjs.com/package/@zincapp/znvault-cli) - published version

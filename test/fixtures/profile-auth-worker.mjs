const [configDirectory, profileName] = process.argv.slice(2);
if (!configDirectory || !profileName) process.exit(2);

process.env.ZNVAULT_CONFIG_DIR = configDirectory;

const { setRuntimeProfile, storeCredentials } = await import('../../dist/lib/config/index.js');
setRuntimeProfile(profileName);

try {
  storeCredentials({
    accessToken: 'test-access-token',
    refreshToken: 'test-refresh-token',
    expiresAt: Date.now() + 60_000,
    userId: 'test-user',
    username: 'test-user',
    role: 'user',
    tenantId: 'test-tenant',
  });
  process.stdout.write(`${JSON.stringify({ stored: true, authMethod: 'jwt' })}\n`);
} catch {
  process.stdout.write(`${JSON.stringify({ stored: false, authMethod: 'jwt' })}\n`);
  process.exitCode = 1;
}

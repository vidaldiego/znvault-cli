const [configDirectory, profileName, mode = 'jwt'] = process.argv.slice(2);
if (!configDirectory || !profileName) process.exit(2);
process.env.ZNVAULT_CONFIG_DIR = configDirectory;

const config = await import('../../dist/lib/config/index.js');
const {setRuntimeProfile, storeCredentials} = config;
setRuntimeProfile(profileName);
const credentials = (label = 'test') => ({
  accessToken: `${label}-access-token`, refreshToken: `${label}-refresh-token`, expiresAt: Date.now()+60_000,
  userId: 'test-user', username: 'test-user', role: 'user', tenantId: 'test-tenant',
});
async function barrier(phase) {
  if (!process.send) throw new Error('Test IPC required');
  process.send({phase});
  await new Promise(resolve => process.once('message', resolve));
}
async function exerciseRecovery(coordinated = false) {
  const {randomBytes, randomUUID} = await import('node:crypto');
  const {recoverCliLogin, coordinateCliRecovery} = await import('../../dist/lib/cli-recovery.js');
  const saved = config.getProfile(profileName).cliRecovery;
  const requestId = randomUUID(), claimant = randomBytes(32).toString('base64url'), expiresAt = Math.floor(Date.now()/1000)+120;
  const peer = {getBaseUrl: () => saved.origin, request: async options => {
    options.sessionGuard?.();
    if (options.path.endsWith('/protocol')) return {protocolVersion: 3, origin: saved.origin, installationId: saved.installationId, cliRecovery: {version: 1, enabled: true}};
    if (options.path.endsWith('/start')) {process.send?.({phase:'recovery-started'});return {requestId, claimant, expiresAt, comparisonNumber: '42'};}
    if (options.path.endsWith('/status')) return {state: 'approved', expiresAt};
    if (options.path.endsWith('/complete')) {
      await barrier('before-complete');
      const tokens = credentials('recovery');
      return {accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresIn: 900, userSealedUnlocked: false,
        user: {id: tokens.userId, username: tokens.username, role: tokens.role, tenantId: tokens.tenantId}};
    }
    if (options.path.endsWith('/cancel')) return {cancelled: true};
    throw new Error('Unexpected test request');
  }};
  const present = (target, signal) => recoverCliLogin(target, {signal, onPending: async () => {}});
  if (coordinated) {process.send?.({phase:'following'});await coordinateCliRecovery(peer, present);return true;}
  return (await present(peer)).success;
}

try {
  let stored = true;
  if (mode === 'config-url') {
    const {HttpClient} = await import('../../dist/lib/client/http.js');
    HttpClient.prototype.request = async options => {
      if (options.path !== '/auth/cli/recovery/revoke') throw new Error('Unexpected test request');
      await barrier('retire-sent');return {revoked:true};
    };
    // Exercise the default active-profile path, rather than a --profile override.
    config.setRuntimeProfile(null);
    const {Command} = await import('commander');
    const {registerAuthCommands} = await import('../../dist/commands/auth.js');
    const program = new Command();program.exitOverride();registerAuthCommands(program);
    await program.parseAsync(['node','fixture','config','set','url','https://changed.example.test']);
  } else if (mode === 'recover') stored = await exerciseRecovery();
  else if (mode === 'automatic') stored = await exerciseRecovery(true);
  else if (mode === 'refresh') {
    const {HttpClient} = await import('../../dist/lib/client/http.js');
    const peer = new HttpClient();
    peer.request = async options => {
      options.sessionGuard?.();
      if (!options.path.endsWith('/auth/refresh')) throw new Error('Unexpected test request');
      await barrier('refresh-sent');
      return {accessToken: 'late-refresh-access', refreshToken: 'late-refresh-token', expiresIn: 900};
    };
    await peer.refreshToken({skipIfLive: false});
  } else if (mode === 'retire' || mode === 'delete-recreate') {
    const {HttpClient} = await import('../../dist/lib/client/http.js');
    HttpClient.prototype.request = async options => {
      if (options.path !== '/auth/cli/recovery/revoke') throw new Error('Unexpected test request');
      return {revoked: true};
    };
    const {retireStoredCliRecovery} = await import('../../dist/lib/cli-recovery.js');
    const origin = config.getProfile(profileName).url;
    await retireStoredCliRecovery(profileName);
    if (mode === 'delete-recreate') {config.deleteProfile(profileName);config.createProfile(profileName, {url: origin});}
  } else if (mode === 'jwt') storeCredentials(credentials());
  else throw new Error('Unknown test mode');
  process.stdout.write(`${JSON.stringify({stored, authMethod: mode === 'jwt' ? 'jwt' : mode})}\n`);
  if (!stored) process.exitCode = 1;
} catch {
  process.stdout.write(`${JSON.stringify({stored: false, authMethod: mode === 'jwt' ? 'jwt' : mode})}\n`);
  process.exitCode = 1;
} finally {if (process.connected) process.disconnect();}

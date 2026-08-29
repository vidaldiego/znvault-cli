const [configDirectory, mode, firstProfile, secondProfile] = process.argv.slice(2);
if (!configDirectory || !mode) process.exit(2);

process.env.ZNVAULT_CONFIG_DIR = configDirectory;

const { addPlugin, switchProfile } = await import('../../dist/lib/config/index.js');
const waitBuffer = new Int32Array(new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT));

// Give the concurrently spawned import processes time to reach their own
// config mutation. Repeated real writes then keep the collision window open.
Atomics.wait(waitBuffer, 0, 0, 100);

try {
  for (let index = 0; index < 250; index += 1) {
    if (mode === 'plugins') {
      addPlugin({ path: `/tmp/znvault-race-plugin-${index % 5}`, enabled: index % 2 === 0 });
    } else if (mode === 'switch' && firstProfile && secondProfile) {
      switchProfile(index % 2 === 0 ? firstProfile : secondProfile);
    } else {
      process.exit(2);
    }
  }
  process.stdout.write(`${JSON.stringify({ completed: true, mode })}\n`);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}

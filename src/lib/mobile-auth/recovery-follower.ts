import {watch, type FSWatcher} from 'node:fs';
import {basename, dirname} from 'node:path';

/** Filesystem events are hints; the caller retains all generation and identity checks. */
export async function waitForRecoveryOwner(input: {
  configPath: string; lockPath: string; signal: AbortSignal;
  recheck(): Promise<'pending' | 'ready' | 'failed'>;
}): Promise<void> {
  input.signal.throwIfAborted();
  const watchers: FSWatcher[] = [];
  const state: {dirty:boolean; failure?:Error} = {dirty:true};
  let wake: (() => void) | undefined;
  const notify = (): void => {wake?.();};
  const abort = (): void => {state.failure = input.signal.reason instanceof Error ? input.signal.reason : new Error('CLI recovery cancelled.');notify();};
  input.signal.addEventListener('abort', abort, {once: true});
  const assertHealthy = (): void => {input.signal.throwIfAborted();if (state.failure !== undefined) throw state.failure;};
  const changed = (): boolean => state.dirty;
  try {
    const parents = new Set([dirname(input.configPath), dirname(input.lockPath)]);
    for (const parent of parents) {
      let watcher:FSWatcher;
      try {watcher = watch(parent, (event, filename) => {
        // A lock heartbeat changes mtime only. Only creation/removal may release ownership.
        const name = filename?.toString();
        if ((parent === dirname(input.configPath) && name === basename(input.configPath)) ||
            (event === 'rename' && parent === dirname(input.lockPath) && name === basename(input.lockPath))) {
          state.dirty = true;notify();
        }
      });} catch {throw new Error('CLI recovery file watch failed. Explicitly retry.');}
      watcher.on('error', () => {state.failure = new Error('CLI recovery file watch failed. Explicitly retry.');notify();});
      watchers.push(watcher);
    }
    for (;;) {
      assertHealthy();
      if (state.dirty) {
        state.dirty = false;
        const result = await input.recheck();
        assertHealthy();
        if (result === 'ready') return;
        // A config/release event received during a read must reconcile before failure.
        if (changed()) continue;
        if (result === 'failed') throw new Error('The other CLI recovery ended without installing a session. Explicitly retry.');
      }
      await new Promise<void>(resolve => {wake = resolve;});wake = undefined;
    }
  } finally {
    input.signal.removeEventListener('abort', abort);
    for (const watcher of watchers) watcher.close();
  }
}

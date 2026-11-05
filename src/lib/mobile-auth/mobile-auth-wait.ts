/** Portable v1 mobile-auth hint protocol. Hints never convey authorization or status. */
export type MobileWaitEvent =
  | {type: 'changed'; version: 1; requestId: string; revision: string}
  | {type: 'expired' | 'invalidated' | 'unavailable'; version: 1; requestId: string; revision?: string};
const revisionPattern = /^(0|[1-9][0-9]{0,19})$/;
const frameLimit = 16 * 1024;
function invalid(): never {throw new Error('MOBILE_AUTH_EVENTS_INVALID');}
function revision(value: unknown): value is string {return typeof value === 'string' && revisionPattern.test(value);}

/** Incremental SSE decoder, shared by native Node HTTP and browser fetch adapters. */
export async function* parseMobileWaitEvents(chunks: AsyncIterable<Uint8Array | string>, requestId: string): AsyncGenerator<MobileWaitEvent> {
  const decoder = new TextDecoder('utf-8', {fatal: true});
  let pending = '', event = '', id = '', data: string[] = [], bytes = 0;
  function frame(): MobileWaitEvent | undefined {
    if (!event && data.length === 0 && !id) return undefined;
    if (!['changed', 'expired', 'invalidated', 'unavailable'].includes(event) || data.length !== 1) return invalid();
    let value: unknown;
    try {value = JSON.parse(data.join(''));} catch {return invalid();}
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return invalid();
    const body = value as Record<string, unknown>;
    if (body.version !== 1 || body.requestId !== requestId) return invalid();
    if (event === 'changed') {
      if (!revision(body.revision) || id !== body.revision) return invalid();
      return {type: 'changed', version: 1, requestId, revision: body.revision};
    }
    if (body.revision !== undefined && !revision(body.revision)) return invalid();
    return {type: event as 'expired' | 'invalidated' | 'unavailable', version: 1, requestId,
      ...(body.revision !== undefined ? {revision: body.revision} : {})};
  }
  for await (const chunk of chunks) {
    pending += typeof chunk === 'string' ? chunk : decoder.decode(chunk, {stream: true});
    let end: number;
    while ((end = pending.indexOf('\n')) !== -1) {
      let line = pending.slice(0, end);pending = pending.slice(end + 1);
      bytes += new TextEncoder().encode(line).byteLength + 1;
      if (bytes > frameLimit) invalid();
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (!line) {
        const value = frame(); event = ''; id = ''; data = []; bytes = 0;
        if (value) yield value;
      } else if (!line.startsWith(':')) {
        const colon = line.indexOf(':'); const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? '' : line.slice(colon + 1).replace(/^ /, '');
        if (field === 'event') {if (event) invalid();event = value;}
        else if (field === 'id') {if (id) invalid();id = value;}
        else if (field === 'data') data.push(value);
        else invalid();
      }
    }
    if (bytes + new TextEncoder().encode(pending).byteLength > frameLimit) invalid();
  }
  pending += decoder.decode();
  if (pending || event || id || data.length) invalid();
}

export interface MobileStatusObserver<T> {
  openEvents(afterRevision: string | undefined, signal: AbortSignal): AsyncIterable<MobileWaitEvent>;
  readStatus(signal: AbortSignal): Promise<T>;
  requestId: string;
  /** Absolute milliseconds, bounded by the original attempt deadline. */
  expiresAt: number;
  signal: AbortSignal;
  /** Retain this acknowledged cursor across an explicit pause/retry. */
  afterRevision?: string;
  onRevision?(revision: string): void;
}

/** Subscribe before read. Only real hints cause reads; disconnection never discovers state. */
export async function* observeMobileStatus<T>(input: MobileStatusObserver<T>): AsyncGenerator<T> {
  if (input.afterRevision !== undefined && !revision(input.afterRevision)) invalid();
  const controller = new AbortController();
  const cancel = (): void => {controller.abort(input.signal.reason);};
  input.signal.addEventListener('abort', cancel, {once: true});
  if (input.signal.aborted) cancel();
  const timer = setTimeout(() => {controller.abort(new Error('MOBILE_AUTH_EVENTS_EXPIRED'));}, Math.max(0, input.expiresAt - Date.now()));
  let acknowledged = input.afterRevision, queued: string | undefined;
  const state: {ended: boolean; failure?: Error} = {ended:false};
  let wake: (() => void) | undefined;
  const notify = (): void => {wake?.();};
  controller.signal.addEventListener('abort', notify);
  const pump = (async (): Promise<void> => {
    try {
      for await (const event of input.openEvents(acknowledged, controller.signal)) {
        controller.signal.throwIfAborted();
        if ((event.version as unknown) !== 1 || event.requestId !== input.requestId) invalid();
        if (event.type !== 'changed') throw new Error(`MOBILE_AUTH_EVENTS_${event.type.toUpperCase()}`);
        if (!revision(event.revision)) invalid();
        if ((acknowledged === undefined || BigInt(event.revision) > BigInt(acknowledged)) &&
            (queued === undefined || BigInt(event.revision) > BigInt(queued))) queued = event.revision;
        notify();
      }
    } catch (error) {state.failure = error instanceof Error ? error : new Error('MOBILE_AUTH_EVENTS_DISCONNECTED');}
    finally {state.ended = true;notify();}
  })();
  try {
    for (;;) {
      controller.signal.throwIfAborted();
      if (queued !== undefined && (acknowledged === undefined || BigInt(queued) > BigInt(acknowledged))) {
        const captured = queued;queued = undefined;
        const status = await input.readStatus(controller.signal);
        controller.signal.throwIfAborted();
        acknowledged = captured; input.onRevision?.(captured);
        yield status;
        continue;
      }
      if (state.ended) throw state.failure ?? new Error('MOBILE_AUTH_EVENTS_DISCONNECTED');
      await new Promise<void>(resolve => {wake = resolve;});
      wake = undefined;
    }
  } finally {
    clearTimeout(timer);controller.abort();input.signal.removeEventListener('abort', cancel);
    controller.signal.removeEventListener('abort', notify);
    // Adapters must honor abort; do not hold a completed owner hostage to a broken iterator.
    void pump;
  }
}

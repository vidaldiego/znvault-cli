import QRCode from 'qrcode';
import {qrLogin, type QrLoginPeer, type QrLoginResult} from './qr-login.js';
import {recoverCliLogin} from './cli-recovery.js';

class QrTerminalError extends Error {}

/** Encode with the standard library; half-block cells preserve a four-module white quiet zone. */
export function renderTerminalQr(locator: string, columns: number, rows?: number, preamble: readonly string[] = []): string {
  const {modules} = QRCode.create(locator, {errorCorrectionLevel: 'M'});
  const margin = 4, width = modules.size + margin * 2, height = Math.ceil(width / 2);
  if (!Number.isSafeInteger(columns) || columns < width) {
    throw new QrTerminalError('Enlarge the terminal to at least ' + width.toString() + ' columns to scan the QR.');
  }
  const reservedRows = preamble.reduce((total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / columns)), 1);
  if (rows !== undefined && rows < height + reservedRows) {
    throw new QrTerminalError('Enlarge the terminal to at least ' + (height + reservedRows).toString() + ' rows to scan the QR.');
  }
  const dark = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < modules.size && y < modules.size &&
    modules.data[y * modules.size + x] === 1;
  const lines: string[] = [], palette = [' ', '▄', '▀', '█'];
  for (let y = -margin; y < modules.size + margin; y += 2) {
    let line = '\x1b[47m\x1b[30m';
    for (let x = -margin; x < modules.size + margin; x++) {
      line += palette[Number(dark(x, y)) * 2 + Number(dark(x, y + 1))];
    }
    lines.push(line + '\x1b[0m');
  }
  return (preamble.length ? preamble.join('\n') + '\n' : '') + lines.join('\n') + '\n';
}

export async function terminalQrLogin(peer: QrLoginPeer, options?: {rememberIphone?: boolean}): Promise<QrLoginResult> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return {success: false, error: 'QR sign-in requires an interactive terminal. For SSH, allocate a terminal with ssh -t.'};
  }
  const controller = new AbortController();
  const cancel = (): void => {controller.abort();};
  let presentationError: string | undefined;
  process.on('SIGINT', cancel);
  try {
    const result = await qrLogin(peer, {signal: controller.signal, ...(options?.rememberIphone ? {rememberIphone: true} : {}), onPending: view => {
      try {
        const preamble = ['Sign in to ' + view.origin,
          'ZnVault Authenticator → Scan QR → choose account → approve with biometrics.',
          'Expires in ' + Math.max(0, Math.floor(view.expiresAt - Date.now() / 1000)).toString() + ' seconds. Ctrl+C cancels.',
          'The session will be stored on the computer running this CLI.',
          ...(options?.rememberIphone ? ['Remember this CLI for 30 days with this same iPhone. Recovery never extends that deadline.'] : [])];
        const qr = renderTerminalQr(view.locator, process.stdout.columns, process.stdout.rows, preamble);
        if (controller.signal.aborted) return;
        process.stdout.write(qr);
      } catch (error) {
        presentationError = error instanceof QrTerminalError ? error.message : 'Unable to display the sign-in QR.';
        throw error;
      }
    }});
    return presentationError ? {success: false, error: presentationError} : result;
  } finally {
    process.removeListener('SIGINT', cancel);
  }
}

export async function terminalCliRecovery(peer: QrLoginPeer, signal?: AbortSignal): Promise<QrLoginResult> {
  const controller = new AbortController(), cancel = (): void => {controller.abort();};
  process.on('SIGINT', cancel);
  process.stderr.on('error', cancel);
  process.on('SIGTERM', cancel);signal?.addEventListener('abort', cancel, {once: true});
  if (signal?.aborted) cancel();
  try {
    return await recoverCliLogin(peer, {signal: controller.signal, onPending: async view => {
      await new Promise<void>((resolve, reject) => {process.stderr.write(`Recover CLI session on ${view.origin}\nChoose ${view.comparisonNumber} on your original iPhone and confirm with biometrics.\n` +
        'Open ZnVault Authenticator and refresh requests if no notification arrives.\n' +
        'Unseal and User-Sealed approvals remain separate.\n' +
        `Expires in ${Math.max(0, view.expiresAtSec-Math.floor(Date.now()/1000)).toString()} seconds. Ctrl+C cancels.\n`, error => {if (error) {cancel();reject(error);} else resolve();});});
    }});
  } finally {process.stderr.removeListener('error', cancel);process.removeListener('SIGINT', cancel);process.removeListener('SIGTERM', cancel);signal?.removeEventListener('abort', cancel);}
}

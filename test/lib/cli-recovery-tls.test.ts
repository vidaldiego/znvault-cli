import https from 'node:https';
import {execFileSync} from 'node:child_process';
import {createHash, randomBytes, randomUUID, X509Certificate} from 'node:crypto';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll, afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import {client} from '../../src/lib/client.js';
import {store, setRuntimeProfile, getProfile, invalidateAllProfileCaches} from '../../src/lib/config.js';
import {retireStoredCliRecovery} from '../../src/lib/cli-recovery.js';
let directory: string, certificate: Buffer, privateKey: Buffer, pin: string;
const oldCa = https.globalAgent.options.ca;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(),'znvault-recovery-tls-'));
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-subj','/CN=localhost',
    '-addext','subjectAltName=DNS:localhost,IP:127.0.0.1','-keyout',join(directory,'key.pem'),'-out',join(directory,'cert.pem')],{stdio:'pipe'});
  certificate=readFileSync(join(directory,'cert.pem'));privateKey=readFileSync(join(directory,'key.pem'));
  pin=createHash('sha256').update(new X509Certificate(certificate).publicKey.export({type:'spki',format:'der'})).digest('hex');
});
afterAll(() => {rmSync(directory,{recursive:true,force:true});});
afterEach(() => {https.globalAgent.options.ca=oldCa;vi.restoreAllMocks();setRuntimeProfile(null);invalidateAllProfileCaches();});
describe('retirement uses the real HTTPS SPKI guard', () => {
  it.each([false,true])('honors a pin despite stored insecure=true (mismatch=%s)', async mismatch => {
    let received=0;
    const server=https.createServer({key:privateKey,cert:certificate},(request,response) => {
      received++;
      request.resume();response.setHeader('Connection','close');response.writeHead(200,{'Content-Type':'application/json'});response.end('{"revoked":true}');
    });
    server.on('tlsClientError',() => {});
    await new Promise<void>(resolve => {server.listen(0,'127.0.0.1',resolve);});
    try {
      const port=(server.address() as import('node:net').AddressInfo).port, origin=`https://127.0.0.1:${port}`;
      https.globalAgent.options.ca=certificate;
      setRuntimeProfile('pinned');
      store.set('profiles',{pinned:{url:origin,insecure:true,timeout:1000,authGeneration:randomUUID(),
        cliRecovery:{state:'active',grantId:randomUUID(),credential:randomBytes(32).toString('base64url'),origin,
          installationId:randomUUID(),expiresAtSec:Math.floor(Date.now()/1000)+2592000}}});invalidateAllProfileCaches();
      vi.spyOn(client,'getTlsSpkiSha256').mockReturnValue(mismatch?'0'.repeat(64):pin);
      if(mismatch) {
        await expect(retireStoredCliRecovery('pinned')).rejects.toThrow(/pending/i);
        expect(received).toBe(0);expect(getProfile('pinned')?.cliRecovery?.state).toBe('revocation_pending');
      } else {
        await retireStoredCliRecovery('pinned');expect(received).toBe(1);expect(getProfile('pinned')?.cliRecovery).toBeUndefined();
      }
    } finally {await new Promise<void>(resolve => {server.close(() => {resolve();});});}
  });
});

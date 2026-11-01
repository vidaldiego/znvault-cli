import { describe, expect, it, vi } from 'vitest';
vi.mock('../src/lib/local.js', () => ({ getLocalConfig: () => ({ databaseUrl:'postgres://synthetic@127.0.0.1:1/unused',databaseSsl:false }) }));
import { AuditOperations } from '../src/lib/db/audit.js';
describe('local audit verification', () => {
  it('does not certify a row count or contact a database without HMAC verification', async () => {
    const client = new AuditOperations();
    const connect=vi.spyOn(client,'connect').mockRejectedValue(new Error('must not access database'));
    expect(await client.verifyAuditChain()).toMatchObject({ valid:false,status:'unverifiable',checkedEntries:0,authenticatedEntries:0,completed:false });
    expect(connect).not.toHaveBeenCalled();
  });
});

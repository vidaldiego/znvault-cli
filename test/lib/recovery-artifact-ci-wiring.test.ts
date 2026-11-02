import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
it('requires OS-isolated exact artifact recovery on Linux and macOS for PRs and publishing', () => {
 const ci=parse(readFileSync('.github/workflows/ci.yml','utf8'));
 const job=ci.jobs['recovery-artifact'];
 expect(ci.on.pull_request).toBeDefined();expect(job.if).toBeUndefined();expect(job['continue-on-error']).toBeUndefined();
 expect(job.strategy.matrix.os.some((s:string)=>s.startsWith('macos'))).toBe(true);
 expect(job.strategy.matrix.os.some((s:string)=>s.startsWith('ubuntu'))).toBe(true);
 const gate=job.steps.find((s:any)=>s.run?.includes('verify-recovery-package.mjs'));expect(gate).toBeDefined();expect(gate.if).toBeUndefined();
 expect(job.steps.every((s:any)=>!s['continue-on-error'])).toBe(true);
 const publish=parse(readFileSync('.github/workflows/publish.yml','utf8'));
 expect(publish.jobs.publish.needs).toBe('validate');
 expect(publish.jobs.publish.steps.some((s:any)=>s.run?.includes('verify-recovery-package.mjs'))).toBe(true);
});

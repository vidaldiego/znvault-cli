// Prepare once and reuse these exact encrypted pre/post sets across artifact/platform checks.
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {prepareFixtures} from './recovery-artifact-fixtures.mjs';
const [root,originals,target]=process.argv.slice(2);
if(![root,originals,target].every(p=>p&&isAbsolute(p)))throw Error('Require absolute built CLI root, original synthetic fixtures and new fixture destination');
mkdirSync(target,{mode:0o700});
const cases=await prepareFixtures(root,originals,target);
copyFileSync(join(originals,'writer-material.json'),join(target,'writer-material.json'));
writeFileSync(join(target,'cases.json'),JSON.stringify(cases.map(c=>c.name)));
console.log(JSON.stringify({ciphertext:cases.map(c=>c.ciphertext)}));

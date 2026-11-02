/** Raw argv contains arguments only (without Node/script). Never inspect tokens
 * after --, or mistake a global option's value for the command name. All recovery
 * commands currently fail closed offline; assisted routing belongs to its adapter. */
export function selectRecoveryBootstrap(argv: readonly string[]): 'offline-recovery' | 'normal' {
  const valued = new Set(['--profile', '--url', '--tls-spki-sha256']);
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--') return 'normal';
    if (valued.has(arg)) { index++; continue; }
    if (arg.startsWith('-')) continue;
    return arg === 'recovery' ? 'offline-recovery' : 'normal';
  }
  return 'normal';
}

/** Pure admission before any profile/client import. Commander does final syntax. */
export function selectAssistedRecovery(argv:readonly string[]):boolean {
 const values=new Map<string,string[]>();
 const valued=new Set(['--profile','--key-source','--backup','--expect','--key-file','--url','--tls-spki-sha256','--input','--companion-input','--manifest','--reference','--output','--s3-config','--max-input-bytes','--max-expanded-bytes','--max-expansion-ratio']);
 for(let i=0;i<argv.length;i++){
  const arg=argv[i];if(arg==='--')break;if(!arg.startsWith('--'))continue;
  const name=arg.split('=')[0];let value=arg.includes('=')?arg.slice(arg.indexOf('=')+1):'';
  if(valued.has(name)&&!arg.includes('=')){value=argv[++i]??'';if(!value||value.startsWith('-'))throw Error('recovery_options_incompatible');}
  values.set(name,[...(values.get(name)??[]),value]);
 }
 const has=(name:string):boolean=>values.has(name);
 if(has('--key-file')){
  if(['--profile','--key-source','--backup','--url','--insecure','--local','--tls-spki-sha256'].some(has))throw Error('recovery_options_incompatible');
  return false;
 }
 if(!has('--profile')&&!has('--key-source')&&!has('--backup'))return false;
 if(!has('--profile')||values.get('--profile')?.length!==1||['--url','--insecure','--local'].some(has))throw Error('recovery_options_incompatible');
 for(const name of ['--expect','--backup','--key-source','--tls-spki-sha256'])if((values.get(name)?.length??0)>1)throw Error('recovery_options_incompatible');
 if(values.get('--key-source')?.[0]!=='vault'&&has('--key-source'))throw Error('recovery_options_incompatible');
 if(has('--expect')&&has('--backup'))throw Error('recovery_options_incompatible');
 return true;
}

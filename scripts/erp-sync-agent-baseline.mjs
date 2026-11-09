import { readFileSync, writeFileSync } from 'node:fs';
const migration='20261109001000_0410_erp_agent_analysis.sql';
const start='-- ERP FORK 0410 BEGIN\n',end='-- ERP FORK 0410 END\n';
let baseline=readFileSync('supabase/baseline.sql','utf8').replace(/\r\n/g,'\n');
while(baseline.includes(start)) {
 if(baseline.indexOf(end)<baseline.indexOf(start))throw new Error('Invalid 0410 marker boundaries');
 baseline=baseline.slice(0,baseline.indexOf(start))+baseline.slice(baseline.indexOf(end)+end.length);
}
const marker='-- ---- VARREDURA anon: fecha os apêndices posteriores à migration 0116 ----';
if(!baseline.includes(marker))throw new Error('Final hardening marker missing');
baseline=baseline.replace(marker,start+readFileSync(`supabase/migrations/${migration}`,'utf8').replace(/\r\n/g,'\n')+'\n'+end+'\n'+marker);
writeFileSync('supabase/baseline.sql',baseline);
const manifestPath='supabase/migrations/MANIFEST.md';
let manifest=readFileSync(manifestPath,'utf8');
if(!manifest.includes('0410_erp_agent_analysis'))manifest+='\n| `20261109001000` | `0410_erp_agent_analysis` | ERP fork: persisted read-only analyses, human-confirmed scoped Memory with TTL/revocation, allowlisted method reuse; deny browser table access and minimize service-role ACL. |\n';
writeFileSync(manifestPath,manifest);
console.info('0410 synchronized before final hardening scan');

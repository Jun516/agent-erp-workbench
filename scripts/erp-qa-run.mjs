import { spawn } from 'node:child_process';
process.loadEnvFile('.env.erp-qa');
const args=process.argv.slice(2);
if(!args.length)throw new Error('Usage: node scripts/erp-qa-run.mjs <node program> [args...]');
const child=spawn(process.execPath,args,{stdio:'inherit',env:process.env});
child.on('exit',(code)=>process.exit(code??1));

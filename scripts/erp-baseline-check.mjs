import pg from 'pg';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
// Fixed disposable harness connection, never the installed application database.
const connectionString='postgresql://postgres:erp-qa-local@127.0.0.1:55270/postgres';
const root=new pg.Pool({connectionString,max:1});
const database='erp_final_install_'+Date.now();
let target;
try {
 await root.query(`create database ${database}`);
 const targetUrl=new URL(connectionString);targetUrl.pathname='/'+database;
 target=new pg.Pool({connectionString:targetUrl.toString(),max:1});
 const script=readFileSync('scripts/test-db.sh','utf8');
 const prelude=script.split("psql_install <<'SQL'")[2].split('\nSQL\n')[0];
 if(!prelude.includes('function auth.uid()'))throw new Error('Canonical prelude not found');
 await target.query(prelude);
 const baseline=readFileSync('supabase/baseline.sql','utf8');
 await target.query(baseline);console.info('PASS final baseline fresh install');
 await target.query(baseline);console.info('PASS final baseline idempotent update');
 const rows=await target.query("select count(*)::int as count from pg_tables where schemaname='public' and tablename like 'erp_%'");
 mkdirSync('docs/erp/qa',{recursive:true});
 writeFileSync('docs/erp/qa/baseline-results.json',JSON.stringify({executed_at:new Date().toISOString(),fresh_install:true,idempotent_update:true,erp_tables:rows.rows[0].count,baseline_sha256:createHash('sha256').update(baseline).digest('hex'),supabase_prerequisites:'canonical scripts/test-db.sh prelude; Auth/Storage schemas stubbed for schema-only check'},null,2));
} finally {
 if(target)await target.end();
 await root.query(`drop database if exists ${database}`);
 await root.end();
}

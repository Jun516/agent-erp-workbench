import pg from 'pg';
import { readFileSync } from 'node:fs';
// Node entry point for Windows/macOS/Linux. No shell, no reset, no user secrets printed.
const connectionString=process.env.SUPABASE_DB_ADMIN_URL || process.env.SUPABASE_DB_URL;
if(!connectionString)throw new Error('Set SUPABASE_DB_URL (or DDL-only SUPABASE_DB_ADMIN_URL) before migration.');
const pool=new pg.Pool({connectionString,max:1});
try {
 await pool.query('create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;');
 // Playbook self-check hashes are defined on LF SQL bodies (also enforced by .gitattributes).
 const baseline=readFileSync(new URL('../supabase/baseline.sql',import.meta.url),'utf8').replace(/\r\n/g,'\n');
 await pool.query(baseline);
 console.info('ERP baseline applied. No reset or business-data deletion performed.');
} catch(error) {
 console.error('ERP migration failed:',error instanceof Error?error.message:'unknown database failure');
 process.exitCode=1;
} finally {await pool.end();}

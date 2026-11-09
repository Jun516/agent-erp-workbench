import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';

// This harness never reads application .env files and only connects to its own stack.
const raw = execFileSync('cmd.exe', ['/d','/c','npx --yes supabase status --workdir qa/local-stack -o json'], { encoding:'utf8', stdio:['ignore','pipe','pipe'] });
const vars = JSON.parse(raw.slice(raw.indexOf('{')));
if (vars.API_URL !== 'http://127.0.0.1:55421' || !vars.DB_URL.includes('@127.0.0.1:55422/')) throw new Error('Refusing non-QA Supabase');
const pool = new pg.Pool({ connectionString:vars.DB_URL, max:2 });
try {
  await pool.query('create schema if not exists extensions; create extension if not exists "uuid-ossp" with schema extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists vector with schema public; create extension if not exists citext with schema public; create extension if not exists pg_trgm with schema public;');
  // Storage is disabled in this ERP-only stack. Mirror the canonical test-db
  // storage schema prerequisites; Auth and PostgREST remain real services.
  execFileSync('docker',['exec','-i','supabase_db_agent-erp-qa-20261109','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-q','-f','-'],{input:`create schema if not exists storage;
    create table if not exists storage.buckets(id text primary key,name text not null,public boolean not null default false,file_size_limit bigint,allowed_mime_types text[],created_at timestamptz not null default now());
    create table if not exists storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,metadata jsonb,created_at timestamptz not null default now());
    alter table storage.buckets owner to postgres; alter table storage.objects owner to postgres;
    grant usage,create on schema storage to postgres;`,stdio:['pipe','pipe','pipe']});
  await pool.query(readFileSync('supabase/baseline.sql','utf8'));
  console.info('Real Supabase baseline applied');
  const admin = createClient(vars.API_URL, vars.SERVICE_ROLE_KEY, {auth:{persistSession:false}});
  const email = 'erp-qa-admin@example.invalid';
  const password = 'ErpQaOnly!20261109';
  let { data, error } = await admin.auth.admin.createUser({email,password,email_confirm:true});
  if (error) {
    const list = await admin.auth.admin.listUsers();
    const found = list.data.users.find(user=>user.email===email);
    if (!found) throw error;
    data = { user: found };
  }
  const actor = data.user.id;
  const org = '81111111-1111-4111-8111-111111111111';
  await pool.query("insert into public.organizations(id,display_name,legal_name,slug,onboarded_at,status) values($1,'ERP QA 测试组织','ERP QA 测试组织','erp-qa-20261109',now(),'active') on conflict(id) do update set onboarded_at=now()",[org]);
  await pool.query("insert into public.user_organizations(organization_id,user_id,role,accepted_at) values($1,$2,'admin',now()) on conflict(organization_id,user_id) do update set revoked_at=null,role='admin'",[org,actor]);
  const key = ()=>randomBytes(32).toString('base64');
  const env = { NEXT_PUBLIC_SUPABASE_URL:vars.API_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY:vars.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY:vars.SERVICE_ROLE_KEY, SUPABASE_DB_URL:vars.DB_URL,
    NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3015', CRM_DEMO_MODE:'false', INTERNAL_SECRET:randomBytes(32).toString('hex'),
    INTERNAL_CRON_SECRET:randomBytes(32).toString('hex'), CPF_ENCRYPTION_KEY:key(),WAHA_BYO_ENCRYPTION_KEY:key(),AI_CRED_AES_KEY:key(),
    DB_POOL_MAX:'3', NEXT_TELEMETRY_DISABLED:'1', ERP_QA_EMAIL:email, ERP_QA_PASSWORD:password, ERP_QA_ORG:org,ERP_QA_ACTOR:actor };
  writeFileSync('.env.erp-qa',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n');
  mkdirSync('qa/results',{recursive:true});
  writeFileSync('qa/results/local-stack.json',JSON.stringify({organization:org,actor,url:'http://127.0.0.1:3015',test_only:true},null,2));
  console.info('QA admin and organization prepared; environment written to ignored .env.erp-qa');
} finally { await pool.end(); }

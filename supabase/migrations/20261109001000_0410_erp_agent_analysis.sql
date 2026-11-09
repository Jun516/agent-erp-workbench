-- ERP fork: scoped read-only analyses, confirmed Memory and allowlisted method reuse.
create table if not exists public.erp_agent_runs (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 actor_id uuid not null references auth.users(id), order_id uuid not null,
 mode text not null check(mode in ('rules','model')), status text not null check(status in ('completed','failed')),
 final_text text not null, result jsonb not null, refinement jsonb not null,
 evaluation jsonb, memory_ids uuid[] not null default '{}', error_code text,
 policy_revision text not null, created_at timestamptz not null default now(),
 unique(organization_id,id),
 foreign key(organization_id,order_id) references public.erp_documents(organization_id,id)
);
create index if not exists erp_agent_runs_recent_idx on public.erp_agent_runs(organization_id,created_at desc);
create table if not exists public.erp_agent_memories (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 scope_type text not null check(scope_type in ('product','warehouse','supplier')), scope_id uuid not null,
 content text not null check(length(content) between 4 and 1200), confirmed_by uuid not null references auth.users(id),
 expires_at timestamptz not null, revoked_at timestamptz, revoked_by uuid references auth.users(id),
 created_at timestamptz not null default now(), unique(organization_id,id),
 check(expires_at > created_at and expires_at <= created_at + interval '366 days')
);
create index if not exists erp_agent_memories_scope_idx on public.erp_agent_memories(organization_id,scope_type,scope_id) where revoked_at is null;
create table if not exists public.erp_agent_methods (
 organization_id uuid not null references public.organizations(id), warehouse_id uuid not null,
 method text not null check(method in ('availability_first','purchase_pipeline_check','deadline_gap_check')),
 source_run_id uuid not null, policy_revision text not null, expires_at timestamptz not null,
 primary key(organization_id,warehouse_id),
 foreign key(organization_id,warehouse_id) references public.erp_warehouses(organization_id,id),
 foreign key(organization_id,source_run_id) references public.erp_agent_runs(organization_id,id)
);
alter table public.erp_agent_runs enable row level security;
alter table public.erp_agent_memories enable row level security;
alter table public.erp_agent_methods enable row level security;
-- Server-only: no direct authenticated or anon projection (current warehouse grants required).
revoke all on public.erp_agent_runs, public.erp_agent_memories, public.erp_agent_methods from public,anon,authenticated,service_role;
grant select,insert,update on public.erp_agent_runs, public.erp_agent_memories, public.erp_agent_methods to service_role;

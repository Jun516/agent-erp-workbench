-- ERP fork core: the local database is the business ledger. No external HTTP.
-- All writes go through one atomic command, never through PostgREST table CRUD.
create table if not exists public.erp_companies (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null check(length(btrim(name)) between 1 and 160), currency text not null check(currency in ('CNY','USD','EUR','BRL')),
 allow_self_approval boolean not null default false, approval_limit_cents bigint not null default 10000000 check(approval_limit_cents between 0 and 1000000000),
 version integer not null default 1, unique(organization_id,id), unique(organization_id,name)
);
create table if not exists public.erp_warehouses (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 company_id uuid not null, name text not null check(length(btrim(name)) between 1 and 160),
 foreign key(organization_id,company_id) references public.erp_companies(organization_id,id),
 unique(organization_id,id), unique(organization_id,company_id,id), unique(organization_id,company_id,name)
);
create table if not exists public.erp_suppliers (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 company_id uuid not null, name text not null check(length(btrim(name)) between 1 and 160), lead_time_days integer not null default 7 check(lead_time_days between 0 and 365),
 foreign key(organization_id,company_id) references public.erp_companies(organization_id,id),
 unique(organization_id,id), unique(organization_id,company_id,id), unique(organization_id,company_id,name)
);
create table if not exists public.erp_products (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 company_id uuid not null, sku text not null check(length(btrim(sku)) between 1 and 160), name text not null check(length(btrim(name)) between 1 and 160),
 unit text not null default '件' check(length(btrim(unit)) between 1 and 20),
 foreign key(organization_id,company_id) references public.erp_companies(organization_id,id),
 unique(organization_id,id), unique(organization_id,company_id,id), unique(organization_id,company_id,sku)
);
create table if not exists public.erp_access (
 organization_id uuid not null references public.organizations(id) on delete cascade, warehouse_id uuid not null,
 user_id uuid not null references auth.users(id), can_purchase boolean not null default false, can_receive boolean not null default false, can_ship boolean not null default false,
 primary key(organization_id,warehouse_id,user_id), foreign key(organization_id,warehouse_id) references public.erp_warehouses(organization_id,id)
);
create table if not exists public.erp_balances (
 organization_id uuid not null references public.organizations(id) on delete cascade, company_id uuid not null, warehouse_id uuid not null, product_id uuid not null,
 on_hand integer not null default 0 check(on_hand>=0), reserved integer not null default 0 check(reserved>=0 and reserved<=on_hand),
 available integer generated always as (on_hand-reserved) stored, version integer not null default 1,
 primary key(organization_id,warehouse_id,product_id),
 foreign key(organization_id,company_id,warehouse_id) references public.erp_warehouses(organization_id,company_id,id),
 foreign key(organization_id,company_id,product_id) references public.erp_products(organization_id,company_id,id)
);
create table if not exists public.erp_documents (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 company_id uuid not null, warehouse_id uuid not null, kind text not null check(kind in ('sale','purchase')),
 number text not null, status text not null check(status in ('draft','pending','approved','open','partial','completed','cancelled')),
 supplier_id uuid, customer_name text, sales_order_id uuid, source_sales_version integer, currency text not null,
 total_cents bigint not null default 0 check(total_cents>=0), version integer not null default 1,
 created_by uuid not null references auth.users(id), approved_by uuid references auth.users(id), due_at timestamptz, created_at timestamptz not null default now(),
 foreign key(organization_id,company_id,warehouse_id) references public.erp_warehouses(organization_id,company_id,id),
 foreign key(organization_id,company_id,supplier_id) references public.erp_suppliers(organization_id,company_id,id),
 foreign key(organization_id,sales_order_id) references public.erp_documents(organization_id,id),
 unique(organization_id,id), unique(organization_id,number),
 check((kind='purchase' and supplier_id is not null and customer_name is null) or (kind='sale' and supplier_id is null and customer_name is not null and length(btrim(customer_name)) between 1 and 160))
);
create table if not exists public.erp_lines (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 document_id uuid not null, product_id uuid not null, quantity integer not null check(quantity between 1 and 1000000),
 processed integer not null default 0 check(processed>=0 and processed<=quantity), reserved integer not null default 0 check(reserved>=0 and reserved<=quantity-processed),
 returned integer not null default 0 check(returned>=0 and returned<=processed), unit_price_cents bigint not null check(unit_price_cents between 0 and 1000000000),
 stock_version integer not null default 0,
 foreign key(organization_id,document_id) references public.erp_documents(organization_id,id), foreign key(organization_id,product_id) references public.erp_products(organization_id,id),
 unique(organization_id,id), unique(organization_id,document_id,product_id), unique(organization_id,document_id,id)
);
create table if not exists public.erp_reservations (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 warehouse_id uuid not null, product_id uuid not null, document_id uuid not null, line_id uuid not null, quantity integer not null check(quantity>0),
 foreign key(organization_id,warehouse_id) references public.erp_warehouses(organization_id,id), foreign key(organization_id,product_id) references public.erp_products(organization_id,id),
 foreign key(organization_id,document_id,line_id) references public.erp_lines(organization_id,document_id,id), unique(organization_id,line_id)
);
create table if not exists public.erp_ledger (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 warehouse_id uuid not null, product_id uuid not null, document_id uuid, line_id uuid, operation_id uuid not null,
 kind text not null, quantity_delta integer not null, reserved_delta integer not null, reason text not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,warehouse_id) references public.erp_warehouses(organization_id,id), foreign key(organization_id,product_id) references public.erp_products(organization_id,id),
 foreign key(organization_id,document_id,line_id) references public.erp_lines(organization_id,document_id,id)
);
create table if not exists public.erp_settlements (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 document_id uuid not null, direction text not null check(direction in ('receivable','payable')),
 amount_cents bigint not null default 0 check(amount_cents>=0), settled_cents bigint not null default 0 check(settled_cents>=0 and settled_cents<=amount_cents), currency text not null, version integer not null default 1,
 foreign key(organization_id,document_id) references public.erp_documents(organization_id,id), unique(organization_id,document_id), unique(organization_id,id)
);
create table if not exists public.erp_settlement_entries (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 settlement_id uuid not null, amount_cents bigint not null check(amount_cents>0), reference text not null check(length(btrim(reference)) between 1 and 160),
 operation_id uuid not null, actor_id uuid not null references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,settlement_id) references public.erp_settlements(organization_id,id), unique(organization_id,operation_id)
);
create table if not exists public.erp_audit (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id) on delete cascade,
 actor_id uuid not null references auth.users(id), action text not null, resource_id uuid, details jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create table if not exists public.erp_command_receipts (
 organization_id uuid not null references public.organizations(id) on delete cascade, idempotency_key uuid not null, actor_id uuid not null references auth.users(id),
 command jsonb not null, result jsonb not null, created_at timestamptz not null default now(), primary key(organization_id,idempotency_key)
);
create index if not exists erp_documents_org_warehouse on public.erp_documents(organization_id,warehouse_id,created_at desc);
create index if not exists erp_ledger_org_warehouse on public.erp_ledger(organization_id,warehouse_id,created_at desc);
create index if not exists erp_audit_org_time on public.erp_audit(organization_id,created_at desc);

-- Deny direct REST access, including Supabase's permissive default ACL.
do $secure$
declare t text;
begin
 foreach t in array array['erp_companies','erp_warehouses','erp_suppliers','erp_products','erp_access','erp_balances','erp_documents','erp_lines','erp_reservations','erp_ledger','erp_settlements','erp_settlement_entries','erp_audit','erp_command_receipts'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select on public.%I to service_role',t);
 end loop;
end $secure$;

create or replace function public.fn_erp_assert_actor(p_org uuid,p_actor uuid,p_write boolean default false)
returns text language plpgsql stable security definer set search_path=public,pg_temp as $f$
declare r text;
begin
 select u.role into r from public.user_organizations u join public.organizations o on o.id=u.organization_id
 where u.organization_id=p_org and u.user_id=p_actor and u.revoked_at is null and o.status='active';
 if r is null or (p_write and r='viewer') then raise exception 'erp_forbidden' using errcode='42501'; end if;
 return r;
end $f$;
create or replace function public.fn_erp_assert_warehouse(p_org uuid,p_actor uuid,p_warehouse uuid,p_capability text)
returns uuid language plpgsql stable security definer set search_path=public,pg_temp as $f$
declare r text; c uuid;
begin
 r:=public.fn_erp_assert_actor(p_org,p_actor,true);
 select company_id into c from public.erp_warehouses where organization_id=p_org and id=p_warehouse;
 if c is null then raise exception 'erp_not_found'; end if;
 if r not in ('admin','manager') and not exists(select 1 from public.erp_access a where a.organization_id=p_org and a.warehouse_id=p_warehouse and a.user_id=p_actor
 and case p_capability when 'purchase' then a.can_purchase when 'receive' then a.can_receive when 'ship' then a.can_ship else false end) then
  raise exception 'erp_warehouse_forbidden' using errcode='42501';
 end if;
 return c;
end $f$;

-- Internal primitive; callers must hold the organization transaction lock.
create or replace function public.fn_erp_move(p_org uuid,p_actor uuid,p_warehouse uuid,p_product uuid,p_quantity integer,p_reserved integer,p_operation uuid,p_kind text,p_reason text,p_document uuid default null,p_line uuid default null)
returns void language plpgsql security definer set search_path=public,pg_temp as $f$
declare c uuid; b public.erp_balances;
begin
 select company_id into c from public.erp_warehouses where organization_id=p_org and id=p_warehouse;
 if c is null or not exists(select 1 from public.erp_products where organization_id=p_org and company_id=c and id=p_product) then raise exception 'erp_company_mismatch'; end if;
 insert into public.erp_balances(organization_id,company_id,warehouse_id,product_id) values(p_org,c,p_warehouse,p_product) on conflict do nothing;
 select * into b from public.erp_balances where organization_id=p_org and warehouse_id=p_warehouse and product_id=p_product for update;
 if b.on_hand+p_quantity<0 or b.reserved+p_reserved<0 or b.on_hand+p_quantity<b.reserved+p_reserved then raise exception 'erp_insufficient_stock'; end if;
 update public.erp_balances set on_hand=on_hand+p_quantity,reserved=reserved+p_reserved,version=version+1 where organization_id=p_org and warehouse_id=p_warehouse and product_id=p_product;
 insert into public.erp_ledger(organization_id,warehouse_id,product_id,document_id,line_id,operation_id,kind,quantity_delta,reserved_delta,reason,actor_id)
 values(p_org,p_warehouse,p_product,p_document,p_line,p_operation,p_kind,p_quantity,p_reserved,p_reason,p_actor);
end $f$;

create or replace function public.fn_erp_snapshot(p_org uuid,p_actor uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $f$
declare r text; ws uuid[];
begin
 r:=public.fn_erp_assert_actor(p_org,p_actor,false);
 select coalesce(array_agg(w.id),'{}'::uuid[]) into ws from public.erp_warehouses w where w.organization_id=p_org and
 (r in ('manager','admin') or exists(select 1 from public.erp_access a where a.organization_id=p_org and a.warehouse_id=w.id and a.user_id=p_actor));
 return jsonb_build_object(
  'actor_role',r,
  'companies',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from public.erp_companies t where organization_id=p_org),
  'warehouses',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from public.erp_warehouses t where organization_id=p_org and id=any(ws)),
  'suppliers',(select coalesce(jsonb_agg(to_jsonb(t) order by name),'[]') from public.erp_suppliers t where organization_id=p_org),
  'products',(select coalesce(jsonb_agg(to_jsonb(t) order by sku),'[]') from public.erp_products t where organization_id=p_org),
  'balances',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.erp_balances t where organization_id=p_org and warehouse_id=any(ws)),
  'documents',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from public.erp_documents t where organization_id=p_org and warehouse_id=any(ws)),
  'lines',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.erp_lines t where organization_id=p_org and exists(select 1 from public.erp_documents d where d.organization_id=p_org and d.id=t.document_id and d.warehouse_id=any(ws))),
  'reservations',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.erp_reservations t where organization_id=p_org and warehouse_id=any(ws)),
  'ledger',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from public.erp_ledger t where organization_id=p_org and warehouse_id=any(ws)),
  'settlements',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.erp_settlements t where organization_id=p_org and exists(select 1 from public.erp_documents d where d.organization_id=p_org and d.id=t.document_id and d.warehouse_id=any(ws))),
  'audit',(select coalesce(jsonb_agg(to_jsonb(t) order by created_at desc),'[]') from public.erp_audit t where organization_id=p_org and (r in ('manager','admin') or actor_id=p_actor)),
  'access',(select coalesce(jsonb_agg(to_jsonb(t)),'[]') from public.erp_access t where organization_id=p_org and (r in ('manager','admin') or user_id=p_actor))
 );
end $f$;

create or replace function public.fn_erp_assert_replenishment(p_org uuid,p_sales uuid,p_wh uuid,p_product uuid,p_quantity integer,p_exclude uuid default null)
returns void language plpgsql stable security definer set search_path=public,pg_temp as $f$
declare need bigint;
begin
 select sl.quantity-sl.processed-sl.reserved-coalesce(b.available,0)-coalesce((
  select sum(pl.quantity-pl.processed) from public.erp_lines pl join public.erp_documents pd on pd.organization_id=p_org and pd.id=pl.document_id
  where pl.organization_id=p_org and pl.product_id=p_product and pd.kind='purchase' and pd.sales_order_id=p_sales
   and pd.status not in ('cancelled','completed') and (p_exclude is null or pd.id<>p_exclude)
 ),0) into need
 from public.erp_lines sl left join public.erp_balances b on b.organization_id=p_org and b.warehouse_id=p_wh and b.product_id=sl.product_id
 where sl.organization_id=p_org and sl.document_id=p_sales and sl.product_id=p_product;
 if need is null then raise exception 'erp_product_not_in_source'; end if;
 if p_quantity>greatest(need,0) then raise exception 'erp_excess_replenishment'; end if;
end $f$;

create or replace function public.fn_erp_command(p_org uuid,p_actor uuid,p_command jsonb)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $f$
declare
 a text:=p_command->>'action'; k uuid:=(p_command->>'idempotency_key')::uuid; r text; rid uuid; c uuid; w uuid; w2 uuid; pid uuid; sid uuid;
 d public.erp_documents; l public.erp_lines; b public.erp_balances; co public.erp_companies; s public.erp_settlements; receipt public.erp_command_receipts;
 x jsonb; result jsonb; q integer; price bigint; amount bigint; total bigint:=0; sv integer; reason text; cap text; complete boolean;
begin
 r:=public.fn_erp_assert_actor(p_org,p_actor,true);
 if p_command is null or jsonb_typeof(p_command)<>'object' or k is null or a is null then raise exception 'erp_invalid_input'; end if;
 -- One lock covers duplicate requests and all cross-warehouse stock movements.
 -- This intentionally favours correctness for a small self-hosted ERP over throughput.
 perform pg_advisory_xact_lock(hashtextextended('erp:'||p_org::text,0));
 -- Freeze the caller's current membership for this transaction (a concurrent
 -- revocation waits for the already-authorized command to finish).
 perform 1 from public.user_organizations where organization_id=p_org and user_id=p_actor and revoked_at is null for share;
 perform 1 from public.organizations where id=p_org and status='active' for share;
 r:=public.fn_erp_assert_actor(p_org,p_actor,true);
 if a in ('company_create','company_policy','warehouse_create','supplier_create','product_create','access_grant','opening_stock','stock_adjust','settlement_record','purchase_approve') and r not in ('manager','admin') then raise exception 'erp_manager_required' using errcode='42501'; end if;
 select * into receipt from public.erp_command_receipts where organization_id=p_org and idempotency_key=k;
 if found then
  if receipt.actor_id<>p_actor or receipt.command<>p_command then raise exception 'erp_idempotency_conflict'; end if;
  -- A receipt does not preserve authority after warehouse access is revoked.
  if a in ('sale_create','purchase_create','opening_stock','stock_adjust','stock_transfer') then
   w:=(p_command->>'warehouse_id')::uuid;
   perform public.fn_erp_assert_warehouse(p_org,p_actor,w,case when a='sale_create' then 'ship' when a='purchase_create' then 'purchase' else 'receive' end);
   if a='stock_transfer' then
    perform public.fn_erp_assert_warehouse(p_org,p_actor,w,'ship');
    perform public.fn_erp_assert_warehouse(p_org,p_actor,(p_command->>'target_warehouse_id')::uuid,'receive');
   end if;
  elsif a in ('purchase_submit','purchase_approve','purchase_place','purchase_receive','sale_reserve','sale_ship','document_cancel','purchase_return','sale_return') then
   select * into d from public.erp_documents where organization_id=p_org and id=(p_command->>'id')::uuid;
   if not found then raise exception 'erp_not_found'; end if;
   perform public.fn_erp_assert_warehouse(p_org,p_actor,d.warehouse_id,case when a in ('purchase_receive','purchase_return','sale_return') then 'receive' when d.kind='purchase' then 'purchase' else 'ship' end);
  end if;
  return receipt.result||jsonb_build_object('replayed',true);
 end if;
 if a='company_create' then
  insert into public.erp_companies(organization_id,name,currency) values(p_org,btrim(p_command->>'name'),p_command->>'currency') returning id into rid;
 elsif a='company_policy' then
  update public.erp_companies set allow_self_approval=(p_command->>'allow_self_approval')::boolean,approval_limit_cents=(p_command->>'approval_limit_cents')::bigint,version=version+1 where organization_id=p_org and id=(p_command->>'company_id')::uuid returning id into rid;
  if rid is null then raise exception 'erp_not_found'; end if;
 elsif a in ('warehouse_create','supplier_create','product_create') then
  c:=(p_command->>'company_id')::uuid;
  if not exists(select 1 from public.erp_companies where organization_id=p_org and id=c) then raise exception 'erp_not_found'; end if;
  if a='warehouse_create' then insert into public.erp_warehouses(organization_id,company_id,name) values(p_org,c,btrim(p_command->>'name')) returning id into rid;
  elsif a='supplier_create' then insert into public.erp_suppliers(organization_id,company_id,name,lead_time_days) values(p_org,c,btrim(p_command->>'name'),coalesce((p_command->>'lead_time_days')::integer,7)) returning id into rid;
  else insert into public.erp_products(organization_id,company_id,sku,name,unit) values(p_org,c,btrim(p_command->>'sku'),btrim(p_command->>'name'),coalesce(p_command->>'unit','件')) returning id into rid;
  end if;
 elsif a='access_grant' then
  w:=(p_command->>'warehouse_id')::uuid; rid:=(p_command->>'user_id')::uuid;
  perform public.fn_erp_assert_warehouse(p_org,p_actor,w,'receive');
  perform public.fn_erp_assert_actor(p_org,rid,false);
  insert into public.erp_access(organization_id,warehouse_id,user_id,can_purchase,can_receive,can_ship) values(p_org,w,rid,(p_command->>'can_purchase')::boolean,(p_command->>'can_receive')::boolean,(p_command->>'can_ship')::boolean)
  on conflict(organization_id,warehouse_id,user_id) do update set can_purchase=excluded.can_purchase,can_receive=excluded.can_receive,can_ship=excluded.can_ship;
 elsif a in ('opening_stock','stock_adjust','stock_transfer') then
  w:=(p_command->>'warehouse_id')::uuid; pid:=(p_command->>'product_id')::uuid; reason:=btrim(p_command->>'reason');
  c:=public.fn_erp_assert_warehouse(p_org,p_actor,w,'receive');
  q:=case when a='stock_adjust' then (p_command->>'delta')::integer else (p_command->>'quantity')::integer end;
  if q is null or q=0 or abs(q)>1000000 or (a<>'stock_adjust' and q<1) or reason is null or length(reason) not between 1 and 160 then raise exception 'erp_invalid_input'; end if;
  if a='opening_stock' and exists(select 1 from public.erp_ledger where organization_id=p_org and warehouse_id=w and product_id=pid) then raise exception 'erp_opening_already_recorded'; end if;
  if a='stock_transfer' then
   perform public.fn_erp_assert_warehouse(p_org,p_actor,w,'ship'); w2:=(p_command->>'target_warehouse_id')::uuid;
   if w=w2 or c<>public.fn_erp_assert_warehouse(p_org,p_actor,w2,'receive') then raise exception 'erp_company_mismatch'; end if;
   perform public.fn_erp_move(p_org,p_actor,w,pid,-q,0,k,a,reason);
   perform public.fn_erp_move(p_org,p_actor,w2,pid,q,0,k,a,reason);
  else perform public.fn_erp_move(p_org,p_actor,w,pid,q,0,k,a,reason); end if;
  rid:=k;
 elsif a in ('sale_create','purchase_create') then
  w:=(p_command->>'warehouse_id')::uuid; c:=public.fn_erp_assert_warehouse(p_org,p_actor,w,case when a='sale_create' then 'ship' else 'purchase' end);
  select * into co from public.erp_companies where organization_id=p_org and id=c;
  if jsonb_typeof(p_command->'lines') is distinct from 'array' or jsonb_array_length(p_command->'lines') not between 1 and 100 then raise exception 'erp_invalid_input'; end if;
  sid:=(p_command->>'supplier_id')::uuid;
  if a='purchase_create' and not exists(select 1 from public.erp_suppliers where organization_id=p_org and company_id=c and id=sid) then raise exception 'erp_company_mismatch'; end if;
  if p_command->>'sales_order_id' is not null then
   select * into d from public.erp_documents where organization_id=p_org and id=(p_command->>'sales_order_id')::uuid and company_id=c and warehouse_id=w and kind='sale' and status in ('open','partial');
   if not found then raise exception 'erp_source_unavailable'; end if;
   sv:=d.version;
   if (p_command->>'source_order_version')::integer is null or sv<>(p_command->>'source_order_version')::integer then raise exception 'erp_stale_source'; end if;
   if jsonb_typeof(p_command->'source_stock_versions') is distinct from 'array' or jsonb_array_length(p_command->'source_stock_versions')<>jsonb_array_length(p_command->'lines') then raise exception 'erp_source_versions_required'; end if;
   if (select count(distinct value->>'product_id') from jsonb_array_elements(p_command->'source_stock_versions'))<>jsonb_array_length(p_command->'lines') then raise exception 'erp_source_versions_required'; end if;
   if exists(select 1 from jsonb_array_elements(p_command->'lines') ln where not exists(select 1 from jsonb_array_elements(p_command->'source_stock_versions') vs where vs->>'product_id'=ln->>'product_id' and (vs->>'version')::integer>=0)) then raise exception 'erp_source_versions_required'; end if;
  end if;
  -- A model-created suggestion can bind to the stock versions it actually saw.
  -- For manual creation the server captures current versions below.
  if p_command ? 'source_stock_versions' then
   for x in select value from jsonb_array_elements(p_command->'source_stock_versions') loop
    if coalesce((select version from public.erp_balances where organization_id=p_org and warehouse_id=w and product_id=(x->>'product_id')::uuid),0)<>(x->>'version')::integer then raise exception 'erp_stale_stock'; end if;
   end loop;
  end if;
  rid:=gen_random_uuid();
  insert into public.erp_documents(id,organization_id,company_id,warehouse_id,kind,number,status,supplier_id,customer_name,sales_order_id,source_sales_version,currency,created_by,due_at)
  values(rid,p_org,c,w,case when a='sale_create' then 'sale' else 'purchase' end,
   (case when a='sale_create' then 'SO-' else 'PO-' end)||replace(rid::text,'-',''),case when a='sale_create' then 'open' else 'draft' end,
   sid,p_command->>'customer_name',(p_command->>'sales_order_id')::uuid,sv,co.currency,p_actor,(p_command->>'due_at')::timestamptz);
  for x in select value from jsonb_array_elements(p_command->'lines') loop
   pid:=(x->>'product_id')::uuid; q:=(x->>'quantity')::integer; price:=(x->>'unit_price_cents')::bigint;
   if not exists(select 1 from public.erp_products where organization_id=p_org and company_id=c and id=pid) then raise exception 'erp_company_mismatch'; end if;
   if a='purchase_create' and p_command->>'sales_order_id' is not null then
    perform public.fn_erp_assert_replenishment(p_org,(p_command->>'sales_order_id')::uuid,w,pid,q,rid);
   end if;
   insert into public.erp_lines(organization_id,document_id,product_id,quantity,unit_price_cents,stock_version)
   values(p_org,rid,pid,q,price,coalesce((select version from public.erp_balances where organization_id=p_org and warehouse_id=w and product_id=pid),0));
   total:=total+q::bigint*price;
  end loop;
  update public.erp_documents set total_cents=total where organization_id=p_org and id=rid returning * into d;
  result:=jsonb_build_object('id',rid,'version',d.version,'status',d.status);
 elsif a='settlement_record' then
  select * into s from public.erp_settlements where organization_id=p_org and id=(p_command->>'id')::uuid for update;
  if not found then raise exception 'erp_not_found'; end if;
  if s.version<>(p_command->>'expected_version')::integer then raise exception 'erp_stale_version'; end if;
  amount:=(p_command->>'amount_cents')::bigint; reason:=btrim(p_command->>'reference');
  if amount is null or amount<=0 or amount>s.amount_cents-s.settled_cents or reason is null or length(reason) not between 1 and 160 then raise exception 'erp_invalid_settlement'; end if;
  update public.erp_settlements set settled_cents=settled_cents+amount,version=version+1 where organization_id=p_org and id=s.id returning version into sv;
  insert into public.erp_settlement_entries(organization_id,settlement_id,amount_cents,reference,operation_id,actor_id) values(p_org,s.id,amount,reason,k,p_actor);
  rid:=s.id; result:=jsonb_build_object('id',rid,'version',sv);
 elsif a in ('purchase_submit','purchase_approve','purchase_place','purchase_receive','sale_reserve','sale_ship','document_cancel','purchase_return','sale_return') then
  select * into d from public.erp_documents where organization_id=p_org and id=(p_command->>'id')::uuid for update;
  if not found then raise exception 'erp_not_found'; end if;
  rid:=d.id;
  if (p_command->>'expected_version')::integer is null or d.version<>(p_command->>'expected_version')::integer then raise exception 'erp_stale_version'; end if;
  cap:=case when a in ('purchase_receive','purchase_return','sale_return') then 'receive' when d.kind='purchase' then 'purchase' else 'ship' end;
  c:=public.fn_erp_assert_warehouse(p_org,p_actor,d.warehouse_id,cap);
  select * into co from public.erp_companies where organization_id=p_org and id=c;
  if d.status='cancelled' then raise exception 'erp_invalid_status'; end if;
  if a in ('purchase_submit','purchase_approve','purchase_place') then
   if d.kind<>'purchase' or (a='purchase_submit' and d.status<>'draft') or (a='purchase_approve' and d.status<>'pending') or (a='purchase_place' and d.status<>'approved') then raise exception 'erp_invalid_status'; end if;
   if a='purchase_approve' then
    if r not in ('manager','admin') then raise exception 'erp_manager_required' using errcode='42501'; end if;
    if not co.allow_self_approval and p_actor=d.created_by then raise exception 'erp_self_approval_forbidden'; end if;
    if d.total_cents>co.approval_limit_cents then raise exception 'erp_approval_limit'; end if;
   end if;
   if a='purchase_place' and (d.approved_by is null or not exists(select 1 from public.user_organizations where organization_id=p_org and user_id=d.approved_by and revoked_at is null and role in ('manager','admin')) or d.total_cents>co.approval_limit_cents or (not co.allow_self_approval and d.created_by=d.approved_by)) then raise exception 'erp_approval_invalid'; end if;
   if exists(select 1 from public.erp_lines el left join public.erp_balances eb on eb.organization_id=p_org and eb.warehouse_id=d.warehouse_id and eb.product_id=el.product_id
      where el.organization_id=p_org and el.document_id=d.id and el.stock_version<>coalesce(eb.version,0)) then raise exception 'erp_stale_stock'; end if;
   if d.sales_order_id is not null and not exists(select 1 from public.erp_documents ds where ds.organization_id=p_org and ds.id=d.sales_order_id and ds.version=d.source_sales_version and ds.status in ('open','partial')) then raise exception 'erp_stale_source'; end if;
   if d.sales_order_id is not null then
    for l in select * from public.erp_lines where organization_id=p_org and document_id=d.id loop
     perform public.fn_erp_assert_replenishment(p_org,d.sales_order_id,d.warehouse_id,l.product_id,l.quantity,d.id);
    end loop;
   end if;
   update public.erp_documents set status=case a when 'purchase_submit' then 'pending' when 'purchase_approve' then 'approved' else 'open' end,
    approved_by=case when a='purchase_approve' then p_actor else approved_by end,version=version+1 where organization_id=p_org and id=d.id returning * into d;
  elsif a='document_cancel' then
   reason:=btrim(p_command->>'reason');
   if reason is null or length(reason) not between 1 and 160 then raise exception 'erp_invalid_input'; end if;
   if exists(select 1 from public.erp_lines where organization_id=p_org and document_id=d.id and processed>0) then raise exception 'erp_posted_document_requires_return'; end if;
   for l in select * from public.erp_lines where organization_id=p_org and document_id=d.id and reserved>0 loop
    perform public.fn_erp_move(p_org,p_actor,d.warehouse_id,l.product_id,0,-l.reserved,k,'release',reason,d.id,l.id);
   end loop;
   update public.erp_lines set reserved=0 where organization_id=p_org and document_id=d.id;
   delete from public.erp_reservations where organization_id=p_org and document_id=d.id;
   update public.erp_documents set status='cancelled',version=version+1 where organization_id=p_org and id=d.id returning * into d;
  else
   if a like 'purchase_%' and d.kind<>'purchase' or a like 'sale_%' and d.kind<>'sale' then raise exception 'erp_invalid_status'; end if;
   if a in ('purchase_receive','sale_reserve','sale_ship') and d.status not in ('open','partial') then raise exception 'erp_invalid_status'; end if;
   if a in ('purchase_return','sale_return') and d.status not in ('partial','completed') then raise exception 'erp_invalid_status'; end if;
   if jsonb_typeof(p_command->'items') is distinct from 'array' or jsonb_array_length(p_command->'items') not between 1 and 100 then raise exception 'erp_invalid_input'; end if;
   if (select count(distinct value->>'line_id') from jsonb_array_elements(p_command->'items'))<>jsonb_array_length(p_command->'items') then raise exception 'erp_duplicate_line'; end if;
   for x in select value from jsonb_array_elements(p_command->'items') loop
    q:=(x->>'quantity')::integer;
    if q is null or q not between 1 and 1000000 then raise exception 'erp_invalid_input'; end if;
    select * into l from public.erp_lines where organization_id=p_org and document_id=d.id and id=(x->>'line_id')::uuid for update;
    if not found then raise exception 'erp_not_found'; end if;
    if a='sale_reserve' then
     if q>l.quantity-l.processed-l.reserved then raise exception 'erp_excess_quantity'; end if;
     perform public.fn_erp_move(p_org,p_actor,d.warehouse_id,l.product_id,0,q,k,a,'销售预占',d.id,l.id);
     update public.erp_lines set reserved=reserved+q where organization_id=p_org and id=l.id;
     insert into public.erp_reservations(organization_id,warehouse_id,product_id,document_id,line_id,quantity) values(p_org,d.warehouse_id,l.product_id,d.id,l.id,q)
      on conflict(organization_id,line_id) do update set quantity=erp_reservations.quantity+excluded.quantity;
    elsif a='sale_ship' then
     if q>l.reserved then raise exception 'erp_reservation_required'; end if;
     perform public.fn_erp_move(p_org,p_actor,d.warehouse_id,l.product_id,-q,-q,k,a,'销售出库',d.id,l.id);
     update public.erp_lines set reserved=reserved-q,processed=processed+q where organization_id=p_org and id=l.id;
     delete from public.erp_reservations where organization_id=p_org and line_id=l.id and quantity=q;
     update public.erp_reservations set quantity=quantity-q where organization_id=p_org and line_id=l.id;
    elsif a='purchase_receive' then
     if q>l.quantity-l.processed then raise exception 'erp_excess_quantity'; end if;
     perform public.fn_erp_move(p_org,p_actor,d.warehouse_id,l.product_id,q,0,k,a,'采购验收入库',d.id,l.id);
     update public.erp_lines set processed=processed+q where organization_id=p_org and id=l.id;
    else
     reason:=btrim(p_command->>'reason');
     if reason is null or length(reason) not between 1 and 160 or q>l.processed-l.returned then raise exception 'erp_excess_return'; end if;
     perform public.fn_erp_move(p_org,p_actor,d.warehouse_id,l.product_id,case when a='sale_return' then q else -q end,0,k,a,reason,d.id,l.id);
     update public.erp_lines set returned=returned+q where organization_id=p_org and id=l.id;
    end if;
   end loop;
   select bool_and(processed=quantity) into complete from public.erp_lines where organization_id=p_org and document_id=d.id;
   update public.erp_documents set status=case when a='sale_reserve' then status when complete then 'completed' else 'partial' end,version=version+1 where organization_id=p_org and id=d.id returning * into d;
   if a<>'sale_reserve' then
    select coalesce(sum((processed-returned)::bigint*unit_price_cents),0) into amount from public.erp_lines where organization_id=p_org and document_id=d.id;
    if exists(select 1 from public.erp_settlements where organization_id=p_org and document_id=d.id and settled_cents>amount) then raise exception 'erp_settlement_requires_reconciliation'; end if;
    insert into public.erp_settlements(organization_id,document_id,direction,amount_cents,currency) values(p_org,d.id,case when d.kind='sale' then 'receivable' else 'payable' end,amount,d.currency)
     on conflict(organization_id,document_id) do update set amount_cents=excluded.amount_cents,version=erp_settlements.version+1;
   end if;
  end if;
  result:=jsonb_build_object('id',d.id,'version',d.version,'status',d.status);
 else raise exception 'erp_unknown_action';
 end if;
 result:=coalesce(result,jsonb_build_object('id',rid))||jsonb_build_object('replayed',false);
 insert into public.erp_audit(organization_id,actor_id,action,resource_id,details) values(p_org,p_actor,a,rid,jsonb_build_object('operation_id',k,'result',result,'reason',p_command->>'reason','reference',p_command->>'reference'));
 insert into public.erp_command_receipts(organization_id,idempotency_key,actor_id,command,result) values(p_org,k,p_actor,p_command,result);
 return result;
end $f$;

revoke all on function public.fn_erp_assert_actor(uuid,uuid,boolean),public.fn_erp_assert_warehouse(uuid,uuid,uuid,text),public.fn_erp_move(uuid,uuid,uuid,uuid,integer,integer,uuid,text,text,uuid,uuid),public.fn_erp_snapshot(uuid,uuid),public.fn_erp_command(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.fn_erp_assert_replenishment(uuid,uuid,uuid,uuid,integer,uuid) from public,anon,authenticated,service_role;
grant execute on function public.fn_erp_snapshot(uuid,uuid),public.fn_erp_command(uuid,uuid,jsonb) to service_role;
comment on function public.fn_erp_command(uuid,uuid,jsonb) is 'ERP atomic business command; trusted backend supplies authenticated actor/org. Revalidates current membership, warehouse grants, approval policy, stock, versions and business idempotency. No payment/network side effect.';

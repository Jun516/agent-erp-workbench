/** Real PostgreSQL ERP regression. Explicit disposable DB URL only; never reads .env. */
import pg from 'pg';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';

const url = process.env.ERP_TEST_DB_URL;
if (!url) throw new Error('Set ERP_TEST_DB_URL to a disposable database; no implicit database target.');
const pool = new pg.Pool({ connectionString: url, max: 4 });
const migration = await readFile(new URL('../supabase/migrations/20261109000100_0409_erp_core.sql', import.meta.url), 'utf8');
const agentMigration = await readFile(new URL('../supabase/migrations/20261109001000_0410_erp_agent_analysis.sql', import.meta.url), 'utf8');
const org = randomUUID(), other = randomUUID();
const admin = randomUUID(), approver = randomUUID(), agent = randomUUID(), viewer = randomUUID(), outsider = randomUUID();
const checks = [];
let fixtures = false;
const query = (sql, values) => pool.query(sql, values);
const snap = async (actor = admin, tenant = org) => (await query('select public.fn_erp_snapshot($1,$2) as data', [tenant, actor])).rows[0].data;
const cmd = async (command, actor = admin, tenant = org) => (await query('select public.fn_erp_command($1,$2,$3::jsonb) as data', [tenant, actor, JSON.stringify({ idempotency_key: randomUUID(), ...command })])).rows[0].data;
async function check(name, fn) { await fn(); checks.push(name); process.stdout.write(`PASS ${name}\n`); }
async function refuses(command, code, actor = admin, tenant = org) { await assert.rejects(() => cmd(command, actor, tenant), new RegExp(code)); }
const document = async id => (await snap()).documents.find(d => d.id === id);
const line = async id => (await snap()).lines.find(d => d.document_id === id);
const op = async (action, id, extra = {}, actor = admin) => cmd({ action, id, expected_version: (await document(id)).version, ...extra }, actor);
try {
 await query(migration);
 await query(agentMigration);
 await query('insert into public.organizations(id,slug,legal_name,display_name) values($1,$2::text,$2::text,$2::text),($3,$4::text,$4::text,$4::text)', [org, `erp-qa-${org}`, other, `erp-qa-${other}`]);
 fixtures = true;
 for (const [id, role, tenant] of [[admin,'admin',org],[approver,'manager',org],[agent,'agent',org],[viewer,'viewer',org],[outsider,'admin',other]]) {
  await query('insert into auth.users(id,email) values($1,$2)', [id, `${id}@erp.invalid`]);
  await query('insert into public.user_organizations(organization_id,user_id,role) values($1,$2,$3)', [tenant,id,role]);
 }
 const company = (await cmd({action:'company_create',name:'ERP测试公司',currency:'CNY'})).id;
 const warehouse = (await cmd({action:'warehouse_create',company_id:company,name:'南京仓'})).id;
 const target = (await cmd({action:'warehouse_create',company_id:company,name:'上海仓'})).id;
 const supplier = (await cmd({action:'supplier_create',company_id:company,name:'测试供应商',lead_time_days:3})).id;
 const product = (await cmd({action:'product_create',company_id:company,name:'示例商品',sku:'SKU-QA',unit:'件'})).id;
 const stock = async wh => (await snap()).balances.find(b => b.warehouse_id === (wh ?? warehouse) && b.product_id === product);
 const opening = {action:'opening_stock',warehouse_id:warehouse,product_id:product,quantity:100,reason:'测试期初',idempotency_key:randomUUID()};
 await check('initial stock + ledger', async()=>{await cmd(opening); assert.equal((await stock()).on_hand,100); assert.equal((await snap()).ledger.length,1);});
 await check('same idempotency key replays without duplicate ledger',async()=>{assert.equal((await cmd(opening)).replayed,true); assert.equal((await snap()).ledger.length,1);});
 await check('idempotency payload mismatch rejected',()=>refuses({...opening,quantity:101},'erp_idempotency_conflict'));
 await check('opening stock cannot be repeated with new operation key',()=>refuses({...opening,idempotency_key:randomUUID()},'erp_opening_already_recorded'));
 await check('viewer cannot mutate',()=>refuses({action:'warehouse_create',company_id:company,name:'拒绝'},'erp_forbidden',viewer));
 await check('agent needs warehouse grant',()=>refuses({action:'sale_create',warehouse_id:warehouse,customer_name:'无权限',lines:[{product_id:product,quantity:1,unit_price_cents:8000}]},'erp_warehouse_forbidden',agent));
 await check('cross-tenant snapshot denied',async()=>{await assert.rejects(()=>snap(outsider),/erp_forbidden/); assert.equal((await snap(outsider,other)).documents.length,0);});
 await check('warehouse grants isolated',async()=>{await cmd({action:'access_grant',warehouse_id:warehouse,user_id:agent,can_purchase:true,can_receive:true,can_ship:true}); const s=await snap(agent);assert.equal(s.warehouses.length,1);assert.equal(s.warehouses[0].id,warehouse);});
 const makeSale = async quantity => (await cmd({action:'sale_create',warehouse_id:warehouse,customer_name:'测试零售商',lines:[{product_id:product,quantity,unit_price_cents:8000}]},agent)).id;
 const old = await makeSale(70), sale = await makeSale(50);
 await check('reservation does not change physical stock',async()=>{await op('sale_reserve',old,{items:[{line_id:(await line(old)).id,quantity:70}]},agent); const b=await stock();assert.equal(b.on_hand,100);assert.equal(b.reserved,70);assert.equal(b.available,30);});
 await check('cannot reserve shortage before receipt',async()=>refuses({action:'sale_reserve',id:sale,expected_version:1,items:[{line_id:(await line(sale)).id,quantity:50}]},'erp_insufficient_stock',agent));
 await check('linked purchase requires original evidence versions',()=>refuses({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier,sales_order_id:sale,lines:[{product_id:product,quantity:20,unit_price_cents:8000}]},'erp_stale_source',agent));
 const purchase = (await cmd({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier,sales_order_id:sale,source_order_version:1,source_stock_versions:[{product_id:product,version:(await stock()).version}],lines:[{product_id:product,quantity:20,unit_price_cents:8000}]},agent)).id;
 const linkedPurchase = async extra => ({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier,sales_order_id:sale,source_order_version:1,source_stock_versions:[{product_id:product,version:(await stock()).version}],lines:[{product_id:product,quantity:20,unit_price_cents:8000}],...extra});
 await check('old model stock evidence cannot create a new draft',async()=>refuses(await linkedPurchase({source_stock_versions:[{product_id:product,version:0}]}),'erp_stale_stock',agent));
 await check('old model order evidence cannot create a new draft',async()=>refuses(await linkedPurchase({source_order_version:99}),'erp_stale_source',agent));
 await check('linked purchase requires a version for each proposed SKU',async()=>refuses(await linkedPurchase({source_stock_versions:[]}),'erp_source_versions_required',agent));
 await check('existing purchase draft prevents duplicate replenishment',async()=>refuses(await linkedPurchase({}),'erp_excess_replenishment',agent));
 await check('SKU absent from source order rejected',async()=>{const p=(await cmd({action:'product_create',company_id:company,sku:'OTHER',name:'其他SKU',unit:'件'})).id;await refuses(await linkedPurchase({source_stock_versions:[{product_id:p,version:0}],lines:[{product_id:p,quantity:1,unit_price_cents:8000}]}),'erp_product_not_in_source',agent);});
 await check('missing line collection is refused in database too',()=>refuses({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier},'erp_invalid_input'));
 await check('negative control: disabling replenishment rule makes its rejection assertion fail',async()=>{
  const client=await pool.connect();
  try{
   await client.query('begin');
   const definition=(await client.query("select pg_get_functiondef('public.fn_erp_assert_replenishment(uuid,uuid,uuid,uuid,integer,uuid)'::regprocedure) as body")).rows[0].body;
   assert.ok(definition.includes('if p_quantity>greatest(need,0)'));
   await client.query(definition.replace('if p_quantity>greatest(need,0)','if false'));
   const command={idempotency_key:randomUUID(),...await linkedPurchase({})};
   let assertionFailed=false;
   try{await assert.rejects(()=>client.query('select public.fn_erp_command($1,$2,$3::jsonb)',[org,agent,JSON.stringify(command)]),/erp_excess_replenishment/);}catch(e){assert.ok(e instanceof assert.AssertionError);assertionFailed=true;}
   assert.equal(assertionFailed,true);
  } finally {await client.query('rollback');client.release();}
 });
 await check('purchase draft does not increase physical stock',async()=>{assert.equal((await stock()).on_hand,100);assert.equal((await document(purchase)).total_cents,160000);});
 await check('purchase receipt requires approval and placement',async()=>refuses({action:'purchase_receive',id:purchase,expected_version:1,items:[{line_id:(await line(purchase)).id,quantity:20}]},'erp_invalid_status',agent));
 await op('purchase_submit',purchase,{},agent);
 await check('ordinary operator cannot approve',async()=>refuses({action:'purchase_approve',id:purchase,expected_version:2},'erp_manager_required',agent));
 await op('purchase_approve',purchase,{},approver);
 await op('purchase_place',purchase,{},agent);
 const poLine = (await line(purchase)).id;
 await check('partial purchase receipt creates payable for received amount only',async()=>{await op('purchase_receive',purchase,{items:[{line_id:poLine,quantity:10}]},agent);assert.equal((await stock()).on_hand,110);assert.equal((await document(purchase)).status,'partial');assert.equal((await snap()).settlements.find(x=>x.document_id===purchase).amount_cents,80000);});
 await check('receipt above remaining quantity rejected atomically',async()=>{await refuses({action:'purchase_receive',id:purchase,expected_version:(await document(purchase)).version,items:[{line_id:poLine,quantity:11}]},'erp_excess_quantity',agent);assert.equal((await stock()).on_hand,110);});
 const receiptCommand={action:'purchase_receive',id:purchase,expected_version:(await document(purchase)).version,items:[{line_id:poLine,quantity:10}],idempotency_key:randomUUID()};
 await check('completed receipt is idempotent after version changes',async()=>{await cmd(receiptCommand,agent);assert.equal((await cmd(receiptCommand,agent)).replayed,true);assert.equal((await stock()).on_hand,120);assert.equal((await document(purchase)).status,'completed');});
 await check('stale document version rejected',()=>refuses({action:'sale_reserve',id:sale,expected_version:99,items:[{line_id:poLine,quantity:1}]},'erp_stale_version',agent));
 await op('sale_reserve',sale,{items:[{line_id:(await line(sale)).id,quantity:50}]},agent);
 await check('ship requires existing reservation',async()=>{const s=await makeSale(1);await refuses({action:'sale_ship',id:s,expected_version:1,items:[{line_id:(await line(s)).id,quantity:1}]},'erp_reservation_required',agent);await op('document_cancel',s,{reason:'测试结束'},agent);});
 await check('shipment removes physical and reserved stock together',async()=>{await op('sale_ship',sale,{items:[{line_id:(await line(sale)).id,quantity:50}]},agent);const b=await stock();assert.equal(b.on_hand,70);assert.equal(b.reserved,70);assert.equal(b.available,0);assert.equal((await snap()).settlements.find(x=>x.document_id===sale).amount_cents,400000);});
 await check('posted document requires return instead of cancellation',async()=>refuses({action:'document_cancel',id:sale,expected_version:(await document(sale)).version,reason:'不能直接取消'},'erp_posted_document_requires_return',agent));
 await check('sales return restores stock and reduces receivable',async()=>{await op('sale_return',sale,{items:[{line_id:(await line(sale)).id,quantity:5}],reason:'客户退回'},agent);assert.equal((await stock()).available,5);assert.equal((await snap()).settlements.find(x=>x.document_id===sale).amount_cents,360000);});
 await check('purchase return cannot consume reserved stock',async()=>refuses({action:'purchase_return',id:purchase,expected_version:(await document(purchase)).version,items:[{line_id:poLine,quantity:6}],reason:'供应商退货'},'erp_insufficient_stock',agent));
 await check('purchase return adjusts actual payable',async()=>{await op('purchase_return',purchase,{items:[{line_id:poLine,quantity:2}],reason:'供应商退货'},agent);assert.equal((await stock()).available,3);assert.equal((await snap()).settlements.find(x=>x.document_id===purchase).amount_cents,144000);});
 await check('warehouse transfer debits and credits in same transaction',async()=>{await cmd({action:'stock_transfer',warehouse_id:warehouse,target_warehouse_id:target,product_id:product,quantity:3,reason:'调拨'});assert.equal((await stock()).available,0);assert.equal((await stock(target)).on_hand,3);});
 await check('cross-company inventory forbidden',async()=>{const c=(await cmd({action:'company_create',name:'另一法人',currency:'USD'})).id;const w=(await cmd({action:'warehouse_create',company_id:c,name:'外部仓'})).id;await refuses({action:'stock_transfer',warehouse_id:target,target_warehouse_id:w,product_id:product,quantity:1,reason:'应拒绝'},'erp_company_mismatch');assert.equal((await stock(target)).on_hand,3);});
 await check('cancel releases reservations with ledger',async()=>{await op('document_cancel',old,{reason:'客户取消'},agent);assert.equal((await stock()).reserved,0);assert.equal((await stock()).available,70);assert.equal((await snap()).reservations.length,0);});
 await check('duplicate item lines rejected before any stock movement',async()=>{const s=await makeSale(2);const l=(await line(s)).id;await refuses({action:'sale_reserve',id:s,expected_version:1,items:[{line_id:l,quantity:1},{line_id:l,quantity:1}]},'erp_duplicate_line',agent);assert.equal((await stock()).reserved,0);});
 await check('manual settlement is partial, versioned and idempotent',async()=>{const s=(await snap()).settlements.find(x=>x.document_id===sale);const c={action:'settlement_record',id:s.id,expected_version:s.version,amount_cents:10000,reference:'银行流水 QA-1',idempotency_key:randomUUID()};await cmd(c);await cmd(c);assert.equal((await snap()).settlements.find(x=>x.id===s.id).settled_cents,10000);});
 await check('settlement above outstanding refused',async()=>{const s=(await snap()).settlements.find(x=>x.document_id===sale);await refuses({action:'settlement_record',id:s.id,expected_version:s.version,amount_cents:99999999,reference:'错账'},'erp_invalid_settlement');});
 await check('fully settled return requires explicit reconciliation',async()=>{const s=(await snap()).settlements.find(x=>x.document_id===sale);await cmd({action:'settlement_record',id:s.id,expected_version:s.version,amount_cents:s.amount_cents-s.settled_cents,reference:'银行流水 QA-2'});const before=(await stock()).on_hand;await refuses({action:'sale_return',id:sale,expected_version:(await document(sale)).version,items:[{line_id:(await line(sale)).id,quantity:1}],reason:'待财务退款核对'},'erp_settlement_requires_reconciliation',agent);assert.equal((await stock()).on_hand,before);});
 const manualPurchase=async()=> (await cmd({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier,lines:[{product_id:product,quantity:1,unit_price_cents:8000}]})).id;
 await check('requester cannot approve own purchase by default',async()=>{const p=await manualPurchase();await op('purchase_submit',p);await refuses({action:'purchase_approve',id:p,expected_version:2},'erp_self_approval_forbidden');});
 await check('stock changes invalidate pending approval',async()=>{const p=await manualPurchase();await op('purchase_submit',p);await cmd({action:'stock_adjust',warehouse_id:warehouse,product_id:product,delta:1,reason:'盘点变化'});await refuses({action:'purchase_approve',id:p,expected_version:2},'erp_stale_stock',approver);});
 await check('company approval limit is hard rule',async()=>{await cmd({action:'company_policy',company_id:company,allow_self_approval:false,approval_limit_cents:1});const p=await manualPurchase();await op('purchase_submit',p);await refuses({action:'purchase_approve',id:p,expected_version:2},'erp_approval_limit',approver);await cmd({action:'company_policy',company_id:company,allow_self_approval:false,approval_limit_cents:10000000});});
 await check('revoked approver invalidates placement',async()=>{const p=await manualPurchase();await op('purchase_submit',p);await op('purchase_approve',p,{},approver);await query('update public.user_organizations set revoked_at=now() where organization_id=$1 and user_id=$2',[org,approver]);await refuses({action:'purchase_place',id:p,expected_version:3},'erp_approval_invalid');await query('update public.user_organizations set revoked_at=null where organization_id=$1 and user_id=$2',[org,approver]);});
 await check('revoked actor cannot read or replay earlier command',async()=>{await query('update public.user_organizations set revoked_at=now() where organization_id=$1 and user_id=$2',[org,agent]);await assert.rejects(()=>snap(agent),/erp_forbidden/);await refuses(receiptCommand,'erp_forbidden',agent);await query('update public.user_organizations set revoked_at=null where organization_id=$1 and user_id=$2',[org,agent]);});
 await check('revoked warehouse capability also blocks old receipt replay',async()=>{await cmd({action:'access_grant',warehouse_id:warehouse,user_id:agent,can_purchase:true,can_receive:false,can_ship:true});await refuses(receiptCommand,'erp_warehouse_forbidden',agent);await cmd({action:'access_grant',warehouse_id:warehouse,user_id:agent,can_purchase:true,can_receive:true,can_ship:true});});
 await check('manager downgrade blocks replay of privileged receipt',async()=>{await query("update public.user_organizations set role='agent' where organization_id=$1 and user_id=$2",[org,admin]);try{await refuses(opening,'erp_manager_required');}finally{await query("update public.user_organizations set role='admin' where organization_id=$1 and user_id=$2",[org,admin]);}});
 await check('same key simultaneous requests create one stock movement',async()=>{const c={action:'stock_adjust',warehouse_id:warehouse,product_id:product,delta:1,reason:'并发幂等',idempotency_key:randomUUID()};const before=(await stock()).on_hand;const results=await Promise.all([cmd(c),cmd(c)]);assert.equal(results.filter(x=>x.replayed).length,1);assert.equal((await stock()).on_hand,before+1);});
 await check('concurrent reservations cannot oversell',async()=>{const a=await makeSale(50),b=await makeSale(50);const al=await line(a),bl=await line(b);const results=await Promise.allSettled([cmd({action:'sale_reserve',id:a,expected_version:1,items:[{line_id:al.id,quantity:50}]},agent),cmd({action:'sale_reserve',id:b,expected_version:1,items:[{line_id:bl.id,quantity:50}]},agent)]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.match(results.find(x=>x.status==='rejected').reason.message,/erp_insufficient_stock/);});
 await check('SQL aggregate balance equals append-only stock ledger',async()=>{const s=await snap();for(const b of s.balances){const rows=s.ledger.filter(x=>x.warehouse_id===b.warehouse_id&&x.product_id===b.product_id);assert.equal(b.on_hand,rows.reduce((v,x)=>v+x.quantity_delta,0));assert.equal(b.reserved,rows.reduce((v,x)=>v+x.reserved_delta,0));assert.ok(b.available>=0);} });
 await check('reservations equal per-line reserved stock',async()=>{const s=await snap();for(const l of s.lines)assert.equal(l.reserved,s.reservations.filter(x=>x.line_id===l.id).reduce((n,x)=>n+x.quantity,0));});
 await check('unknown action fails closed',()=>refuses({action:'invented_purchase_approve'},'erp_unknown_action'));
 await check('anon/authenticated cannot execute ERP RPC or private primitives',async()=>{const result=await query("select p.oid::regprocedure::text as name from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'fn_erp_%' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute'))");assert.deepEqual(result.rows,[]);});
 await check('REST roles cannot update/delete/truncate inventory/audit',async()=>{const result=await query("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('erp_companies','erp_warehouses','erp_suppliers','erp_products','erp_access','erp_balances','erp_documents','erp_lines','erp_reservations','erp_ledger','erp_settlements','erp_settlement_entries','erp_audit','erp_command_receipts') and grantee in ('anon','authenticated','service_role','PUBLIC') and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE')");assert.deepEqual(result.rows,[]);});
 await check('every ERP table has RLS enabled',async()=>{const result=await query("select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and relname like 'erp_%' and relkind='r' and not relrowsecurity");assert.deepEqual(result.rows,[]);});
 await check('Agent persistence has no anonymous/session access',async()=>{const names=['erp_agent_runs','erp_agent_memories','erp_agent_methods'];assert.equal((await query("select count(*)::int as count from pg_tables where schemaname='public' and tablename=any($1::text[])",[names])).rows[0].count,3);assert.deepEqual((await query("select table_name,grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('anon','authenticated','PUBLIC')",[names])).rows,[]);});
 await check('Agent service role cannot delete or truncate persisted runs/Memory/methods',async()=>{const result=await query("select table_name,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name in ('erp_agent_runs','erp_agent_memories','erp_agent_methods') and grantee='service_role' and privilege_type in ('DELETE','TRUNCATE','TRIGGER','REFERENCES')");assert.deepEqual(result.rows,[]);});
 await check('migration is idempotent with populated ERP records',async()=>{const before=(await snap()).ledger.length;await query(migration);assert.equal((await snap()).ledger.length,before);});
 await mkdir('docs/erp/qa',{recursive:true});
 await writeFile('docs/erp/qa/database-results.json',JSON.stringify({executed_at:new Date().toISOString(),postgres:(await query('select version() as version')).rows[0].version,checks:checks.length,passed:checks,real_database:true,scope:'ERP core; original application baseline installed by canonical prelude; no external API/payment/model calls'},null,2)+'\n');
 process.stdout.write(`ERP DB: ${checks.length} passed\n`);
} finally {
 if (fixtures) { await query('delete from public.organizations where id=any($1::uuid[])',[[org,other]]); await query('delete from auth.users where id=any($1::uuid[])',[[admin,approver,agent,viewer,outsider]]); }
 await pool.end();
}

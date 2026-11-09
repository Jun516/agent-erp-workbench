import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
const require=createRequire(import.meta.url);
const { chromium }=require(process.env.ERP_PLAYWRIGHT_PATH || 'playwright');
const origin='http://127.0.0.1:3015';
const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const checks=[]; const consoleErrors=[];
page.on('pageerror',e=>consoleErrors.push(e.message));
const check=(name)=>{checks.push(name);console.info('PASS '+name);};
async function api(path,body,status=200,method=body?'POST':'GET') {
 const res=await context.request.fetch(origin+path,{method,...(body?{data:body}:{})});
 const json=await res.json(); assert.equal(res.status(),status,JSON.stringify(json));return json.data??json;
}
const snapshot=()=>api('/api/v1/erp');
const cmd=(body,status=200)=>api('/api/v1/erp/commands',{idempotency_key:randomUUID(),...body},status);
const analysis=(id)=>api('/api/v1/erp/analysis',{order_id:id,mode:'rules',refinement:true});
const document=async id=>(await snapshot()).documents.find(d=>d.id===id);
const op=async(action,id,extra={},status=200)=>cmd({action,id,expected_version:(await document(id)).version,...extra},status);
mkdirSync('qa/results',{recursive:true});
try {
 const denied=await context.request.get(origin+'/api/v1/erp');assert.equal(denied.status(),401);check('unauthenticated API is denied');
 await page.goto(origin+'/login');await page.locator('#email').fill(process.env.ERP_QA_EMAIL);await page.locator('#password').fill(process.env.ERP_QA_PASSWORD);
 await page.locator('button[type=submit]').click();await page.waitForURL(/\/app(?:\/erp)?(?:\?|$)/,{timeout:60000});
 await page.goto(origin+'/app/erp');await page.getByRole('heading',{name:'ERP 经营工作台',exact:true}).waitFor();check('real Supabase login opens ERP workbench');
 const suffix=Date.now().toString(36);
 const company=(await cmd({action:'company_create',name:'浏览器验收公司-'+suffix,currency:'CNY'})).id;
 const warehouse=(await cmd({action:'warehouse_create',company_id:company,name:'南京测试仓'})).id;
 const supplier=(await cmd({action:'supplier_create',company_id:company,name:'测试供应商',lead_time_days:3})).id;
 const product=(await cmd({action:'product_create',company_id:company,name:'咖啡杯',sku:'MUG-'+suffix,unit:'件'})).id;
 await cmd({action:'opening_stock',warehouse_id:warehouse,product_id:product,quantity:100,reason:'浏览器验收期初'});
 const sale=async(name,q)=>(await cmd({action:'sale_create',warehouse_id:warehouse,customer_name:name,lines:[{product_id:product,quantity:q,unit_price_cents:8000}]})).id;
 const line=async id=>(await snapshot()).lines.find(l=>l.document_id===id);
 const old=await sale('已有订单',70);await op('sale_reserve',old,{items:[{line_id:(await line(old)).id,quantity:70}]});
 const order=await sale('新增电商订单',50);let run=await analysis(order);
 assert.equal(run.result.shortage_total,20);assert.equal(run.result.items[0].suggested_quantity,20);assert.equal(run.refinement.probe_passed,true);check('100 on-hand minus 70 reserved yields shortage 20 for demand 50');
 const memory=await api('/api/v1/erp/analysis/memory',{scope_type:'product',scope_id:product,content:'此商品补货前需确认外箱完整性。',expires_at:new Date(Date.now()+86400000).toISOString()});
 const remembered=await analysis(order);assert.deepEqual(remembered.memory_ids,[]);
 assert.ok((await api('/api/v1/erp/analysis')).memories.some(m=>m.id===memory.id));
 await api('/api/v1/erp/analysis/memory?id='+memory.id,null,200,'DELETE');
 const index=await api('/api/v1/erp/analysis');assert.ok(!index.memories.some(m=>m.id===memory.id));check('Memory confirmation and revocation persist; rules do not claim to consume Memory');
 const failedModel=await api('/api/v1/erp/analysis',{order_id:order,mode:'model',refinement:false});assert.equal(failedModel.status,'failed');assert.match(failedModel.final_text,/模型分析未完成/);check('missing model configuration is reported as failed model execution');
 await api('/api/v1/erp/analysis/'+run.id+'/review',{share_material:false},422);check('Jev material requires explicit confirmation');
 await cmd({action:'stock_adjust',warehouse_id:warehouse,product_id:product,delta:1,reason:'分析后盘点变化'});
 const draft=(r)=>({action:'purchase_create',warehouse_id:warehouse,supplier_id:supplier,sales_order_id:order,source_order_version:r.result.order_version,source_stock_versions:r.result.items.map(i=>({product_id:i.product_id,version:i.stock_version})),lines:r.result.items.filter(i=>i.suggested_quantity>0).map(i=>({product_id:i.product_id,quantity:i.suggested_quantity,unit_price_cents:8000}))});
 await cmd(draft(run),409);check('stale analysis cannot create purchase after inventory changes');
 run=await analysis(order);assert.equal(run.result.shortage_total,19);
 const command={...draft(run),idempotency_key:randomUUID()};const purchase=(await cmd(command)).id;assert.equal((await cmd(command)).replayed,true);check('purchase draft retry returns same receipt');
 const covered=await analysis(order);assert.equal(covered.result.items[0].suggested_quantity,0);check('existing planned procurement is deducted from new recommendations');
 await op('purchase_submit',purchase);await op('purchase_approve',purchase,{},403);check('requester cannot approve own purchase by default');
 await cmd({action:'company_policy',company_id:company,allow_self_approval:true,approval_limit_cents:10000000});await op('purchase_approve',purchase);await op('purchase_place',purchase);
 await op('purchase_receive',purchase,{items:[{line_id:(await line(purchase)).id,quantity:10}]});assert.equal((await document(purchase)).status,'partial');
 await op('purchase_receive',purchase,{items:[{line_id:(await line(purchase)).id,quantity:9}]});assert.equal((await document(purchase)).status,'completed');check('purchase approval and two partial receipts complete against real DB');
 await op('sale_reserve',order,{items:[{line_id:(await line(order)).id,quantity:50}]});await op('sale_ship',order,{items:[{line_id:(await line(order)).id,quantity:50}]});
 const final=await snapshot();const balance=final.balances.find(b=>b.warehouse_id===warehouse&&b.product_id===product);assert.deepEqual([balance.on_hand,balance.reserved,balance.available],[70,70,0]);check('shipment consumes reserved and physical stock consistently');
 const settlement=final.settlements.find(s=>s.document_id===order);await cmd({action:'settlement_record',id:settlement.id,expected_version:settlement.version,amount_cents:10000,reference:'QA银行对账凭证'});check('receivable manual reconciliation is persisted');
 await page.reload();await page.getByRole('button',{name:'库存作业',exact:true}).click();await page.getByRole('heading',{name:'仓库库存',exact:true}).waitFor();await page.screenshot({path:'qa/results/erp-stock-desktop.png',fullPage:true});check('inventory and ledger UI renders real data');
 await page.getByRole('button',{name:'基础资料与权限',exact:true}).click();
 const companyPanel=page.locator('section').filter({has:page.getByRole('heading',{name:'建立经营主体',exact:true})});
 if(await companyPanel.count()) {await companyPanel.getByLabel('公司名称',{exact:true}).fill('界面建档-'+suffix);await companyPanel.getByLabel('记账币种',{exact:true}).selectOption('CNY');await companyPanel.getByRole('button',{name:/创建公司/}).click();await page.getByText('界面建档-'+suffix,{exact:true}).first().waitFor();check('master data form persists through real command API');}
 await page.getByRole('button',{name:'Agent 分析与记忆',exact:true}).click();await page.getByRole('heading',{name:'分析历史与证据',exact:true}).waitFor();await page.screenshot({path:'qa/results/erp-agent-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'qa/results/erp-mobile.png',fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);check('mobile layout fits viewport');
 assert.deepEqual(consoleErrors,[]);check('no browser runtime errors');
 writeFileSync('qa/results/browser-results.json',JSON.stringify({executed_at:new Date().toISOString(),real_auth:true,real_database:true,model_or_jev_network_calls:false,checks,console_errors:consoleErrors},null,2));
} catch(error) {await page.screenshot({path:'qa/results/browser-failure.png',fullPage:true});throw error;}
finally {await browser.close();}

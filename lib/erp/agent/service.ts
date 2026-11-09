import "server-only";
import { randomUUID } from "node:crypto";
import type pg from "pg";
import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import { getErpSnapshot } from "@/lib/erp/server";
import { analyzeOrder, probeAnalysis, refineReadOnly, renderRules, METHOD_CODES } from "./analysis";
import { ERP_ANALYSIS_REVISION, type ErpAnalysisRun, type ErpMemory, type ErpAnalysisIndex, type ErpAnalysisResult } from "./contracts";
import { explainWithModel, renderModelReport } from "./model";
import { jevConfiguration, reviewWithJev } from "./jev";
import type { ErpSnapshot } from "../contracts";

function scopeVisible(snapshot:ErpSnapshot, scope:string,id:string) {
  return scope === "product" ? snapshot.products.some(row=>row.id===id) : scope === "warehouse" ? snapshot.warehouses.some(row=>row.id===id) : scope === "supplier" && snapshot.suppliers.some(row=>row.id===id);
}
function iso<T extends object>(row:T):T { return JSON.parse(JSON.stringify(row)) as T; }
function memoriesStillValid(ids:string[],memories:ErpMemory[]) { return ids.every(id=>memories.some(row=>row.id===id)); }
async function withMemoryAuthority<T>(orgId:string,actorId:string,scope:ErpMemory["scope_type"],scopeId:string,action:(client:pg.PoolClient)=>Promise<T>):Promise<T> {
  const client=await getRequestPool().connect();
  try {
    await client.query("begin");
    // Same lock discipline as ERP commands: revocation/company deactivation
    // cannot commit between the current-role check and the memory mutation.
    const membership=await client.query<{role:string}>("select u.role from public.user_organizations u join public.organizations o on o.id=u.organization_id where u.organization_id=$1 and u.user_id=$2 and u.revoked_at is null and o.status='active' for share of u,o",[orgId,actorId]);
    if(!membership.rows[0]||!["admin","manager"].includes(membership.rows[0].role))throw new Error("erp_memory_forbidden");
    const table=scope==="product"?"erp_products":scope==="warehouse"?"erp_warehouses":"erp_suppliers";
    const target=await client.query(`select id from public.${table} where organization_id=$1 and id=$2 for share`,[orgId,scopeId]);
    if(!target.rows[0])throw new Error("erp_memory_scope_not_found");
    const result=await action(client);
    await client.query("commit");
    return result;
  } catch(error) {await client.query("rollback").catch(()=>undefined);throw error;}
  finally {client.release();}
}
export async function listErpAnalyses(orgId:string,actorId:string):Promise<ErpAnalysisIndex> {
  const snapshot=await getErpSnapshot(orgId,actorId);
  const pool=getRequestPool();
  const [runs,memories]=await Promise.all([
    pool.query<ErpAnalysisRun & {policy_revision:string}>("select id,order_id,mode,status,final_text,result,refinement,evaluation,memory_ids,created_at,error_code,policy_revision from public.erp_agent_runs where organization_id=$1 and order_id=any($2::uuid[]) order by created_at desc limit 50",[orgId,snapshot.documents.map(row=>row.id)]),
    pool.query<ErpMemory>("select id,scope_type,scope_id,content,confirmed_by,expires_at,created_at from public.erp_agent_memories where organization_id=$1 and revoked_at is null and expires_at>now() order by created_at desc limit 200",[orgId]),
  ]);
  const visibleMemories=memories.rows.filter(row=>scopeVisible(snapshot,row.scope_type,row.scope_id));
  const visibleRuns=runs.rows.map(run=>{
    if(!memoriesStillValid(run.memory_ids,visibleMemories))return {...run,status:"failed" as const,error_code:"memory_revoked_or_expired",final_text:"本次分析引用的 Memory 已过期、撤回或权限变化，请重新分析。",refinement:{...run.refinement,probe_passed:false},evaluation:null};
    let current=false;
    try {current=run.policy_revision===ERP_ANALYSIS_REVISION && probeAnalysis(run.result,analyzeOrder(snapshot,run.order_id));} catch {current=false;}
    return current?run:{...run,status:"failed" as const,error_code:"stale_evidence",final_text:"本次分析对应的单据、库存或分析策略已变化，请重新分析。",refinement:{...run.refinement,probe_passed:false},evaluation:null};
  });
  return {runs:iso(visibleRuns),memories:iso(visibleMemories),configuration:{jev_configured:!!jevConfiguration(),model_settings_url:"/app/ai/providers",policy_revision:ERP_ANALYSIS_REVISION}};
}

function memoryForOrder(memories:ErpMemory[],facts:ErpAnalysisResult) {
  return memories.filter(row=>row.scope_type==="warehouse" ? row.scope_id===facts.warehouse_id : row.scope_type==="supplier" ? row.scope_id===facts.supplier_id : facts.items.some(item=>item.product_id===row.scope_id)).slice(0,12);
}
async function persistRun(pool:pg.Pool,orgId:string,actorId:string,run:ErpAnalysisRun) {
  await pool.query(`insert into public.erp_agent_runs(id,organization_id,actor_id,order_id,mode,status,final_text,result,refinement,evaluation,memory_ids,error_code,policy_revision) values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::uuid[],$12,$13)`,[run.id,orgId,actorId,run.order_id,run.mode,run.status,run.final_text,JSON.stringify(run.result),JSON.stringify(run.refinement),JSON.stringify(run.evaluation),run.memory_ids,run.error_code,ERP_ANALYSIS_REVISION]);
}

export async function runErpAnalysis(orgId:string,actorId:string,input:{order_id:string;mode:"rules"|"model";refinement:boolean}):Promise<ErpAnalysisRun> {
  const pool=getRequestPool();
  const snapshot=await getErpSnapshot(orgId,actorId);
  const facts=analyzeOrder(snapshot,input.order_id);
  const index=await listErpAnalyses(orgId,actorId);
  const memories=memoryForOrder(index.memories,facts);
  const learned=await pool.query<{method:string}>("select method from public.erp_agent_methods where organization_id=$1 and warehouse_id=$2 and policy_revision=$3 and expires_at>now()",[orgId,facts.warehouse_id,ERP_ANALYSIS_REVISION]);
  const refinement=refineReadOnly(facts,input.refinement,learned.rows[0]?.method??null);
  const run:ErpAnalysisRun={id:randomUUID(),order_id:input.order_id,mode:input.mode,status:"completed",final_text:renderRules(facts),result:facts,refinement,evaluation:null,memory_ids:input.mode==="model"?memories.map(row=>row.id):[],created_at:new Date().toISOString(),error_code:null};
  if(input.mode==="model") {
    // One parent call + at most one read-only candidate; hard wall-clock deadline, tool and turn caps.
    const deadline=AbortSignal.timeout(65_000);
    try {
      const report=await explainWithModel({pool,orgId,facts,memories,method:refinement.method,signal:AbortSignal.any([deadline,AbortSignal.timeout(35_000)])});
      run.final_text=renderModelReport(report);
      if(input.refinement && !deadline.aborted) {
        try {
          const currentMemory=await listErpAnalyses(orgId,actorId);
          if(!memoriesStillValid(run.memory_ids,currentMemory.memories))throw new Error("erp_memory_changed");
          const candidate=await explainWithModel({pool,orgId,facts,memories,method:refinement.method,previous:run.final_text,signal:AbortSignal.any([deadline,AbortSignal.timeout(25_000)])});
          // Candidate must keep all fact identities/quantities; evidence validator is in submit tool.
          run.final_text=renderModelReport(candidate);
          run.refinement.notes.push("只读模型复核候选通过结构与事实 Probe，已采纳；未执行任何业务写入。");
        } catch {run.refinement.notes.push("只读候选未通过或超时，保留首轮有效结果。");}
      }
    } catch(error) {
      run.status="failed";
      run.error_code=error instanceof Error && error.name==="llm_not_configured" ? "model_not_configured" : "model_analysis_failed";
      run.final_text=`模型分析未完成（${run.error_code}），请在模型设置中检查凭证、模型和预算，或选择规则分析。\n${renderRules(facts)}`;
    }
  }
  // This is a fresh permission check too. Revoked memberships/warehouses cannot return old evidence.
  const current=analyzeOrder(await getErpSnapshot(orgId,actorId),input.order_id);
  run.refinement.probe_passed=probeAnalysis(facts,current);
  if(!run.refinement.probe_passed) { run.status="failed";run.error_code="stale_evidence";run.final_text="分析期间单据或库存发生变化，请刷新后重新分析。"; }
  if(!memoriesStillValid(run.memory_ids,(await listErpAnalyses(orgId,actorId)).memories)) {run.status="failed";run.error_code="memory_revoked_or_expired";run.final_text="分析期间引用的Memory已失效，请重新分析。";run.refinement.probe_passed=false;}
  await persistRun(pool,orgId,actorId,run);
  if(input.refinement && run.status==="completed" && run.refinement.probe_passed && METHOD_CODES.includes(refinement.method as typeof METHOD_CODES[number])) {
    await pool.query(`insert into public.erp_agent_methods(organization_id,warehouse_id,method,source_run_id,policy_revision,expires_at) values($1,$2,$3,$4,$5,now()+interval '7 days') on conflict(organization_id,warehouse_id) do update set method=excluded.method,source_run_id=excluded.source_run_id,policy_revision=excluded.policy_revision,expires_at=excluded.expires_at`,[orgId,facts.warehouse_id,refinement.method,run.id,ERP_ANALYSIS_REVISION]);
  }
  return run;
}

export async function reviewErpAnalysis(orgId:string,actorId:string,id:string) {
  const snapshot=await getErpSnapshot(orgId,actorId);
  const found=await getRequestPool().query<ErpAnalysisRun>("select * from public.erp_agent_runs where organization_id=$1 and id=$2",[orgId,id]);
  const run=found.rows[0];
  if(!run || !snapshot.documents.some(row=>row.id===run.order_id)) throw new Error("erp_analysis_not_found");
  if(!memoriesStillValid(run.memory_ids,(await listErpAnalyses(orgId,actorId)).memories))throw new Error("erp_memory_changed");
  const current=analyzeOrder(snapshot,run.order_id);
  const review=await reviewWithJev(run,probeAnalysis(run.result,current));
  // Revalidate after the external request: Jev never makes old facts current again.
  const after=analyzeOrder(await getErpSnapshot(orgId,actorId),run.order_id);
  if(!probeAnalysis(run.result,after)) {review.verdict="fail";review.reason="复核期间证据变化，请重新分析。";}
  if(!memoriesStillValid(run.memory_ids,(await listErpAnalyses(orgId,actorId)).memories)) {review.verdict="fail";review.reason="复核期间引用的Memory已失效，请重新分析。";}
  await getRequestPool().query("update public.erp_agent_runs set evaluation=$3::jsonb where organization_id=$1 and id=$2",[orgId,id,JSON.stringify(review)]);
  return review;
}

export async function confirmErpMemory(orgId:string,actorId:string,input:{scope_type:ErpMemory["scope_type"];scope_id:string;content:string;expires_at:string}) {
  const snapshot=await getErpSnapshot(orgId,actorId);
  if(!["owner","admin","manager"].includes(snapshot.actor_role)) throw new Error("erp_memory_forbidden");
  if(!scopeVisible(snapshot,input.scope_type,input.scope_id))throw new Error("erp_memory_scope_not_found");
  const expiry=Date.parse(input.expires_at),now=Date.now();
  if(!Number.isFinite(expiry)||expiry<=now || expiry>now+365*86400000)throw new Error("erp_memory_expiry_invalid");
  const result=await withMemoryAuthority(orgId,actorId,input.scope_type,input.scope_id,client=>client.query<ErpMemory>(`insert into public.erp_agent_memories(organization_id,scope_type,scope_id,content,confirmed_by,expires_at) values($1,$2,$3,$4,$5,$6) returning id,scope_type,scope_id,content,confirmed_by,expires_at,created_at`,[orgId,input.scope_type,input.scope_id,input.content,actorId,input.expires_at]));
  if(!result.rows[0])throw new Error("erp_memory_save_failed");
  return iso(result.rows[0]);
}
export async function revokeErpMemory(orgId:string,actorId:string,id:string) {
  const snapshot=await getErpSnapshot(orgId,actorId);
  if(!["owner","admin","manager"].includes(snapshot.actor_role))throw new Error("erp_memory_forbidden");
  const found=await getRequestPool().query<ErpMemory>("select * from public.erp_agent_memories where organization_id=$1 and id=$2",[orgId,id]);
  if(!found.rows[0] || !scopeVisible(snapshot,found.rows[0].scope_type,found.rows[0].scope_id))throw new Error("erp_memory_scope_not_found");
  const target=found.rows[0];
  await withMemoryAuthority(orgId,actorId,target.scope_type,target.scope_id,client=>client.query("update public.erp_agent_memories set revoked_at=coalesce(revoked_at,now()),revoked_by=coalesce(revoked_by,$3) where organization_id=$1 and id=$2",[orgId,id,actorId]));
  return {revoked:true};
}

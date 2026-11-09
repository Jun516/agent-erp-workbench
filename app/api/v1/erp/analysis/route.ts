import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { ok,fail } from "@/lib/api/wrappers";
import { audit } from "@/lib/audit";
import { erpErrorResponse } from "@/lib/erp/errors";
import { analysisInputSchema } from "@/lib/erp/agent/contracts";
import { listErpAnalyses,runErpAnalysis } from "@/lib/erp/agent/service";

export const dynamic="force-dynamic";
export const runtime="nodejs";
export const maxDuration=90;
export async function GET():Promise<Response> {
  const requestId=randomUUID(),authz=await requireRole("viewer",{requestId,resource:"erp_analysis"});
  if(!authz.ok)return authz.response;
  try{return ok(await listErpAnalyses(authz.org.orgId,authz.user.id),{requestId});}
  catch(error){const mapped=erpErrorResponse(error);return fail(mapped.code,mapped.message,mapped.status,{requestId});}
}
export async function POST(request:Request):Promise<Response> {
  const requestId=randomUUID(),denied=await requireSupportWrite();if(denied)return denied;
  const authz=await requireRole("agent",{requestId,resource:"erp_analysis"});if(!authz.ok)return authz.response;
  const parsed=analysisInputSchema.safeParse(await request.json().catch(()=>null));
  if(!parsed.success)return fail("validation_failed","请选择销售订单和分析方式。",422,{requestId});
  try {
    const result=await runErpAnalysis(authz.org.orgId,authz.user.id,parsed.data);
    void audit({action:"erp.analysis",actorUserId:authz.user.id,organizationId:authz.org.orgId,resourceType:"erp_analysis",resourceId:result.id,requestId,metadata:{mode:result.mode,status:result.status}});
    return ok(result,{requestId});
  } catch(error){const mapped=erpErrorResponse(error);return fail(mapped.code,mapped.message,mapped.status,{requestId});}
}

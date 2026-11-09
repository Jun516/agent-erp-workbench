import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { ok,fail } from "@/lib/api/wrappers";
import { erpErrorResponse } from "@/lib/erp/errors";
import { reviewErpAnalysis } from "@/lib/erp/agent/service";
const schema=z.object({share_material:z.literal(true)}).strict();
export const dynamic="force-dynamic";
export const runtime="nodejs";
export async function POST(request:Request,context:{params:Promise<{id:string}>}):Promise<Response>{
  const requestId=randomUUID(),denied=await requireSupportWrite();if(denied)return denied;
  const authz=await requireRole("manager",{requestId,resource:"erp_analysis"});if(!authz.ok)return authz.response;
  const parsed=schema.safeParse(await request.json().catch(()=>null)),id=z.string().uuid().safeParse((await context.params).id);
  if(!parsed.success||!id.success)return fail("validation_failed","需确认向 Jev 发送当前可见报告及脱敏证据，报告可能含已确认Memory的派生内容。",422,{requestId});
  try{const review=await reviewErpAnalysis(authz.org.orgId,authz.user.id,id.data);void audit({action:"erp.review",actorUserId:authz.user.id,organizationId:authz.org.orgId,resourceType:"erp_analysis",resourceId:id.data,requestId,metadata:{verdict:review.verdict}});return ok(review,{requestId});}
  catch(error){const mapped=erpErrorResponse(error);return fail(mapped.code,mapped.message,mapped.status,{requestId});}
}

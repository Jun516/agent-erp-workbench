import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { audit } from "@/lib/audit";
import { ok,fail } from "@/lib/api/wrappers";
import { erpErrorResponse } from "@/lib/erp/errors";
import { memoryInputSchema } from "@/lib/erp/agent/contracts";
import { confirmErpMemory,revokeErpMemory } from "@/lib/erp/agent/service";
export const dynamic="force-dynamic";
export const runtime="nodejs";
async function handle(request:Request,revoke:boolean):Promise<Response>{
  const requestId=randomUUID(),denied=await requireSupportWrite();if(denied)return denied;
  const authz=await requireRole("manager",{requestId,resource:"erp_memory"});if(!authz.ok)return authz.response;
  try{
    if(revoke){
      const id=z.string().uuid().safeParse(new URL(request.url).searchParams.get("id"));if(!id.success)return fail("validation_failed","Memory编号无效。",422,{requestId});
      const result=await revokeErpMemory(authz.org.orgId,authz.user.id,id.data);void audit({action:"erp.memory",actorUserId:authz.user.id,organizationId:authz.org.orgId,resourceType:"erp_memory",resourceId:id.data,requestId,metadata:{operation:"revoke"}});return ok(result,{requestId});
    }
    const parsed=memoryInputSchema.safeParse(await request.json().catch(()=>null));if(!parsed.success)return fail("validation_failed","请填写范围、已确认内容和一年内有效期。",422,{requestId});
    const memory=await confirmErpMemory(authz.org.orgId,authz.user.id,parsed.data);void audit({action:"erp.memory",actorUserId:authz.user.id,organizationId:authz.org.orgId,resourceType:"erp_memory",resourceId:memory.id,requestId,metadata:{operation:"confirm",scope_type:memory.scope_type}});return ok(memory,{requestId});
  }catch(error){const mapped=erpErrorResponse(error);return fail(mapped.code,mapped.message,mapped.status,{requestId});}
}
export async function POST(request:Request){return handle(request,false);}
export async function DELETE(request:Request){return handle(request,true);}

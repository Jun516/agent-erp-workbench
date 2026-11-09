import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/require-role";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { fail, ok } from "@/lib/api/wrappers";
import { erpCommandSchema } from "@/lib/erp/contracts";
import { erpErrorResponse } from "@/lib/erp/errors";
import { executeErpCommand } from "@/lib/erp/server";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const requestId = randomUUID();
  const denied = await requireSupportWrite();
  if (denied) return denied;
  const authz = await requireRole("agent", { requestId, resource: "erp" });
  if (!authz.ok) return authz.response;
  const parsed = erpCommandSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("validation_failed", "请核对必填字段、数量和金额。", 422, {
    requestId, details: parsed.error.flatten(),
  });
  try {
    const result = await executeErpCommand(authz.org.orgId, authz.user.id, parsed.data);
    if (!result.replayed) void audit({
      actorUserId: authz.user.id, organizationId: authz.org.orgId,
      action: "erp.command", resourceType: "erp", resourceId: result.id,
      requestId, metadata: { command: parsed.data.action, idempotency_key: parsed.data.idempotency_key },
    });
    return ok(result, { requestId });
  } catch (error) {
    const mapped = erpErrorResponse(error);
    return fail(mapped.code, mapped.message, mapped.status, { requestId });
  }
}

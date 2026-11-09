import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/auth/require-role";
import { fail, ok } from "@/lib/api/wrappers";
import { erpErrorResponse } from "@/lib/erp/errors";
import { getErpSnapshot } from "@/lib/erp/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  const requestId = randomUUID();
  const authz = await requireRole("viewer", { requestId, resource: "erp" });
  if (!authz.ok) return authz.response;
  try {
    return ok(await getErpSnapshot(authz.org.orgId, authz.user.id), { requestId });
  } catch (error) {
    const mapped = erpErrorResponse(error);
    return fail(mapped.code, mapped.message, mapped.status, { requestId });
  }
}

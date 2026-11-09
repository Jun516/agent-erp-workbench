import "server-only";

import { getRequestPool } from "@/lib/agent-engine/db/request-pool";
import type { ErpCommand, ErpCommandResult, ErpSnapshot } from "./contracts";

/** Server-only seam. org/actor MUST come from requireRole, never from request JSON.
 * SQL rechecks current membership, warehouse grants, versions and stock atomically.
 */
export async function getErpSnapshot(orgId: string, actorId: string): Promise<ErpSnapshot> {
  const result = await getRequestPool().query<{ data: ErpSnapshot }>(
    "select public.fn_erp_snapshot($1::uuid, $2::uuid) as data", [orgId, actorId],
  );
  if (!result.rows[0]?.data) throw new Error("erp_unavailable");
  return result.rows[0].data;
}

export async function executeErpCommand(orgId: string, actorId: string, command: ErpCommand): Promise<ErpCommandResult> {
  const result = await getRequestPool().query<{ data: ErpCommandResult }>(
    "select public.fn_erp_command($1::uuid, $2::uuid, $3::jsonb) as data",
    [orgId, actorId, JSON.stringify(command)],
  );
  if (!result.rows[0]?.data) throw new Error("erp_unavailable");
  return result.rows[0].data;
}

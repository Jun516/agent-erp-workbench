import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { roleAtLeast } from "@/lib/auth/types";
import { ErpWorkbench } from "./_components/ErpWorkbench";

export const dynamic = "force-dynamic";
export const metadata = { title: "ERP 经营工作台" };

export default async function ErpPage() {
  const user = await requireAuth();
  const org = await resolveActiveOrg(user);
  if (!org) return <p role="alert">请先选择一个有效的组织工作区。</p>;
  return (
    <ErpWorkbench
      canWrite={roleAtLeast(org.role, "agent")}
      workspaceName={org.name}
      actorId={user.id}
    />
  );
}

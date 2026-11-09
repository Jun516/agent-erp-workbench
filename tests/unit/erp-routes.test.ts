import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ role: vi.fn(), support: vi.fn(), execute: vi.fn(), snapshot: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/auth/require-role", () => ({ requireRole: h.role }));
vi.mock("@/lib/impersonate/support", () => ({ requireSupportWrite: h.support }));
vi.mock("@/lib/erp/server", () => ({ executeErpCommand: h.execute, getErpSnapshot: h.snapshot }));
vi.mock("@/lib/audit", () => ({ audit: h.audit }));
import { POST } from "@/app/api/v1/erp/commands/route";
import { GET } from "@/app/api/v1/erp/route";

const request = (body: unknown) => new Request("http://localhost/api/v1/erp/commands", { method: "POST", body: JSON.stringify(body) });
const command = { action: "company_create", name: "测试公司", currency: "CNY", idempotency_key: "f81d4fae-7dec-4abc-a765-00a0c91e6bf6" };

beforeEach(() => {
  vi.resetAllMocks();
  h.role.mockResolvedValue({ ok: true, user: { id: "trusted-user" }, org: { orgId: "trusted-org" } });
  h.support.mockResolvedValue(null);
  h.execute.mockResolvedValue({ id: "company", replayed: false });
  h.audit.mockResolvedValue(undefined);
});

describe("ERP authenticated boundary", () => {
  it("blocks read-only support before executing any command", async () => {
    h.support.mockResolvedValue(new Response(null, { status: 403 }));
    expect((await POST(request(command))).status).toBe(403);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("returns auth refusal without touching the database", async () => {
    h.role.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
    expect((await POST(request(command))).status).toBe(401);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("rejects injected tenant or actor instead of forwarding arbitrary JSON", async () => {
    expect((await POST(request({ ...command, organization_id: "victim", actor_id: "admin" }))).status).toBe(422);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("passes only trusted session scope and the validated command", async () => {
    const response = await POST(request(command));
    expect(response.status).toBe(200);
    expect(h.execute).toHaveBeenCalledWith("trusted-org", "trusted-user", command);
    expect(response.headers.get("X-Request-Id")).toBeTruthy();
    expect(h.audit).toHaveBeenCalledOnce();
  });
  it("does not emit a second mutation audit on an idempotent replay", async () => {
    h.execute.mockResolvedValue({ id: "company", replayed: true });
    expect((await POST(request(command))).status).toBe(200);
    expect(h.audit).not.toHaveBeenCalled();
  });
  it("returns conflicts for changed versions without leaking SQL or credentials", async () => {
    h.execute.mockRejectedValue(new Error("erp_version_conflict secret SQL context"));
    const response = await POST(request(command));
    expect(response.status).toBe(409);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
  it("validates negative quantities before business execution", async () => {
    const response = await POST(request({ action: "opening_stock", idempotency_key: command.idempotency_key,
      warehouse_id: command.idempotency_key, product_id: command.idempotency_key, quantity: -1, reason: "入库" }));
    expect(response.status).toBe(422);
    expect(h.execute).not.toHaveBeenCalled();
  });
  it("scopes snapshot reads to authenticated organization and actor", async () => {
    h.snapshot.mockResolvedValue({ companies: [] });
    expect((await GET()).status).toBe(200);
    expect(h.snapshot).toHaveBeenCalledWith("trusted-org", "trusted-user");
    expect(h.role).toHaveBeenCalledWith("viewer", expect.anything());
  });
});

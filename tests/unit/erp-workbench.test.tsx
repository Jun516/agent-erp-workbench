import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ErpWorkbench, nextStep } from "@/app/app/erp/_components/ErpWorkbench";
import type { ErpDocument, ErpSnapshot } from "@/lib/erp/contracts";

const uuid = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const empty = (): ErpSnapshot => ({
  companies: [],
  warehouses: [],
  suppliers: [],
  products: [],
  balances: [],
  documents: [],
  lines: [],
  reservations: [],
  ledger: [],
  settlements: [],
  audit: [],
  access: [],
  actor_role: "admin",
});
const respond = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(status === 200 ? { data } : { error: { code: "conflict", message: data } }),
    { status, headers: { "Content-Type": "application/json" } },
  );
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ERP 工作台业务操作", () => {
  it("网络结果未知时，用户重试沿用原幂等键，成功后刷新账本", async () => {
    const sent: Record<string, unknown>[] = [];
    const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
      if (init?.method === "POST") {
        sent.push(JSON.parse(String(init.body)));
        if (sent.length === 1) throw new Error("网络中断，结果未知");
        return respond({ id: uuid(1), replayed: true });
      }
      return respond(empty());
    });
    vi.stubGlobal("fetch", fetch);
    render(<ErpWorkbench canWrite workspaceName="测试组织" actorId={uuid(2)} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新账本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "基础资料与权限" }));
    fireEvent.change(screen.getByLabelText("公司名称"), { target: { value: "江南商贸" } });
    fireEvent.change(screen.getByLabelText("记账币种"), { target: { value: "CNY" } });
    fireEvent.click(screen.getByRole("button", { name: "创建公司" }));
    expect(await screen.findByText("网络中断，结果未知")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "核对并重试上次操作" }));
    expect(await screen.findByText("已确认上次操作已入账，本次没有重复执行。")).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[0]).toEqual(sent[1]);
    expect(sent[0]).toMatchObject({ action: "company_create", name: "江南商贸", currency: "CNY" });
    expect(String(sent[0]?.idempotency_key)).toMatch(/^[a-f0-9-]{36}$/);
    expect(fetch.mock.calls.filter(([, init]) => !init?.method)).toHaveLength(2);
  });

  it("只读成员能看到账本并获得权限提示，创建表单不可操作", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respond({ ...empty(), actor_role: "viewer" })),
    );
    render(<ErpWorkbench canWrite={false} workspaceName="测试组织" actorId={uuid(2)} />);
    await screen.findByText(/当前为只读权限/);
    fireEvent.click(screen.getByRole("button", { name: "基础资料与权限" }));
    expect(screen.getByLabelText("公司名称")).toBeDisabled();
    expect(screen.getByRole("button", { name: "创建公司" })).toBeDisabled();
  });

  it("分批收货仅提交本次正数明细，并带上当前单据版本", async () => {
    const data = empty();
    data.companies.push({
      id: uuid(1),
      organization_id: uuid(2),
      name: "商贸",
      currency: "CNY",
      allow_self_approval: false,
      approval_limit_cents: 100000,
      version: 1,
    });
    data.warehouses.push({
      id: uuid(3),
      organization_id: uuid(2),
      company_id: uuid(1),
      name: "一号仓",
    });
    data.products.push({
      id: uuid(4),
      organization_id: uuid(2),
      company_id: uuid(1),
      sku: "A01",
      name: "测试商品",
      unit: "件",
    });
    data.documents.push({
      id: uuid(5),
      organization_id: uuid(2),
      company_id: uuid(1),
      warehouse_id: uuid(3),
      kind: "purchase",
      number: "PO-001",
      status: "open",
      supplier_id: null,
      customer_name: null,
      sales_order_id: null,
      currency: "CNY",
      total_cents: 8000,
      version: 7,
      created_by: uuid(6),
      approved_by: uuid(7),
      due_at: null,
      created_at: "2026-11-09T00:00:00Z",
    });
    data.lines.push({
      id: uuid(8),
      organization_id: uuid(2),
      document_id: uuid(5),
      product_id: uuid(4),
      quantity: 10,
      processed: 0,
      reserved: 0,
      returned: 0,
      unit_price_cents: 800,
      stock_version: 1,
    });
    const sent: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        if (init?.method === "POST") {
          sent.push(JSON.parse(String(init.body)));
          return respond({ id: uuid(5), replayed: false });
        }
        return respond(data);
      }),
    );
    render(<ErpWorkbench canWrite workspaceName="测试组织" actorId={uuid(2)} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "刷新账本" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "销售与采购" }));
    fireEvent.click(screen.getByRole("button", { name: "查看与处理" }));
    fireEvent.change(screen.getByLabelText("A01 · 测试商品 本次数量（不处理填 0）"), {
      target: { value: "3" },
    });
    fireEvent.click(screen.getByRole("button", { name: "登记实物收货" }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({
      action: "purchase_receive",
      id: uuid(5),
      expected_version: 7,
      items: [{ line_id: uuid(8), quantity: 3 }],
    });
  });

  it("采购单据各状态都有具体的人工下一步", () => {
    expect(nextStep({ kind: "purchase", status: "pending" } as ErpDocument)).toContain(
      "具备审批权限",
    );
    expect(nextStep({ kind: "purchase", status: "open" } as ErpDocument)).toContain("实物到仓");
    expect(nextStep({ kind: "sale", status: "partial" } as ErpDocument)).toContain("先预占");
  });
});

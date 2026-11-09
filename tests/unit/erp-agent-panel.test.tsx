import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "@/app/app/erp/_components/AgentPanel";
import type { ErpAnalysisIndex, ErpAnalysisRun } from "@/lib/erp/agent/contracts";
import type { ErpSnapshot } from "@/lib/erp/contracts";

const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function fixture(role = "admin") {
  const snapshot: ErpSnapshot = {
    companies: [],
    warehouses: [],
    suppliers: [
      { id: id(2), company_id: id(1), organization_id: id(9), name: "供货商", lead_time_days: 7 },
    ],
    products: [],
    balances: [],
    documents: [],
    lines: [],
    reservations: [],
    ledger: [],
    settlements: [],
    audit: [],
    access: [],
    actor_role: role,
  };
  const run: ErpAnalysisRun = {
    id: id(3),
    order_id: id(4),
    mode: "rules",
    status: "completed",
    final_text: "规则分析，现货缺口20。",
    result: {
      order_id: id(4),
      order_version: 2,
      warehouse_id: id(5),
      company_id: id(1),
      currency: "CNY",
      items: [
        {
          line_id: id(6),
          product_id: id(7),
          sku: "A01",
          demand: 50,
          on_hand: 100,
          reserved: 70,
          available: 30,
          shortage: 20,
          on_order: 0,
          stock_version: 4,
          unit_price_cents: 8000,
          suggested_quantity: 20,
        },
      ],
      shortage_total: 20,
      estimated_cost_cents: 160000,
      supplier_id: id(2),
      supplier_lead_time_days: 7,
      evidence_fingerprint: "hash",
      warnings: [],
      next_action: "确认报价再采购。",
    },
    refinement: {
      enabled: false,
      rounds: 0,
      method: "availability_first",
      probe_passed: true,
      reused_method: false,
      notes: [],
    },
    evaluation: null,
    memory_ids: [],
    created_at: "2026-11-09T00:00:00Z",
    error_code: null,
  };
  const index: ErpAnalysisIndex = {
    runs: [run],
    memories: [],
    configuration: {
      jev_configured: true,
      model_settings_url: "/app/ai/models",
      policy_revision: "erp-analysis-v1",
    },
  };
  return { snapshot, run, index };
}
const response = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 });
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ERP Agent 人工确认边界", () => {
  it("未勾选分享时禁止Jev复核，确认后发送显式share_material", async () => {
    const { snapshot, index } = fixture();
    const fetch = vi.fn(async (_url: unknown, _init?: RequestInit) => response(index));
    vi.stubGlobal("fetch", fetch);
    render(
      <AgentPanel
        snapshot={snapshot}
        company={id(1)}
        canWrite
        refresh={async () => undefined}
        execute={async () => true}
      />,
    );
    const button = await screen.findByRole("button", { name: "提交 Jev 复核" });
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /我确认将本次分析/ }));
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(
        fetch.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/review") &&
            JSON.parse(String(init?.body)).share_material === true,
        ),
      ).toBe(true),
    );
  });

  it("草稿携带分析时的证据版本，成功后禁止继续复用旧建议", async () => {
    const { snapshot, index } = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(index)),
    );
    const execute = vi.fn(async () => true);
    render(
      <AgentPanel
        snapshot={snapshot}
        company={id(1)}
        canWrite
        refresh={async () => undefined}
        execute={execute}
      />,
    );
    await screen.findByRole("button", { name: "确认生成采购草稿" });
    fireEvent.change(screen.getByLabelText("本次采购供应商"), { target: { value: id(2) } });
    fireEvent.click(screen.getByRole("button", { name: "确认生成采购草稿" }));
    await screen.findByText(/采购草稿已生成，请到/);
    expect(execute).toHaveBeenCalledExactlyOnceWith({
      action: "purchase_create",
      warehouse_id: id(5),
      supplier_id: id(2),
      sales_order_id: id(4),
      source_order_version: 2,
      source_stock_versions: [{ product_id: id(7), version: 4 }],
      lines: [{ product_id: id(7), quantity: 20, unit_price_cents: 8000 }],
    });
    expect(screen.getByRole("button", { name: "确认生成采购草稿" })).toBeDisabled();
  });

  it("普通业务成员可以分析，但Memory与Jev经理操作不可用", async () => {
    const { snapshot, index } = fixture("agent");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => response(index)),
    );
    render(
      <AgentPanel
        snapshot={snapshot}
        company={id(1)}
        canWrite
        refresh={async () => undefined}
        execute={async () => true}
      />,
    );
    await screen.findByRole("button", { name: "提交 Jev 复核" });
    expect(screen.getByRole("button", { name: "运行分析" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "确认并保存记忆" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: /我确认将本次分析/ })).toBeDisabled();
  });
});

"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ErpAnalysisIndex, ErpAnalysisRun } from "@/lib/erp/agent/contracts";
import type { ErpSnapshot } from "@/lib/erp/contracts";
import { Field, Panel, Select, Table, money, request } from "./ErpWorkbench";

const verdict: Record<string, string> = {
  pass: "通过",
  fail: "不通过",
  needs_review: "需要人工复核",
};
export function AgentPanel({
  snapshot,
  company,
  canWrite,
  refresh,
  execute,
}: {
  snapshot: ErpSnapshot;
  company: string;
  canWrite: boolean;
  refresh: () => Promise<void>;
  execute: (command: Record<string, unknown>) => Promise<boolean>;
}) {
  const [index, setIndex] = useState<ErpAnalysisIndex | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const canReview = canWrite && ["manager", "admin"].includes(snapshot.actor_role);
  const [sharing, setSharing] = useState(false);
  const [expiry] = useState(() => {
    const d = new Date(Date.now() + 14 * 86_400_000);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  const load = useCallback(async () => {
    try {
      const data = await request<ErpAnalysisIndex>("/api/v1/erp/analysis");
      setIndex(data);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "分析记录读取失败");
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void request<ErpAnalysisIndex>("/api/v1/erp/analysis", { signal: controller.signal })
      .then((data) => {
        setIndex(data);
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "分析记录读取失败");
      });
    return () => controller.abort();
  }, []);
  const work = async (action: () => Promise<void>) => {
    if (lock.current || !canWrite) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "操作失败");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const runs = index?.runs.filter((x) => x.result.company_id === company) ?? [];
  const run = runs.find((x) => x.id === selected) ?? runs[0];
  const orders = snapshot.documents.filter(
    (x) =>
      x.company_id === company &&
      x.kind === "sale" &&
      !["completed", "cancelled"].includes(x.status),
  );
  const suppliers = snapshot.suppliers.filter((x) => x.company_id === company);
  const scopes = [
    ...snapshot.products
      .filter((x) => x.company_id === company)
      .map((x) => ({ type: "product", id: x.id, label: `SKU · ${x.sku} ${x.name}` })),
    ...snapshot.warehouses
      .filter((x) => x.company_id === company)
      .map((x) => ({ type: "warehouse", id: x.id, label: `仓库 · ${x.name}` })),
    ...suppliers.map((x) => ({ type: "supplier", id: x.id, label: `供应商 · ${x.name}` })),
  ];
  const memories =
    index?.memories.filter((x) =>
      scopes.some((s) => s.id === x.scope_id && s.type === x.scope_type),
    ) ?? [];
  return (
    <div className="space-y-4">
      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm"
        >
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="rounded-lg border border-emerald-500/30 p-3 text-sm">
          {notice}
        </p>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="销售缺口与补货分析"
          note="Agent 读取当前订单和库存，给出有证据的建议。采购仍需人工确认草稿并经过业务审批。"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void work(async () => {
                const result = await request<ErpAnalysisRun>("/api/v1/erp/analysis", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    order_id: f.get("order"),
                    mode: f.get("mode"),
                    refinement: f.has("refinement"),
                  }),
                });
                await load();
                setSelected(result.id);
                setSharing(false);
                setNotice(
                  result.status === "completed"
                    ? "分析已保存，请复核库存证据与下一步建议。"
                    : "本次分析未完成，失败原因已保存在运行记录中。",
                );
              });
            }}
          >
            <fieldset disabled={busy || !canWrite} className="space-y-3">
              <Select name="order" label="待履约销售单">
                {orders.map((x) => (
                  <option value={x.id} key={x.id}>
                    {x.number} · {x.customer_name}
                  </option>
                ))}
              </Select>
              <Select name="mode" label="分析方式">
                <option value="rules">规则分析（确定性计算，不调用模型）</option>
                <option value="model">模型 Agent（使用组织模型配置）</option>
              </Select>
              <label className="flex items-start gap-2 text-sm">
                <input type="checkbox" name="refinement" className="mt-1" />
                <span>
                  启用只读自精炼
                  <p className="mt-1 text-xs text-muted-foreground">
                    在固定预算和允许的方法内复查证据，通过 Probe
                    后可复用方法。业务权限与审批规则保持由程序执行。
                  </p>
                </span>
              </label>
              <Button type="submit">{busy ? "正在处理…" : "运行分析"}</Button>
            </fieldset>
          </form>
          {!orders.length && (
            <p className="mt-3 text-sm text-muted-foreground">
              请先在“销售与采购”建立未完成的销售单。
            </p>
          )}
        </Panel>
        <Panel title="运行配置与边界">
          <ul className="space-y-3 text-sm">
            <li>
              <b>模型：</b>从当前组织的 Model Gateway 绑定读取。
              <Link
                href={index?.configuration.model_settings_url ?? "/app/ai/models"}
                className="ml-2 text-accent underline"
              >
                配置组织模型
              </Link>
            </li>
            <li>
              <b>Jev：</b>
              {index
                ? index.configuration.jev_configured
                  ? "评测服务已配置，需要逐次确认分享分析材料。"
                  : "未配置；可继续使用规则分析，配置服务后可主动复核。"
                : "正在读取配置…"}
            </li>
            <li>
              <b>记忆：</b>按商品、仓库、供应商保存经人工确认的信息；当前库存始终读取账本。
            </li>
            <li>
              <b>业务写入：</b>当前分析只读。生成采购草稿时，服务端重新验证销售单与库存版本。
            </li>
            <li>
              <b>当前分析策略：</b>
              {index?.configuration.policy_revision ?? "正在读取…"}
            </li>
          </ul>
          <Button
            className="mt-3"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void load()}
          >
            刷新运行记录
          </Button>
        </Panel>
      </div>
      <Panel title="分析历史与证据">
        <Select
          label="查看运行记录"
          value={run?.id ?? ""}
          onChange={(id) => {
            setSelected(id);
            setSharing(false);
          }}
          required={false}
        >
          {runs.map((x) => (
            <option key={x.id} value={x.id}>
              {new Date(x.created_at).toLocaleString("zh-CN")} ·{" "}
              {x.mode === "rules" ? "规则" : "模型"} · {x.status === "completed" ? "完成" : "失败"}
            </option>
          ))}
        </Select>
        {run ? (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="rounded-full border px-3 py-1">
                订单 v{run.result.order_version}
              </span>
              <span className="rounded-full border px-3 py-1">
                缺口 {run.result.shortage_total} 件
              </span>
              <span className="rounded-full border px-3 py-1">
                {run.mode === "model"
                  ? run.status === "failed"
                    ? "模型请求未完成，规则数据仅供参考"
                    : "模型 Agent"
                  : "确定性规则分析"}
              </span>
              <span className="rounded-full border px-3 py-1">
                {run.status === "completed"
                  ? "运行完成"
                  : `运行失败：${run.error_code ?? "未知原因"}`}
              </span>
            </div>
            <Table
              headers={[
                "SKU",
                "待履约需求",
                "实物 / 总预占",
                "可用",
                "现货缺口 / 建议采购",
                "已有采购计划",
                "库存版本",
              ]}
            >
              {run.result.items.map((x) => (
                <tr key={x.line_id}>
                  <td>{x.sku}</td>
                  <td>{x.demand}</td>
                  <td>
                    {x.on_hand} / {x.reserved}
                  </td>
                  <td>{x.available}</td>
                  <td>
                    {x.shortage} / {x.suggested_quantity}
                  </td>
                  <td>{x.on_order}</td>
                  <td>v{x.stock_version}</td>
                </tr>
              ))}
            </Table>
            <div className="rounded-lg bg-muted/40 p-3">
              <p className="text-sm font-semibold">分析与下一步</p>
              <p className="mt-2 text-sm leading-relaxed whitespace-pre-wrap">{run.final_text}</p>
              <p className="mt-3 text-sm font-medium">{run.result.next_action}</p>
            </div>
            {run.result.warnings.length > 0 && (
              <ul className="space-y-1 rounded-lg border border-amber-500/30 p-3 text-sm">
                {run.result.warnings.map((x, i) => (
                  <li key={i}>• {x}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              估算金额 {money(run.result.estimated_cost_cents, run.result.currency)}
              ；价格依据请以分析提示与采购报价复核。证据指纹：
              <span className="break-all">{run.result.evidence_fingerprint}</span>。本次引用{" "}
              {run.memory_ids.length} 条已确认记忆。
            </p>
            <details className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">自精炼与 Probe 记录</summary>
              <p className="mt-2 text-sm">
                {run.refinement.enabled ? "已启用" : "未启用"} · {run.refinement.rounds} 轮 · 方法{" "}
                {run.refinement.method} · Probe{" "}
                {run.refinement.probe_passed ? "通过" : "未通过 / 未运行"} ·{" "}
                {run.refinement.reused_method ? "复用了历史方法" : "未复用历史方法"}
              </p>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {run.refinement.notes.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            </details>
            <div className="grid gap-4 lg:grid-cols-2">
              <DraftForm
                key={run.id}
                run={run}
                suppliers={suppliers}
                canWrite={canWrite && !busy}
                execute={execute}
                refresh={refresh}
              />
              <div className="rounded-lg border p-4">
                <h3 className="font-semibold">Jev 事后复核</h3>
                <p className="mt-2 text-sm text-muted-foreground">
                  只评估本次结果，不能批准采购或越过库存硬规则。当前固定策略阈值为
                  0.8，尚未用真实业务标注集校准，不能视为准确率。经理或管理员可发起复核。
                </p>
                {run.evaluation && (
                  <p className="mt-3 text-sm">
                    <b>{verdict[run.evaluation.verdict]}</b> · 置信度{" "}
                    {run.evaluation.confidence ?? "无"} · 阈值 {run.evaluation.threshold}
                    <span className="mt-1 block">{run.evaluation.reason}</span>
                  </p>
                )}
                <label className="mt-3 flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={sharing}
                    onChange={(e) => setSharing(e.target.checked)}
                    disabled={busy || !canReview}
                    className="mt-1"
                  />
                  <span>我确认将本次分析的订单、库存证据和输出材料交给已配置的 Jev 服务评测。</span>
                </label>
                <Button
                  className="mt-3"
                  variant="outline"
                  disabled={
                    busy ||
                    !canReview ||
                    !sharing ||
                    !index?.configuration.jev_configured ||
                    run.status !== "completed"
                  }
                  onClick={() =>
                    void work(async () => {
                      await request(`/api/v1/erp/analysis/${run.id}/review`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ share_material: true }),
                      });
                      await load();
                      setSharing(false);
                      setNotice(
                        "Jev 复核结果已保存。需要人工复核的结果请先检查证据再处理业务单据。",
                      );
                    })
                  }
                >
                  提交 Jev 复核
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            暂无分析记录。选择一张销售单开始分析。
          </p>
        )}
      </Panel>
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel
          title="人工确认业务记忆"
          note="经理或管理员确认稳定的业务事实、处理经验或注意事项。不要把此刻库存写成长期事实。"
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const el = e.currentTarget;
              const f = new FormData(el);
              const [scope_type, scope_id] = String(f.get("scope")).split(":");
              void work(async () => {
                await request("/api/v1/erp/analysis/memory", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    scope_type,
                    scope_id,
                    content: f.get("content"),
                    expires_at: new Date(String(f.get("expires"))).toISOString(),
                  }),
                });
                el.reset();
                await load();
                setNotice("记忆已确认保存。后续分析会按业务范围和有效期读取。");
              });
            }}
          >
            <fieldset disabled={busy || !canReview} className="space-y-3">
              <Select name="scope" label="记忆关联对象">
                {scopes.map((x) => (
                  <option key={`${x.type}:${x.id}`} value={`${x.type}:${x.id}`}>
                    {x.label}
                  </option>
                ))}
              </Select>
              <Field label="已核实的内容">
                <textarea
                  name="content"
                  minLength={4}
                  maxLength={1200}
                  required
                  rows={4}
                  className="w-full rounded-md border bg-surface p-3 text-sm"
                  placeholder="例如：供应商周一至周五发货，节假日前需要提前确认。"
                />
              </Field>
              <Field label="到期复核时间">
                <Input name="expires" type="datetime-local" defaultValue={expiry} required />
              </Field>
              <Button type="submit">确认并保存记忆</Button>
            </fieldset>
          </form>
        </Panel>
        <Panel title="有效记忆与撤回">
          <ul className="space-y-3">
            {memories.map((x) => (
              <li className="rounded-lg border p-3" key={x.id}>
                <p className="text-xs font-medium text-muted-foreground">
                  {scopes.find((s) => s.id === x.scope_id && s.type === x.scope_type)?.label}
                </p>
                <p className="mt-2 text-sm whitespace-pre-wrap">{x.content}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  有效至 {new Date(x.expires_at).toLocaleString("zh-CN")}
                </p>
                <Button
                  size="sm"
                  className="mt-2"
                  variant="outline"
                  disabled={busy || !canReview}
                  onClick={() =>
                    void work(async () => {
                      await request(`/api/v1/erp/analysis/memory?id=${encodeURIComponent(x.id)}`, {
                        method: "DELETE",
                      });
                      await load();
                      setNotice("记忆已撤回，后续分析不会继续引用。");
                    })
                  }
                >
                  撤回该记忆
                </Button>
              </li>
            ))}
          </ul>
          {!memories.length && (
            <p className="text-sm text-muted-foreground">
              当前主体暂无有效记忆。确认业务依据后可以在左侧登记。
            </p>
          )}
        </Panel>
      </div>
    </div>
  );
}

function DraftForm({
  run,
  suppliers,
  canWrite,
  execute,
  refresh,
}: {
  run: ErpAnalysisRun;
  suppliers: ErpSnapshot["suppliers"];
  canWrite: boolean;
  execute: (command: Record<string, unknown>) => Promise<boolean>;
  refresh: () => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState(false);
  const lock = useRef(false);
  const proposed = run.result.items.filter((x) => x.suggested_quantity > 0);
  return (
    <form
      className="rounded-lg border p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (lock.current) return;
        const f = new FormData(e.currentTarget);
        lock.current = true;
        setPending(true);
        try {
          const ok = await execute({
            action: "purchase_create",
            warehouse_id: run.result.warehouse_id,
            supplier_id: f.get("supplier"),
            sales_order_id: run.order_id,
            source_order_version: run.result.order_version,
            source_stock_versions: [
              ...new Map(proposed.map((x) => [x.product_id, x])).values(),
            ].map((x) => ({
              product_id: x.product_id,
              version: x.stock_version,
            })),
            lines: proposed.map((x) => ({
              product_id: x.product_id,
              quantity: x.suggested_quantity,
              unit_price_cents: Math.round(Number(f.get(`price_${x.product_id}`)) * 100),
            })),
          });
          if (ok) {
            setCreated(true);
            await refresh();
          }
        } finally {
          lock.current = false;
          setPending(false);
        }
      }}
    >
      <h3 className="font-semibold">从建议建立采购草稿</h3>
      <p className="mt-2 text-sm text-muted-foreground">
        确认供应商和实际报价后保存；证据过期时须重新分析。后续到“销售与采购”继续提交审批。
      </p>
      <fieldset
        disabled={!canWrite || pending || created || !proposed.length || run.status !== "completed"}
        className="mt-3 space-y-3"
      >
        <Select name="supplier" label="本次采购供应商">
          {suppliers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · 常规 {x.lead_time_days} 天
            </option>
          ))}
        </Select>
        {proposed.map((x) => (
          <Field label={`${x.sku} · ${x.suggested_quantity} 件 · 确认采购单价`} key={x.product_id}>
            <Input
              name={`price_${x.product_id}`}
              type="number"
              min={0}
              max={10_000_000}
              step="0.01"
              defaultValue={x.unit_price_cents / 100}
              required
            />
          </Field>
        ))}
        <Button type="submit">{pending ? "正在保存…" : "确认生成采购草稿"}</Button>
      </fieldset>
      {created && (
        <p role="status" className="mt-3 text-sm">
          采购草稿已生成，请到“销售与采购”处理；如需继续补货，请重新分析现有采购计划。
        </p>
      )}
      {!proposed.length && (
        <p className="mt-3 text-sm text-muted-foreground">本次分析没有建议采购的商品。</p>
      )}
    </form>
  );
}

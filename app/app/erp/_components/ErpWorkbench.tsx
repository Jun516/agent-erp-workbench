"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  erpCommandSchema,
  type ErpCommand,
  type ErpDocument,
  type ErpSnapshot,
} from "@/lib/erp/contracts";
import { AgentPanel } from "./AgentPanel";

type Tab = "overview" | "documents" | "stock" | "masters" | "finance" | "agent" | "audit";
const tabs: [Tab, string][] = [
  ["overview", "经营概览"],
  ["documents", "销售与采购"],
  ["stock", "库存作业"],
  ["masters", "基础资料与权限"],
  ["finance", "应收应付"],
  ["agent", "Agent 分析与记忆"],
  ["audit", "操作记录"],
];
export const statusName: Record<string, string> = {
  draft: "草稿",
  pending: "待审批",
  approved: "已批准",
  open: "待履约",
  partial: "部分履约",
  completed: "已完成",
  cancelled: "已取消",
};
const inputClass =
  "min-h-10 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50";
export const money = (value: number, currency = "CNY") =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency }).format(value / 100);
const date = (value: string) => new Date(value).toLocaleString("zh-CN", { hour12: false });
const text = (form: FormData, key: string) => String(form.get(key) ?? "").trim();
const num = (form: FormData, key: string) => Number(form.get(key));
export function Panel({
  title,
  children,
  note,
}: {
  title: string;
  children: ReactNode;
  note?: string;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-4 md:p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && <p className="mt-1 text-sm text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
    </label>
  );
}
export function Select({
  name,
  label,
  value,
  onChange,
  children,
  required = true,
}: {
  name?: string;
  label?: string;
  value?: string;
  onChange?: (value: string) => void;
  children: ReactNode;
  required?: boolean;
}) {
  const el = (
    <select
      className={inputClass}
      name={name}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      required={required}
      aria-label={label}
    >
      <option value="">请选择</option>
      {children}
    </select>
  );
  return label ? <Field label={label}>{el}</Field> : el;
}
export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b text-muted-foreground">
            {headers.map((x) => (
              <th className="p-2 font-medium whitespace-nowrap" key={x}>
                {x}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:p-2 [&_tr]:border-b [&_tr:last-child]:border-0">{children}</tbody>
      </table>
    </div>
  );
}
export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init });
  const body = (await response.json().catch(() => null)) as {
    data?: T;
    error?: { message?: string; code?: string };
  } | null;
  if (!response.ok || !body || !("data" in body))
    throw new Error(
      body?.error?.message ?? `请求失败（HTTP ${response.status}），请检查网络或联系管理员。`,
    );
  return body.data as T;
}

/** Keep the synchronous double-submit lock inside the event callback. */
function useExclusiveCommand(
  run: (raw: Record<string, unknown>, prior?: ErpCommand) => Promise<boolean>,
) {
  const lock = useRef(false);
  return useCallback(
    async (raw: Record<string, unknown>, prior?: ErpCommand) => {
      if (lock.current) return false;
      lock.current = true;
      try {
        return await run(raw, prior);
      } finally {
        lock.current = false;
      }
    },
    [run],
  );
}

export function ErpWorkbench({
  canWrite,
  workspaceName,
  actorId,
}: {
  canWrite: boolean;
  workspaceName: string;
  actorId: string;
}) {
  const [tab, setTab] = useState<Tab>("overview");
  const [snapshot, setSnapshot] = useState<ErpSnapshot | null>(null);
  const [company, setCompany] = useState("");
  const [warehouseChoice, setWarehouse] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [retry, setRetry] = useState<ErpCommand | null>(null);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<ErpSnapshot>("/api/v1/erp");
      setSnapshot(data);
      setCompany((current) =>
        data.companies.some((x) => x.id === current) ? current : (data.companies[0]?.id ?? ""),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "ERP 数据加载失败");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void request<ErpSnapshot>("/api/v1/erp", { signal: controller.signal })
      .then((data) => {
        setSnapshot(data);
        setCompany(data.companies[0]?.id ?? "");
        setError("");
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : "ERP 数据加载失败");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, []);
  const warehouse = snapshot?.warehouses.some(
    (x) => x.id === warehouseChoice && x.company_id === company,
  )
    ? warehouseChoice
    : (snapshot?.warehouses.find((x) => x.company_id === company)?.id ?? "");
  const execute = useExclusiveCommand(
    async (raw: Record<string, unknown>, prior?: ErpCommand): Promise<boolean> => {
      if (!canWrite) return false;
      const parsed = erpCommandSchema.safeParse(
        prior ?? { ...raw, idempotency_key: crypto.randomUUID() },
      );
      if (!parsed.success) {
        setError(
          `请检查表单：${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("；")}`,
        );
        return false;
      }
      setBusy(true);
      setError("");
      setNotice("");
      try {
        const result = await request<{ replayed: boolean }>("/api/v1/erp/commands", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed.data),
        });
        setRetry(null);
        setNotice(
          result.replayed
            ? "已确认上次操作已入账，本次没有重复执行。"
            : "操作已入账，库存、单据和审计记录已更新。复核数据后可继续下一步。",
        );
        await load();
        return true;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "操作失败");
        setRetry(parsed.data);
        return false;
      } finally {
        setBusy(false);
      }
    },
  );
  const canManage = canWrite && ["manager", "admin"].includes(snapshot?.actor_role ?? "");
  const products = snapshot?.products.filter((x) => x.company_id === company) ?? [];
  const warehouses = snapshot?.warehouses.filter((x) => x.company_id === company) ?? [];
  const documents = snapshot?.documents.filter((x) => x.company_id === company) ?? [];
  const productName = (id: string) => {
    const p = snapshot?.products.find((x) => x.id === id);
    return p ? `${p.sku} · ${p.name}` : id;
  };
  const warehouseName = (id: string) => snapshot?.warehouses.find((x) => x.id === id)?.name ?? id;
  const submit =
    (fn: (form: FormData) => Record<string, unknown>) =>
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      if (await execute(fn(new FormData(form)))) form.reset();
    };
  const orderLines = (id: string) => snapshot?.lines.filter((x) => x.document_id === id) ?? [];
  const shortages = documents
    .filter((x) => x.kind === "sale" && !["completed", "cancelled"].includes(x.status))
    .map((doc) => ({
      doc,
      shortage: orderLines(doc.id).reduce((sum, line) => {
        const balance = snapshot?.balances.find(
          (x) => x.product_id === line.product_id && x.warehouse_id === doc.warehouse_id,
        );
        return (
          sum +
          Math.max(0, line.quantity - line.processed - line.reserved - (balance?.available ?? 0))
        );
      }, 0),
    }));
  return (
    <div className="mx-auto w-full max-w-7xl space-y-5 pb-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-muted-foreground">{workspaceName} / 业务账本</p>
          <h1 className="mt-1 text-2xl font-bold md:text-3xl">ERP 经营工作台</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            从销售需求到采购入库、库存预占和发货，沿着真实单据完成履约。
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading || busy}>
          {" "}
          {loading ? "正在刷新…" : "刷新账本"}
        </Button>
      </header>
      <div className="grid gap-3 rounded-xl border bg-card p-4 md:grid-cols-3">
        <Select label="经营主体" value={company} onChange={setCompany} required={false}>
          {snapshot?.companies.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name} · {x.currency}
            </option>
          ))}
        </Select>
        <Select label="当前仓库" value={warehouse} onChange={setWarehouse} required={false}>
          {warehouses.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </Select>
        <div className="self-end text-sm text-muted-foreground">
          {canWrite
            ? "当前可提交业务操作；每次操作由服务端复核仓库权限与审批条件。"
            : "当前为只读权限，请联系管理员授权业务操作。"}
          <p className="mt-1">
            客户信息仍可在{" "}
            <Link href="/app/contacts" className="text-accent underline">
              CRM 客户管理
            </Link>{" "}
            中维护。
          </p>
        </div>
      </div>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm"
        >
          <p>{error}</p>
          {retry && (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void execute({}, retry)}
              >
                核对并重试上次操作
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setRetry(null);
                  setError("");
                }}
              >
                关闭重试提示
              </Button>
            </div>
          )}
          <p className="mt-2 text-muted-foreground">
            网络中断时，重试会沿用同一个业务请求编号，避免重复入账。版本冲突请刷新后重新提交。
          </p>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm"
        >
          {notice}
        </p>
      )}
      <nav aria-label="ERP 功能" className="flex gap-1 overflow-x-auto border-b pb-2">
        {tabs.map(([id, label]) => (
          <Button
            key={id}
            size="sm"
            variant={tab === id ? "primary" : "ghost"}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </Button>
        ))}
      </nav>
      {!snapshot ? (
        <Panel title={loading ? "正在读取 ERP 账本…" : "账本暂时不可用"}>
          <p className="text-sm text-muted-foreground">
            {loading
              ? "从当前组织的数据库读取公司、仓库和单据。"
              : "请检查数据库迁移和当前组织权限，然后点击刷新账本。"}
          </p>
        </Panel>
      ) : (
        <>
          {!company && tab !== "masters" && (
            <Panel title="先建立经营主体">
              <p className="text-sm text-muted-foreground">
                首次使用：创建公司 → 仓库、供应商和 SKU → 登记期初库存 →
                新建销售订单。所有步骤都在当前工作台完成。
              </p>
              <Button className="mt-3" onClick={() => setTab("masters")}>
                开始建档
              </Button>
            </Panel>
          )}
          {tab === "overview" && (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["待履约销售", shortages.length],
                  ["存在缺口的销售", shortages.filter((x) => x.shortage > 0).length],
                  [
                    "待审批采购",
                    documents.filter((x) => x.kind === "purchase" && x.status === "pending").length,
                  ],
                  [
                    "待收货采购",
                    documents.filter(
                      (x) => x.kind === "purchase" && ["open", "partial"].includes(x.status),
                    ).length,
                  ],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border bg-card p-4">
                    <p className="text-sm text-muted-foreground">{label}</p>
                    <p className="mt-2 text-3xl font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <Panel
                title="需要处理的销售需求"
                note="缺口按每张订单独立试算；多个订单竞争同一库存时，以数据库实际预占结果为准。预占不等于发货。"
              >
                <Table headers={["销售单", "客户 / 仓库", "状态", "当前缺口", "下一步"]}>
                  {shortages.map(({ doc, shortage }) => (
                    <tr key={doc.id}>
                      <td>{doc.number}</td>
                      <td>
                        {doc.customer_name}
                        <p className="text-xs text-muted-foreground">
                          {warehouseName(doc.warehouse_id)}
                        </p>
                      </td>
                      <td>{statusName[doc.status]}</td>
                      <td className={shortage > 0 ? "font-semibold text-amber-600" : ""}>
                        {shortage}
                      </td>
                      <td>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setTab(shortage > 0 ? "agent" : "documents")}
                        >
                          {shortage > 0 ? "分析缺口与补货" : "预占 / 发货"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </Table>
                {!shortages.length && (
                  <p className="py-4 text-sm text-muted-foreground">
                    暂无待履约订单。在“销售与采购”创建销售需求后，这里会显示下一步。
                  </p>
                )}
              </Panel>
              <Panel title="业务流程">
                <ol className="grid gap-3 text-sm sm:grid-cols-3">
                  <li>
                    <b>1. 需求与分析</b>
                    <p className="mt-1 text-muted-foreground">
                      创建销售单，Agent 读取库存和历史记忆，计算缺口。
                    </p>
                  </li>
                  <li>
                    <b>2. 采购与收货</b>
                    <p className="mt-1 text-muted-foreground">
                      建立采购草稿，提交审批、下单；实物到仓后按明细收货。
                    </p>
                  </li>
                  <li>
                    <b>3. 履约与回查</b>
                    <p className="mt-1 text-muted-foreground">
                      预占库存后发货，登记核销；差错通过退货或调整单纠正。
                    </p>
                  </li>
                </ol>
              </Panel>
            </>
          )}
          {tab === "masters" && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title="建立经营主体" note="公司拥有独立币种和采购审批策略。">
                <form
                  className="space-y-3"
                  onSubmit={submit((f) => ({
                    action: "company_create",
                    name: text(f, "name"),
                    currency: text(f, "currency"),
                  }))}
                >
                  <fieldset disabled={!canManage || busy} className="space-y-3">
                    <Field label="公司名称">
                      <Input name="name" required maxLength={160} />
                    </Field>
                    <Select name="currency" label="记账币种">
                      <option value="CNY">CNY 人民币</option>
                      <option value="USD">USD 美元</option>
                      <option value="EUR">EUR 欧元</option>
                      <option value="BRL">BRL 雷亚尔</option>
                    </Select>
                    <Button type="submit">创建公司</Button>
                  </fieldset>
                </form>
              </Panel>
              <Panel title="当前公司资料">
                <ul className="space-y-2 text-sm">
                  {snapshot.companies.map((x) => (
                    <li key={x.id}>
                      <b>{x.name}</b> · {x.currency} · 审批限额{" "}
                      {money(x.approval_limit_cents, x.currency)} ·{" "}
                      {x.allow_self_approval ? "允许同人审批" : "申请与审批分离"}
                    </li>
                  ))}
                </ul>
                {!company && (
                  <p className="text-sm text-muted-foreground">
                    创建公司后可继续维护仓库、SKU 与采购策略。
                  </p>
                )}
              </Panel>
              {company && (
                <>
                  <Panel title="创建仓库">
                    <form
                      onSubmit={submit((f) => ({
                        action: "warehouse_create",
                        company_id: company,
                        name: text(f, "name"),
                      }))}
                    >
                      <fieldset disabled={!canManage || busy} className="space-y-3">
                        <Field label="仓库名称">
                          <Input name="name" required maxLength={160} />
                        </Field>
                        <Button type="submit">创建仓库</Button>
                      </fieldset>
                    </form>
                    <ul className="mt-3 space-y-1 text-sm">
                      {warehouses.map((x) => (
                        <li key={x.id}>{x.name}</li>
                      ))}
                    </ul>
                  </Panel>
                  <Panel title="创建供应商">
                    <form
                      onSubmit={submit((f) => ({
                        action: "supplier_create",
                        company_id: company,
                        name: text(f, "name"),
                        lead_time_days: num(f, "lead_time_days"),
                      }))}
                    >
                      <fieldset disabled={!canManage || busy} className="space-y-3">
                        <Field label="供应商名称">
                          <Input name="name" required maxLength={160} />
                        </Field>
                        <Field label="常规供货周期（天）">
                          <Input
                            name="lead_time_days"
                            type="number"
                            min={0}
                            max={365}
                            defaultValue={7}
                            required
                          />
                        </Field>
                        <Button type="submit">创建供应商</Button>
                      </fieldset>
                    </form>
                    <ul className="mt-3 text-sm">
                      {snapshot.suppliers
                        .filter((x) => x.company_id === company)
                        .map((x) => (
                          <li key={x.id}>
                            {x.name} · {x.lead_time_days} 天
                          </li>
                        ))}
                    </ul>
                  </Panel>
                  <Panel title="创建商品 SKU">
                    <form
                      onSubmit={submit((f) => ({
                        action: "product_create",
                        company_id: company,
                        sku: text(f, "sku"),
                        name: text(f, "name"),
                        unit: text(f, "unit"),
                      }))}
                    >
                      <fieldset disabled={!canManage || busy} className="space-y-3">
                        <Field label="SKU 编码">
                          <Input name="sku" required maxLength={160} />
                        </Field>
                        <Field label="商品名称">
                          <Input name="name" required maxLength={160} />
                        </Field>
                        <Field label="计量单位">
                          <Input name="unit" defaultValue="件" required maxLength={20} />
                        </Field>
                        <Button type="submit">创建 SKU</Button>
                      </fieldset>
                    </form>
                    <ul className="mt-3 text-sm">
                      {products.map((x) => (
                        <li key={x.id}>
                          {x.sku} · {x.name}（{x.unit}）
                        </li>
                      ))}
                    </ul>
                  </Panel>
                  <Panel
                    title="采购审批策略"
                    note="经理或管理员可修改。允许同人审批适合单人本地演练；多人业务建议保持申请与审批分离。"
                  >
                    <form
                      key={company + snapshot.companies.find((x) => x.id === company)?.version}
                      onSubmit={submit((f) => ({
                        action: "company_policy",
                        company_id: company,
                        allow_self_approval: f.has("self"),
                        approval_limit_cents: Math.round(num(f, "limit") * 100),
                      }))}
                    >
                      <fieldset disabled={!canManage || busy} className="space-y-3">
                        <Field label="单笔采购审批限额（当前币种）">
                          <Input
                            name="limit"
                            type="number"
                            min={0}
                            max={10000000}
                            step="0.01"
                            defaultValue={
                              (snapshot.companies.find((x) => x.id === company)
                                ?.approval_limit_cents ?? 0) / 100
                            }
                            required
                          />
                        </Field>
                        <label className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            name="self"
                            defaultChecked={
                              snapshot.companies.find((x) => x.id === company)
                                ?.allow_self_approval ?? false
                            }
                          />
                          允许申请人审批自己的采购单
                        </label>
                        <Button type="submit">保存审批策略</Button>
                      </fieldset>
                    </form>
                  </Panel>
                  <Panel
                    title="仓库作业授权"
                    note="经理或管理员可授权。被授权人必须是当前组织成员；当前用户 ID 仅用于复制到测试表单。"
                  >
                    <p className="mb-3 text-xs break-all text-muted-foreground">
                      当前用户 ID：{actorId}
                    </p>
                    <form
                      onSubmit={submit((f) => ({
                        action: "access_grant",
                        warehouse_id: text(f, "warehouse"),
                        user_id: text(f, "user"),
                        can_purchase: f.has("purchase"),
                        can_receive: f.has("receive"),
                        can_ship: f.has("ship"),
                      }))}
                    >
                      <fieldset disabled={!canManage || busy} className="space-y-3">
                        <Select name="warehouse" label="授权仓库">
                          {warehouses.map((x) => (
                            <option value={x.id} key={x.id}>
                              {x.name}
                            </option>
                          ))}
                        </Select>
                        <Field label="组织成员用户 ID">
                          <Input name="user" required placeholder="UUID" />
                        </Field>
                        <div className="flex flex-wrap gap-4 text-sm">
                          {[
                            ["purchase", "采购"],
                            ["receive", "收货"],
                            ["ship", "发货"],
                          ].map(([n, label]) => (
                            <label key={n} className="flex gap-2">
                              <input type="checkbox" name={n} />
                              {label}
                            </label>
                          ))}
                        </div>
                        <Button type="submit">保存仓库权限</Button>
                      </fieldset>
                    </form>
                    <ul className="mt-3 space-y-2 text-xs break-all text-muted-foreground">
                      {snapshot.access
                        .filter((x) => warehouses.some((w) => w.id === x.warehouse_id))
                        .map((x) => (
                          <li key={`${x.warehouse_id}-${x.user_id}`}>
                            {warehouseName(x.warehouse_id)} / {x.user_id}：
                            {x.can_purchase && "采购 "}
                            {x.can_receive && "收货 "}
                            {x.can_ship && "发货"}
                          </li>
                        ))}
                    </ul>
                  </Panel>
                </>
              )}
            </div>
          )}
          {tab === "documents" && company && (
            <Documents
              snapshot={snapshot}
              company={company}
              warehouse={warehouse}
              busy={busy || !canWrite}
              execute={execute}
              productName={productName}
            />
          )}
          {tab === "stock" && company && (
            <>
              <Panel
                title="仓库库存"
                note="可用库存 = 实物库存 − 已预占。采购下单不增加实物库存；实物签收才入账。"
              >
                <Table headers={["SKU / 商品", "仓库", "实物", "预占", "可用", "版本"]}>
                  {snapshot.balances
                    .filter((x) => x.warehouse_id === warehouse)
                    .map((x) => (
                      <tr key={`${x.warehouse_id}-${x.product_id}`}>
                        <td>{productName(x.product_id)}</td>
                        <td>{warehouseName(x.warehouse_id)}</td>
                        <td>{x.on_hand}</td>
                        <td>{x.reserved}</td>
                        <td className="font-semibold">{x.available}</td>
                        <td>v{x.version}</td>
                      </tr>
                    ))}
                </Table>
              </Panel>
              <div className="grid gap-4 lg:grid-cols-2">
                <Panel title="登记期初库存" note="只用于初始化；日常差异使用库存调整并写明原因。">
                  <form
                    onSubmit={submit((f) => ({
                      action: "opening_stock",
                      warehouse_id: warehouse,
                      product_id: text(f, "product"),
                      quantity: num(f, "quantity"),
                      reason: text(f, "reason"),
                    }))}
                  >
                    <fieldset disabled={busy || !canManage || !warehouse} className="space-y-3">
                      <ProductSelect products={products} />
                      <NumberField name="quantity" label="期初数量" />
                      <Field label="期初依据">
                        <Input
                          name="reason"
                          required
                          maxLength={160}
                          placeholder="如：建账盘点单 INIT-001"
                        />
                      </Field>
                      <Button type="submit">登记期初</Button>
                    </fieldset>
                  </form>
                </Panel>
                <Panel
                  title="库存调拨 / 调整"
                  note="调拨在一个事务中同步出入两个仓库。调整不能侵占已预占库存。"
                >
                  <StockForm
                    canManage={canManage}
                    products={products}
                    warehouses={warehouses}
                    warehouse={warehouse}
                    disabled={busy || !canWrite || !warehouse}
                    execute={execute}
                  />
                </Panel>
              </div>
              <Panel title="库存流水">
                <Table headers={["时间", "商品 / 仓库", "类型 / 原因", "实物变化", "预占变化"]}>
                  {snapshot.ledger
                    .filter((x) => x.warehouse_id === warehouse)
                    .map((x) => (
                      <tr key={x.id}>
                        <td className="whitespace-nowrap">{date(x.created_at)}</td>
                        <td>
                          {productName(x.product_id)}
                          <p className="text-xs text-muted-foreground">
                            {warehouseName(x.warehouse_id)}
                          </p>
                        </td>
                        <td>
                          {x.kind}
                          <p className="text-xs text-muted-foreground">{x.reason}</p>
                        </td>
                        <td>
                          {x.quantity_delta > 0 ? "+" : ""}
                          {x.quantity_delta}
                        </td>
                        <td>
                          {x.reserved_delta > 0 ? "+" : ""}
                          {x.reserved_delta}
                        </td>
                      </tr>
                    ))}
                </Table>
              </Panel>
            </>
          )}
          {tab === "finance" && (
            <Panel
              title="应收 / 应付与手工核销"
              note="按实际收货、发货记账；这里只登记线下收付款凭证，不会发起银行付款。"
            >
              <Table headers={["关联单据", "方向", "已记账 / 已核销", "剩余", "核销记录"]}>
                {snapshot.settlements
                  .filter((x) => documents.some((d) => d.id === x.document_id))
                  .map((x) => (
                    <tr key={x.id}>
                      <td>{documents.find((d) => d.id === x.document_id)?.number}</td>
                      <td>{x.direction === "receivable" ? "应收" : "应付"}</td>
                      <td>
                        {money(x.amount_cents, x.currency)} / {money(x.settled_cents, x.currency)}
                      </td>
                      <td>{money(x.amount_cents - x.settled_cents, x.currency)}</td>
                      <td>
                        {x.amount_cents > x.settled_cents && (
                          <form
                            onSubmit={submit((f) => ({
                              action: "settlement_record",
                              id: x.id,
                              expected_version: x.version,
                              amount_cents: Math.round(num(f, "amount") * 100),
                              reference: text(f, "reference"),
                            }))}
                          >
                            <fieldset disabled={!canManage || busy} className="grid min-w-64 gap-2">
                              <Input
                                name="amount"
                                aria-label={`核销金额 ${x.id}`}
                                type="number"
                                min="0.01"
                                max={(x.amount_cents - x.settled_cents) / 100}
                                step="0.01"
                                placeholder="核销金额"
                                required
                              />
                              <Input
                                name="reference"
                                aria-label={`凭证 ${x.id}`}
                                placeholder="收付款凭证号"
                                required
                                maxLength={160}
                              />
                              <Button size="sm" type="submit">
                                登记核销
                              </Button>
                            </fieldset>
                          </form>
                        )}
                      </td>
                    </tr>
                  ))}
              </Table>
              {!snapshot.settlements.length && (
                <p className="mt-4 text-sm text-muted-foreground">
                  完成采购收货或销售发货后，这里会产生相应账款。
                </p>
              )}
            </Panel>
          )}
          {tab === "agent" && company && (
            <AgentPanel
              snapshot={snapshot}
              company={company}
              canWrite={canWrite}
              refresh={load}
              execute={execute}
            />
          )}
          {tab === "audit" && (
            <Panel
              title="业务操作审计"
              note="实际入账操作在同一数据库事务中写入审计。幂等重试不会重复改变库存。"
            >
              <Table headers={["时间", "操作", "对象", "操作者"]}>
                {snapshot.audit.map((x) => (
                  <tr key={x.id}>
                    <td className="whitespace-nowrap">{date(x.created_at)}</td>
                    <td>{x.action}</td>
                    <td className="max-w-64 break-all">
                      {x.resource_id ?? "—"}
                      <details>
                        <summary className="cursor-pointer text-xs text-muted-foreground">
                          查看记录
                        </summary>
                        <pre className="max-w-sm overflow-auto text-xs whitespace-pre-wrap">
                          {JSON.stringify(x.details, null, 2)}
                        </pre>
                      </details>
                    </td>
                    <td className="text-xs break-all">{x.actor_id}</td>
                  </tr>
                ))}
              </Table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

type Execute = (command: Record<string, unknown>) => Promise<boolean>;
function NumberField({
  name,
  label,
  min = 1,
  value,
}: {
  name: string;
  label: string;
  min?: number;
  value?: number;
}) {
  return (
    <Field label={label}>
      <Input
        name={name}
        type="number"
        min={min}
        max={1_000_000}
        step={1}
        defaultValue={value}
        required
      />
    </Field>
  );
}
function ProductSelect({
  products,
  name = "product",
}: {
  products: ErpSnapshot["products"];
  name?: string;
}) {
  return (
    <Select name={name} label="商品 SKU">
      {products.map((x) => (
        <option key={x.id} value={x.id}>
          {x.sku} · {x.name}
        </option>
      ))}
    </Select>
  );
}
function StockForm({
  canManage,
  products,
  warehouses,
  warehouse,
  disabled,
  execute,
}: {
  canManage: boolean;
  products: ErpSnapshot["products"];
  warehouses: ErpSnapshot["warehouses"];
  warehouse: string;
  disabled: boolean;
  execute: Execute;
}) {
  const [mode, setMode] = useState("stock_transfer");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const el = e.currentTarget;
        const f = new FormData(el);
        const base = {
          action: mode,
          warehouse_id: warehouse,
          product_id: text(f, "product"),
          reason: text(f, "reason"),
        };
        if (
          await execute(
            mode === "stock_transfer"
              ? { ...base, target_warehouse_id: text(f, "target"), quantity: num(f, "quantity") }
              : { ...base, delta: num(f, "delta") },
          )
        )
          el.reset();
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <Select label="作业类型" value={mode} onChange={setMode}>
          <option value="stock_transfer">仓库调拨</option>
          <option value="stock_adjust" disabled={!canManage}>
            盘点调整（经理或管理员）
          </option>
        </Select>
        <ProductSelect products={products} />
        {mode === "stock_transfer" ? (
          <>
            <Select name="target" label="调入仓库">
              {warehouses
                .filter((x) => x.id !== warehouse)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </Select>
            <NumberField name="quantity" label="调拨数量" />
          </>
        ) : (
          <NumberField name="delta" label="调整数量（正数增加，负数减少）" min={-1_000_000} />
        )}
        <Field label="作业原因">
          <Input name="reason" required maxLength={160} />
        </Field>
        <Button type="submit">提交库存作业</Button>
      </fieldset>
    </form>
  );
}

function Documents({
  snapshot,
  company,
  warehouse,
  busy,
  execute,
  productName,
}: {
  snapshot: ErpSnapshot;
  company: string;
  warehouse: string;
  busy: boolean;
  execute: Execute;
  productName: (id: string) => string;
}) {
  const [kind, setKind] = useState("sale");
  const [lineCount, setLineCount] = useState(1);
  const [selected, setSelected] = useState("");
  const products = snapshot.products.filter((x) => x.company_id === company);
  const docs = snapshot.documents.filter((x) => x.company_id === company);
  const doc = docs.find((x) => x.id === selected);
  const lines = doc ? snapshot.lines.filter((x) => x.document_id === doc.id) : [];
  return (
    <div className="space-y-4">
      <Panel
        title="创建业务单据"
        note="单价按当前公司的记账币种填写，金额精确到分。采购与销售均支持多条商品明细。"
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const el = e.currentTarget;
            const f = new FormData(el);
            const rows = Array.from({ length: lineCount }, (_, i) => ({
              product_id: text(f, `product_${i}`),
              quantity: num(f, `quantity_${i}`),
              unit_price_cents: Math.round(num(f, `price_${i}`) * 100),
            }));
            const due = text(f, "due");
            const salesOrder = docs.find((x) => x.id === text(f, "sales_order"));
            const command = {
              action: kind === "sale" ? "sale_create" : "purchase_create",
              warehouse_id: warehouse,
              lines: rows,
              ...(due ? { due_at: new Date(due).toISOString() } : {}),
              ...(kind === "sale"
                ? { customer_name: text(f, "customer") }
                : {
                    supplier_id: text(f, "supplier"),
                    ...(salesOrder
                      ? {
                          sales_order_id: salesOrder.id,
                          source_order_version: salesOrder.version,
                          source_stock_versions: [
                            ...new Map(rows.map((row) => [row.product_id, row])).values(),
                          ].map((row) => ({
                            product_id: row.product_id,
                            version:
                              snapshot.balances.find(
                                (x) =>
                                  x.product_id === row.product_id && x.warehouse_id === warehouse,
                              )?.version ?? 0,
                          })),
                        }
                      : {}),
                  }),
            };
            if (await execute(command)) {
              el.reset();
              setLineCount(1);
            }
          }}
        >
          <fieldset disabled={busy || !warehouse} className="space-y-4">
            <div className="grid gap-3 md:grid-cols-3">
              <Select label="单据类型" value={kind} onChange={setKind}>
                <option value="sale">销售订单</option>
                <option value="purchase">采购草稿</option>
              </Select>
              {kind === "sale" ? (
                <Field label="客户名称">
                  <Input name="customer" required maxLength={160} />
                </Field>
              ) : (
                <Select name="supplier" label="供应商">
                  {snapshot.suppliers
                    .filter((x) => x.company_id === company)
                    .map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                </Select>
              )}
              <Field label="约定日期（可选）">
                <Input name="due" type="datetime-local" />
              </Field>
            </div>
            {kind === "purchase" && (
              <Select name="sales_order" label="关联销售单（可选）" required={false}>
                {docs
                  .filter(
                    (x) =>
                      x.kind === "sale" &&
                      x.warehouse_id === warehouse &&
                      !["completed", "cancelled"].includes(x.status),
                  )
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.number} · {x.customer_name}
                    </option>
                  ))}
              </Select>
            )}
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i} className="grid gap-3 rounded-lg border p-3 md:grid-cols-3">
                <ProductSelect products={products} name={`product_${i}`} />
                <NumberField name={`quantity_${i}`} label={`明细 ${i + 1} 数量`} />
                <Field label={`明细 ${i + 1} 单价`}>
                  <Input
                    name={`price_${i}`}
                    type="number"
                    min={0}
                    max={10_000_000}
                    step="0.01"
                    required
                  />
                </Field>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setLineCount((n) => n + 1)}
                disabled={lineCount >= 100}
              >
                添加商品明细
              </Button>
              {lineCount > 1 && (
                <Button type="button" variant="ghost" onClick={() => setLineCount((n) => n - 1)}>
                  移除最后一行
                </Button>
              )}
              <Button type="submit">{kind === "sale" ? "创建销售订单" : "保存采购草稿"}</Button>
            </div>
          </fieldset>
        </form>
      </Panel>
      <Panel title="单据列表">
        <Table headers={["单据", "类型 / 对方", "金额", "状态 / 版本", "处理"]}>
          {docs.map((x) => (
            <tr key={x.id}>
              <td>
                {x.number}
                <p className="text-xs text-muted-foreground">
                  {snapshot.warehouses.find((w) => w.id === x.warehouse_id)?.name}
                </p>
              </td>
              <td>
                {x.kind === "sale" ? "销售" : "采购"} ·{" "}
                {x.customer_name ?? snapshot.suppliers.find((s) => s.id === x.supplier_id)?.name}
              </td>
              <td>{money(x.total_cents, x.currency)}</td>
              <td>
                {statusName[x.status]} · v{x.version}
              </td>
              <td>
                <Button
                  size="sm"
                  variant={selected === x.id ? "primary" : "outline"}
                  onClick={() => setSelected(x.id)}
                >
                  查看与处理
                </Button>
              </td>
            </tr>
          ))}
        </Table>
        {!docs.length && (
          <p className="mt-3 text-sm text-muted-foreground">
            暂无单据。请先创建一张销售订单或采购草稿。
          </p>
        )}
      </Panel>
      {doc && (
        <Panel title={`${doc.number} · ${statusName[doc.status]}`} note={nextStep(doc)}>
          <Table headers={["商品", "数量", "已处理", "已预占", "已退货"]}>
            {lines.map((x) => (
              <tr key={x.id}>
                <td>{productName(x.product_id)}</td>
                <td>{x.quantity}</td>
                <td>{x.processed}</td>
                <td>{x.reserved}</td>
                <td>{x.returned}</td>
              </tr>
            ))}
          </Table>
          <DocumentActions
            key={`${doc.id}-${doc.version}`}
            doc={doc}
            lines={lines}
            busy={busy}
            execute={execute}
            productName={productName}
          />
        </Panel>
      )}
    </div>
  );
}
export function nextStep(doc: ErpDocument) {
  if (doc.status === "cancelled") return "该单据已取消。原库存操作与释放记录仍可在流水中回查。";
  if (doc.kind === "purchase")
    return (
      {
        draft: "下一步：提交采购审批。",
        pending: "下一步：由具备审批权限且符合职责分离要求的成员审批。",
        approved: "下一步：确认向供应商下单。系统会复验单据和库存版本。",
        open: "下一步：实物到仓后按实际数量收货，支持分批收货。",
        partial: "下一步：继续收货或处理退货。",
        completed: "采购已完成，可登记退货并核对应付款。",
      } as Record<string, string>
    )[doc.status];
  return doc.status === "completed"
    ? "销售已完成，可登记客户退货并核对应收款。"
    : "下一步：先预占可用库存，再按实际数量发货；缺货时到 Agent 页分析补货。";
}
function DocumentActions({
  doc,
  lines,
  busy,
  execute,
  productName,
}: {
  doc: ErpDocument;
  lines: ErpSnapshot["lines"];
  busy: boolean;
  execute: Execute;
  productName: (id: string) => string;
}) {
  const choices: [string, string][] = [];
  if (doc.kind === "purchase") {
    if (doc.status === "draft") choices.push(["purchase_submit", "提交审批"]);
    if (doc.status === "pending") choices.push(["purchase_approve", "批准采购"]);
    if (doc.status === "approved") choices.push(["purchase_place", "确认下单"]);
    if (["open", "partial"].includes(doc.status))
      choices.push(["purchase_receive", "登记实物收货"]);
    if (lines.some((x) => x.processed > x.returned))
      choices.push(["purchase_return", "采购退货出库"]);
  } else {
    if (["open", "partial"].includes(doc.status))
      choices.push(["sale_reserve", "预占库存"], ["sale_ship", "确认发货"]);
    if (lines.some((x) => x.processed > x.returned)) choices.push(["sale_return", "客户退货入库"]);
  }
  if (!["cancelled", "completed"].includes(doc.status))
    choices.push(["document_cancel", "取消单据 / 释放预占"]);
  const [action, setAction] = useState(choices[0]?.[0] ?? "");
  const hasItems = [
    "purchase_receive",
    "sale_reserve",
    "sale_ship",
    "purchase_return",
    "sale_return",
  ].includes(action);
  const needReason = ["document_cancel", "purchase_return", "sale_return"].includes(action);
  return !choices.length ? null : (
    <form
      className="mt-4 space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const command = {
          action,
          id: doc.id,
          expected_version: doc.version,
          ...(hasItems
            ? {
                items: lines
                  .map((x) => ({ line_id: x.id, quantity: num(f, x.id) }))
                  .filter((x) => x.quantity > 0),
              }
            : {}),
          ...(needReason ? { reason: text(f, "reason") } : {}),
        };
        await execute(command);
      }}
    >
      <fieldset disabled={busy} className="space-y-3">
        <Select label="本次操作" value={action} onChange={setAction}>
          {choices.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </Select>
        {hasItems && (
          <div className="grid gap-3 md:grid-cols-2">
            {lines.map((x) => (
              <Field key={x.id} label={`${productName(x.product_id)} 本次数量（不处理填 0）`}>
                <Input
                  name={x.id}
                  type="number"
                  min={0}
                  max={1_000_000}
                  step={1}
                  defaultValue={0}
                  required
                />
              </Field>
            ))}
          </div>
        )}
        {needReason && (
          <Field label="处理原因">
            <Input name="reason" required maxLength={160} />
          </Field>
        )}
        <Button type="submit">{choices.find((x) => x[0] === action)?.[1]}</Button>
        <p className="text-xs text-muted-foreground">
          使用当前 v{doc.version} 提交；库存、单据或审批条件变化时系统会拒绝并要求刷新。
        </p>
      </fieldset>
    </form>
  );
}

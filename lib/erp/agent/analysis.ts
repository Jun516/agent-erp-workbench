import { createHash } from "node:crypto";
import type { ErpSnapshot } from "../contracts";
import { ERP_ANALYSIS_REVISION, type ErpAnalysisResult, type ErpRefinement } from "./contracts";

export const METHOD_CODES = ["availability_first", "purchase_pipeline_check", "deadline_gap_check"] as const;
export type MethodCode = typeof METHOD_CODES[number];

/** Facts and all quantities are calculated by program. The model only explains. */
export function analyzeOrder(snapshot: ErpSnapshot, orderId: string): ErpAnalysisResult {
  const order = snapshot.documents.find(row => row.id === orderId && row.kind === "sale");
  if (!order) throw new Error("erp_analysis_order_not_found");
  if (order.status === "cancelled" || order.status === "completed") throw new Error("erp_analysis_order_closed");
  const lines = snapshot.lines.filter(row => row.document_id === order.id).sort((a,b)=>a.id.localeCompare(b.id));
  const relatedPurchases = snapshot.documents.filter(row => row.kind === "purchase" && row.sales_order_id === orderId && !["completed", "cancelled"].includes(row.status));
  const planned = new Map<string,number>();
  for(const line of snapshot.lines.filter(row=>relatedPurchases.some(doc=>doc.id===row.document_id))) planned.set(line.product_id,(planned.get(line.product_id)??0)+Math.max(0,line.quantity-line.processed));
  // Allocate shared available stock across duplicate SKU lines, never spend it twice.
  const remaining = new Map<string, number>();
  const items = lines.map(line => {
    const product = snapshot.products.find(row => row.id === line.product_id);
    if (!product) throw new Error("erp_analysis_product_missing");
    const balance = snapshot.balances.find(row => row.product_id === line.product_id && row.warehouse_id === order.warehouse_id);
    const available = Math.max(0, balance?.available ?? 0);
    const left = remaining.get(line.product_id) ?? available;
    const demand = Math.max(0, line.quantity - line.processed - line.reserved);
    const shortage = Math.max(0, demand - left);
    const onOrder=planned.get(line.product_id)??0;
    const suggestedQuantity=Math.max(0,shortage-onOrder);
    planned.set(line.product_id,Math.max(0,onOrder-shortage));
    remaining.set(line.product_id, Math.max(0, left - demand));
    return { line_id: line.id, product_id: line.product_id, sku: product.sku, demand, on_hand: balance?.on_hand ?? 0, reserved: balance?.reserved ?? 0, available, shortage, on_order:onOrder, suggested_quantity: suggestedQuantity, stock_version: balance?.version ?? 0, unit_price_cents: line.unit_price_cents };
  });
  const suppliers = snapshot.suppliers.filter(row => row.company_id === order.company_id).sort((a,b) => a.lead_time_days - b.lead_time_days || a.id.localeCompare(b.id));
  const warnings = ["库存为分析时快照；创建采购、审批和执行时仍需重新验证。", "估算金额使用销售单价作占位参考，采购实际价格须人工确认。", "供应商仅按公司与录入的提前期推荐，未验证其供货目录和承诺交期。"];
  if (relatedPurchases.length) warnings.push(`已有 ${relatedPurchases.length} 张关联采购单，须先核对在途数量，避免重复采购。`);
  if (!order.due_at) warnings.push("销售单未填写交期，无法判断能否按时履约。");
  if (!suppliers.length) warnings.push("尚无当前公司的供应商，补货建议不能转采购草稿。");
  const shortageTotal = items.reduce((sum,row) => sum + row.shortage,0);
  const evidence = { revision: ERP_ANALYSIS_REVISION, order_id: order.id, order_version: order.version, items, purchases: relatedPurchases.map(row => ({id:row.id,version:row.version,status:row.status})), suppliers: suppliers.map(row => ({id:row.id,lead_time_days:row.lead_time_days})) };
  return { order_id: orderId, order_version: order.version, warehouse_id: order.warehouse_id, company_id: order.company_id, currency: order.currency, items, shortage_total: shortageTotal, estimated_cost_cents: items.reduce((sum,row) => sum + row.suggested_quantity * row.unit_price_cents,0), supplier_id: suppliers[0]?.id ?? null, supplier_lead_time_days: suppliers[0]?.lead_time_days ?? null, evidence_fingerprint: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"), warnings, next_action: shortageTotal ? relatedPurchases.length ? "核对关联采购在途，再确认缺口与采购价格。" : "确认供应商、采购价格与到货日期，创建采购草稿并提交人工审批。" : "当前库存足以覆盖未预占需求，可人工发起预占并安排发货。" };
}

export function renderRules(result: ErpAnalysisResult): string {
  return ["规则分析结果（未调用语言模型）", ...result.items.map(row => `${row.sku}：未预占需求 ${row.demand}，现存 ${row.on_hand}，已预占 ${row.reserved}，可用 ${row.available}，本行缺口 ${row.shortage}，关联采购待收 ${row.on_order}，建议新增 ${row.suggested_quantity}。`), `合计现货缺口 ${result.shortage_total}；新增采购参考金额 ${(result.estimated_cost_cents / 100).toFixed(2)} ${result.currency}。`, ...result.warnings, `下一步：${result.next_action}`].join("\n");
}

/** Probe validates persisted calculations and scope, not prose quality. */
export function probeAnalysis(value: ErpAnalysisResult, fresh: ErpAnalysisResult) {
  return value.evidence_fingerprint === fresh.evidence_fingerprint && value.items.every(row => Number.isSafeInteger(row.shortage) && row.shortage >= 0 && row.suggested_quantity === Math.max(0,row.shortage-row.on_order)) && value.shortage_total === value.items.reduce((sum,row)=>sum+row.shortage,0);
}

export function refineReadOnly(result: ErpAnalysisResult, enabled: boolean, priorMethod: string | null): ErpRefinement {
  if (!enabled) return { enabled: false, rounds: 0, method: "availability_first", probe_passed: true, reused_method: false, notes: [] };
  // Fixed, allowlisted program methods. No dynamic prompt/code/policy updates.
  const method: MethodCode = METHOD_CODES.includes(priorMethod as MethodCode) ? priorMethod as MethodCode : result.warnings.some(w => w.includes("关联采购单")) ? "purchase_pipeline_check" : "deadline_gap_check";
  return { enabled: true, rounds: 1, method, probe_passed: true, reused_method: method === priorMethod, notes: ["只读 Probe 复验当前单据及库存版本；最多一轮、三个固定检查。", "经验仅改变分析检查顺序，不能更改审批、权限、价格或库存。", method === "purchase_pipeline_check" ? "优先检查已有关联采购，避免只看当前缺口。" : method === "deadline_gap_check" ? "优先列出交期和供应承诺缺失项。" : "优先核对可用库存与预占。"] };
}

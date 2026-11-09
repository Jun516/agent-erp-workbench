import { z } from "zod";

const id = z.string().uuid();
const quantity = z.number().int().min(1).max(1_000_000);
const cents = z.number().int().min(0).max(1_000_000_000);
const name = z.string().trim().min(1).max(160);
const base = { idempotency_key: id };
const document = { ...base, id, expected_version: z.number().int().positive() };
const line = z.object({ product_id: id, quantity, unit_price_cents: cents }).strict();
const items = z.array(z.object({ line_id: id, quantity }).strict()).min(1).max(100);
export const erpCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...base, action: z.literal("company_create"), name, currency: z.enum(["CNY", "USD", "EUR", "BRL"]).default("CNY") }).strict(),
  z.object({ ...base, action: z.literal("company_policy"), company_id: id, allow_self_approval: z.boolean(), approval_limit_cents: cents }).strict(),
  z.object({ ...base, action: z.literal("warehouse_create"), company_id: id, name }).strict(),
  z.object({ ...base, action: z.literal("supplier_create"), company_id: id, name, lead_time_days: z.number().int().min(0).max(365).default(7) }).strict(),
  z.object({ ...base, action: z.literal("product_create"), company_id: id, sku: name, name, unit: z.string().min(1).max(20).default("件") }).strict(),
  z.object({ ...base, action: z.literal("access_grant"), warehouse_id: id, user_id: id, can_purchase: z.boolean(), can_receive: z.boolean(), can_ship: z.boolean() }).strict(),
  z.object({ ...base, action: z.literal("opening_stock"), warehouse_id: id, product_id: id, quantity, reason: name }).strict(),
  z.object({ ...base, action: z.literal("sale_create"), warehouse_id: id, customer_name: name, lines: z.array(line).min(1).max(100), due_at: z.string().datetime().optional() }).strict(),
  z.object({ ...base, action: z.literal("purchase_create"), warehouse_id: id, supplier_id: id, sales_order_id: id.optional(), source_order_version: z.number().int().positive().optional(), source_stock_versions: z.array(z.object({ product_id: id, version: z.number().int().min(0) }).strict()).max(100).optional(), lines: z.array(line).min(1).max(100), due_at: z.string().datetime().optional() }).strict().refine(x => !x.sales_order_id || (x.source_order_version !== undefined && x.source_stock_versions !== undefined), "关联销售单的采购草稿须携带原始销售单和库存版本"),
  z.object({ ...document, action: z.literal("purchase_submit") }).strict(),
  z.object({ ...document, action: z.literal("purchase_approve") }).strict(),
  z.object({ ...document, action: z.literal("purchase_place") }).strict(),
  z.object({ ...document, action: z.literal("purchase_receive"), items }).strict(),
  z.object({ ...document, action: z.literal("sale_reserve"), items }).strict(),
  z.object({ ...document, action: z.literal("sale_ship"), items }).strict(),
  z.object({ ...document, action: z.literal("document_cancel"), reason: name }).strict(),
  z.object({ ...base, action: z.literal("stock_transfer"), warehouse_id: id, target_warehouse_id: id, product_id: id, quantity, reason: name }).strict(),
  z.object({ ...base, action: z.literal("stock_adjust"), warehouse_id: id, product_id: id, delta: z.number().int().min(-1_000_000).max(1_000_000).refine(x => x !== 0), reason: name }).strict(),
  z.object({ ...document, action: z.literal("purchase_return"), items, reason: name }).strict(),
  z.object({ ...document, action: z.literal("sale_return"), items, reason: name }).strict(),
  z.object({ ...base, action: z.literal("settlement_record"), id, expected_version: z.number().int().positive(), amount_cents: cents.refine(x => x > 0), reference: name }).strict(),
]);
export type ErpCommand = z.infer<typeof erpCommandSchema>;
export interface ErpCompany { id: string; organization_id: string; name: string; currency: string; allow_self_approval: boolean; approval_limit_cents: number; version: number; }
export interface ErpWarehouse { id: string; organization_id: string; company_id: string; name: string; }
export interface ErpSupplier { id: string; organization_id: string; company_id: string; name: string; lead_time_days: number; }
export interface ErpProduct { id: string; organization_id: string; company_id: string; sku: string; name: string; unit: string; }
export interface ErpBalance { organization_id: string; warehouse_id: string; product_id: string; on_hand: number; reserved: number; available: number; version: number; }
export interface ErpDocument { id: string; organization_id: string; company_id: string; warehouse_id: string; kind: "sale" | "purchase"; number: string; status: "draft" | "pending" | "approved" | "open" | "partial" | "completed" | "cancelled"; supplier_id: string | null; customer_name: string | null; sales_order_id: string | null; currency: string; total_cents: number; version: number; created_by: string; approved_by: string | null; due_at: string | null; created_at: string; }
export interface ErpLine { id: string; organization_id: string; document_id: string; product_id: string; quantity: number; processed: number; reserved: number; returned: number; unit_price_cents: number; stock_version: number; }
export interface ErpReservation { id: string; organization_id: string; warehouse_id: string; product_id: string; document_id: string; line_id: string; quantity: number; }
export interface ErpLedger { id: string; organization_id: string; warehouse_id: string; product_id: string; document_id: string | null; line_id: string | null; operation_id: string; kind: string; quantity_delta: number; reserved_delta: number; reason: string; actor_id: string; created_at: string; }
export interface ErpSettlement { id: string; organization_id: string; document_id: string; direction: "receivable" | "payable"; amount_cents: number; settled_cents: number; currency: string; version: number; }
export interface ErpAudit { id: string; organization_id: string; actor_id: string; action: string; resource_id: string | null; details: Record<string, unknown>; created_at: string; }
export interface ErpAccess { organization_id: string; warehouse_id: string; user_id: string; can_purchase: boolean; can_receive: boolean; can_ship: boolean; }
export interface ErpSnapshot { companies: ErpCompany[]; warehouses: ErpWarehouse[]; suppliers: ErpSupplier[]; products: ErpProduct[]; balances: ErpBalance[]; documents: ErpDocument[]; lines: ErpLine[]; reservations: ErpReservation[]; ledger: ErpLedger[]; settlements: ErpSettlement[]; audit: ErpAudit[]; access: ErpAccess[]; actor_role: string; }
export interface ErpCommandResult { id: string; version?: number; status?: string; replayed: boolean; }

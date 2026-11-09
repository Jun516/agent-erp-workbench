import { z } from "zod";

export const ERP_ANALYSIS_REVISION = "erp-analysis-v1";
export const analysisInputSchema = z.object({ order_id: z.string().uuid(), mode: z.enum(["rules", "model"]), refinement: z.boolean().default(false) }).strict();
export const memoryInputSchema = z.object({ scope_type: z.enum(["product", "warehouse", "supplier"]), scope_id: z.string().uuid(), content: z.string().trim().min(4).max(1200), expires_at: z.string().datetime() }).strict();
export interface AnalysisItem { line_id: string; product_id: string; sku: string; demand: number; on_hand: number; reserved: number; available: number; shortage: number; on_order: number; stock_version: number; unit_price_cents: number; suggested_quantity: number; }
export interface ErpAnalysisResult {
  order_id: string; order_version: number; warehouse_id: string; company_id: string; currency: string;
  items: AnalysisItem[]; shortage_total: number; estimated_cost_cents: number;
  supplier_id: string | null; supplier_lead_time_days: number | null;
  evidence_fingerprint: string; warnings: string[]; next_action: string;
}
export interface ErpMemory { id: string; scope_type: "product" | "warehouse" | "supplier"; scope_id: string; content: string; confirmed_by: string; expires_at: string; created_at: string; }
export interface ErpRefinement { enabled: boolean; rounds: number; method: string; probe_passed: boolean; reused_method: boolean; notes: string[]; }
export interface ErpReview { verdict: "pass" | "fail" | "needs_review"; confidence: number | null; reason: string; model?: string; evaluated_at: string; threshold: number; }
export interface ErpAnalysisRun { id: string; order_id: string; mode: "rules" | "model"; status: "completed" | "failed"; final_text: string; result: ErpAnalysisResult; refinement: ErpRefinement; evaluation: ErpReview | null; memory_ids: string[]; created_at: string; error_code: string | null; }
export interface ErpAnalysisIndex { runs: ErpAnalysisRun[]; memories: ErpMemory[]; configuration: { jev_configured: boolean; model_settings_url: string; policy_revision: string; }; }

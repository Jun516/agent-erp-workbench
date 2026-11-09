/** Deliberate SQL refusals have stable ERP codes; unexpected DB details stay server-side. */
export function erpErrorResponse(error: unknown): { code: string; message: string; status: number } {
  const message = error instanceof Error ? error.message : "";
  const code = message.match(/\berp_[a-z_]+\b/)?.[0];
  const known: Record<string, [number, string]> = {
    erp_jev_not_configured: [503, "Jev 评测尚未配置，请先配置服务凭据和模型。"],
    erp_memory_changed: [409, "分析引用的记忆已失效，请重新分析。"],
    erp_analysis_order_not_found: [404, "销售单不存在或不在当前可见范围。"],
    erp_analysis_order_closed: [409, "这张销售单已完成或已取消，无需进行缺货分析。"],
    erp_memory_forbidden: [403, "只有经理或管理员可以确认和撤回业务记忆。"],
    erp_memory_expiry_invalid: [422, "记忆有效期必须在未来，且不超过一年。"],
    erp_analysis_not_found: [404, "找不到这条分析记录。"],
    erp_manager_required: [403, "这项操作需要经理或管理员权限。"],
    erp_product_not_in_source: [422, "采购商品不在关联销售单中，请核对来源。"],
    erp_excess_replenishment: [422, "采购数量超过当前未覆盖缺口，请核对已有关联采购。"],
    erp_source_versions_required: [422, "关联销售单的采购需要原始单据和库存版本，请重新分析。"],
    erp_self_approval_forbidden: [403, "采购申请人与审批人必须分开，请交由其他管理员审批。"],
    erp_stale_version: [409, "单据版本已变化，请刷新后重新核对。"],
    erp_stale_stock: [409, "分析所依据的库存已变化，请重新分析。"],
    erp_stale_source: [409, "分析所依据的销售单已变化，请重新分析。"],
    erp_invalid_status: [409, "当前单据状态不支持这项操作。"],
    erp_excess_quantity: [422, "本次数量超过单据的剩余可处理数量。"],
    erp_excess_return: [422, "退货数量超过实际收货或发货的可退数量。"],
    erp_settlement_requires_reconciliation: [409, "已有核销记录，请先完成财务对账再处理。"],
    erp_posted_document_requires_return: [409, "单据已产生库存记录，请使用退货流程冲回。"],
    erp_forbidden: [403, "当前账号没有执行这项操作的权限。"],
    erp_warehouse_forbidden: [403, "当前账号没有这个仓库的操作权限。"],
    erp_self_approval: [403, "采购申请人与审批人必须分开，请交由其他管理员审批。"],
    erp_approval_limit: [422, "采购金额超过公司审批额度，请先核对审批策略。"],
    erp_not_found: [404, "单据或业务对象不存在，或不在当前组织内。"],
    erp_version_conflict: [409, "单据已发生变化，请刷新后核对再操作。"],
    erp_stock_changed: [409, "库存版本已经变化，请重新分析并建立采购草稿。"],
    erp_insufficient_stock: [409, "可用库存不足，请先补货或减少本次操作数量。"],
    erp_idempotency_conflict: [409, "相同操作编号对应了不同内容，请刷新后重新提交。"],
    erp_invalid_state: [409, "当前单据状态不支持这项操作，请刷新查看下一步。"],
    erp_invalid_quantity: [422, "数量超出剩余可处理范围，请核对单据明细。"],
    erp_invalid_command: [422, "操作内容不符合业务要求。"],
  };
  if (code && known[code]) {
    const [status, text] = known[code];
    return { code, status, message: text };
  }
  if (code) return { code, status: 422, message: `业务校验未通过（${code}），请核对单据、权限与库存后重试。` };
  if (/SUPABASE_DB_URL|ECONNREFUSED|ETIMEDOUT|does not exist/.test(message)) {
    return { code: "erp_unavailable", status: 503, message: "ERP 数据库尚未就绪，请检查数据库连接和 0409、0410 迁移。" };
  }
  return { code: "internal_error", status: 500, message: "ERP 操作失败，请保留请求编号以便排查。" };
}

# ERP 分支架构

```mermaid
flowchart LR
  U[ERP 工作台 /app/erp] --> A[requireRole + SupportWrite + Zod]
  A --> C[fn_erp_command]
  C --> B[(余额 / 预占 / 单据 / 流水 / 核销)]
  C --> L[ERP 审计]
  B --> S[fn_erp_snapshot 按组织和仓库过滤]
  L --> S
  S --> U
  S --> R[规则计算 + 只读 Pi Agent]
  M[已确认且未过期 Memory] --> R
  R --> P[有界候选 + Probe]
  P --> U
  P --> J[可选 Jev 运行后评测]
  J --> U
  U --> M
```

ERP RPC 通过 server-only `lib/erp/server.ts` 调用；org/actor 来自已验证的会话。PostgreSQL 再检查当前成员身份和业务权限。ERP 核心表拒绝浏览器直接写入，防止绕过账本规则。

库存采用 on_hand、reserved、available 三个概念。采购下单增加在途业务预期，收货才增加实物量；预占减少可用量，发货才减少实物量。所有变动追加流水，退货通过反向业务操作处理，不删除历史。

原 `catalog_products` 的单个库存字段、外部电商 `orders` 镜像和服务 `sales` 单据不充当 ERP 账本。它们仍属于原 CRM。旧数据不会自动转成 ERP 公司、SKU 和期初余额；上线迁移应先对账，再通过明确定义的导入流程初始化。

当前范围为轻量采购/库存/订单履约 ERP；制造 BOM、MRP、生产工单、总账会计、税务、真实银行支付和外部 ERP 适配器均需另建业务模块。

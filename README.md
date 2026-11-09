# Agent ERP Workbench

面向电商零售采购、库存与订单履约的轻量 ERP Agent 工作台。主入口 `/app/erp`，原 CRM 保留为客户经营模块。

[启动与配置](README-ERP.md) · [ERP架构](docs/architecture/erp.md) · [数据库契约](docs/erp/database-contract.md) · [Agent与Jev](docs/erp/agent.md) · [验收记录](docs/erp/verification.md)

## 业务流程

销售需求 → 缺货分析 → 采购草稿 → 人工审批 → 分批收货 → 库存预占 → 发货 → 手工核销。

- 公司、仓库、SKU、供应商建档与仓库人员授权。
- 采购提交、审批、下单和分批收货；销售预占与分批发货；调拨、调整和双向退货。
- 实物、预占、可用库存分开记账，追加库存流水与业务审计。
- PostgreSQL 事务内检查组织/公司/仓库、库存、单据版本、审批额度和职责分离；幂等提交防止重复记账。
- 应收应付台账与人工核销凭证，不发起真实银行付款。

## Agent 能力

- 程序读取当前 ERP 账本计算缺口，并扣除已关联采购的待收数量。
- Pi Runtime 经组织 Model Gateway 调用模型，只提供证据读取、确认 Memory 读取和结构化分析提交工具。
- 采购草稿携带原销售单和库存版本；真实写入仍由 ERP 命令重新验证。
- Memory 经经理确认，按商品/仓库/供应商限定范围，具有有效期并可撤回。
- 受限 Harness² 思路：固定允许方法、只读复核候选、fresh Probe 和7天方法复用；不自动修改代码、权限或模型权重。
- 可选 Jev 事后语义评测，需要逐次确认分享材料；0.8阈值尚未校准，评测结果不构成采购审批授权。

## 技术与启动

Next.js 16 · React 19 · TypeScript 6 · pnpm 9.15.9 · Supabase/PostgreSQL · Pi Agent Core。

```powershell
git clone https://github.com/Jun516/agent-erp-workbench.git
cd agent-erp-workbench
npx.cmd --yes pnpm@9.15.9 install --frozen-lockfile
```

继续按 [README-ERP](README-ERP.md) 准备独立 Supabase 和 `.env.local`，应用完整 baseline，然后启动开发服务。仅克隆源码不会自动带来本机数据库、账号、环境变量或模型凭据。Codespaces 尚未为本分支配置完成。

## 验证与边界

2026-11-09 本机验收：56项 PostgreSQL 回归、98项相关离线/交互/导航测试、17项真实登录浏览器检查通过；生产构建、类型检查与 ESLint 错误检查通过。公开摘要和可复现范围见 [验收记录](docs/erp/verification.md)。GitHub 上的新运行结果以 Actions 为准。

真实 Pi/Jev 凭据联调、模型准确率与质量提升尚未测量。本项目是学习与工程验证原型，尚未覆盖制造BOM/MRP、总账税务、复杂成本核算或真实企业生产容量。

## 来源与许可

基于随附 AiNativeCrm 原始源码派生，其原始资料标注来源为 [helsome/AiNativeCrm](https://github.com/helsome/AiNativeCrm)。原 CRM 功能和 ERP 增量分开记录，不能将上游已有能力等同于本分支作者的独立实现。

保留原作者 Rafael Melgaço 的 [MIT许可证与版权声明](LICENSE)。原始 CRM 介绍见 [README-UPSTREAM-CRM.md](README-UPSTREAM-CRM.md)；其中上游安装和发布流程不代表本分支已提供对应部署服务。

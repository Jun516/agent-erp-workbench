# Agent ERP Workbench

基于随附 AiNativeCrm 原始源码构建的独立 ERP 分支。入口为 `/app/erp`，以采购、库存和订单履约为主；原 CRM 保留为客户经营模块。底座版权、许可证与原作者声明见原 README 和 LICENSE。本分支的扩展不是原作者已交付能力，也不代表真实企业上线。

## 现在可以做什么

- 建立公司、仓库、供应商和 SKU；配置仓库人员权限与采购审批额度。
- 录入期初库存及销售需求，生成采购草稿，提交、审批、下单与分批收货。
- 预占库存、分批发货、调拨、盘点调整、销售退货和采购退货；查询库存流水和操作审计。
- 记录应收应付与人工核销凭证；这里的“核销”仅登记对账，不会发起真实付款。
- 以实时 ERP 账本分析缺货，使用模型补充解释；通过显式评测和确认记忆辅助后续分析。

每次业务写入在 PostgreSQL 事务内执行。命令有幂等键、单据版本与库存校验；采购单本身不增加实物库存。审批、收货、发货由业务权限控制，评测分数不构成授权。

## 启动前准备

需要 Node.js 22+、pnpm 9.15.9、Supabase（Auth + PostgreSQL + PostgREST）。开发 ERP 核心时不要求配置 WhatsApp 等渠道。

1. 在本目录执行 `npx --yes pnpm@9.15.9 install --frozen-lockfile`。
2. 为本分支准备独立的 Supabase 项目，避免与原 CRM 共用本机栈。复制 `.env.example` 为 `.env.local`，填写下表变量，并设 `CRM_DEMO_MODE=false`。自定义端口时，同步修改 `NEXT_PUBLIC_APP_URL` 和 Supabase Auth 回调地址。本机独立开发实例可关闭邮件确认；开启邮件确认时先配置可用 SMTP/收件箱。
3. 新库执行 `npx --yes pnpm@9.15.9 erp:migrate`，应用当前分支完整 `supabase/baseline.sql`；它会先准备所需 public 扩展，适用于 Windows，无需 Git Bash/psql。已有原始 CRM 库也可应用幂等 baseline，或依次应用新增 `0409`、`0410` 迁移。DDL 凭据权限不足时，仅给迁移脚本设置 `SUPABASE_DB_ADMIN_URL`；应用运行继续使用 `SUPABASE_DB_URL`。请勿在有业务数据的库上执行 reset。
4. 执行 `npx --yes pnpm@9.15.9 dev`，打开应用，注册/登录并完成组织引导，然后进入 `/app/erp`。
5. 在“基础资料”先建公司、仓库、SKU、供应商，再录入期初库存与销售需求。使用两个账号体验申请与审批分离；单人本机学习可由管理员显式开启公司自审批策略。

| 环境变量 | 用途 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器与登录连接 |
| `SUPABASE_SERVICE_ROLE_KEY` | 仅服务端的组织与平台查询 |
| `SUPABASE_DB_URL` | ERP server-only RPC 与 Agent 持久化 |
| `NEXT_PUBLIC_APP_URL` | 与真实应用地址一致，例如 `http://localhost:3000` |
| `AI_CRED_AES_KEY` | 32 字节 Base64；保存模型凭据时需要，生产启动必填 |
| `INTERNAL_SECRET`、`CPF_ENCRYPTION_KEY`、`WAHA_BYO_ENCRYPTION_KEY` | 生产启动沿用的底座必填项；两个加密键按模板生成 |

不要把迁移 QA 的 Auth/Storage schema stub 用于安装。普通 PostgreSQL 加 baseline 无法替代真正的 Supabase Auth/PostgREST。

生产构建使用 `npx --yes pnpm@9.15.9 build`，随后 `npx --yes pnpm@9.15.9 start`。原有部署脚本继承自 CRM，发布自己的容器前需自行构建本分支镜像；不要使用原项目预构建镜像来期待获得这些 ERP 扩展。

## Agent 配置与能力边界

先用规则分析核对账本；模型模式需要在组织的 AI 设置中配置有效模型绑定和凭据。Jev 是可选的运行后评测，发送材料前必须明确勾选授权。没有有效配置时系统应显示原因，不能把规则分析当成一次真实模型调用。

本分支采用受限的 Harness² 思路：只读分析、有限候选与 Probe、低权限方法复用、人工确认且可撤回的记忆。它不会自动改源码、业务审批规则、权限或模型权重。准确率、成本和业务改善需要在自己的标注数据上测量，不能从离线协议测试推断。

具体 Agent 协议、环境变量、预算与记忆规则见 [Agent 实现说明](docs/erp/agent.md)。数据库契约见 [数据库说明](docs/erp/database-contract.md)。验收范围及未测部分见 [验收记录](docs/erp/verification.md)。

## 可复现验证

```powershell
npx --yes pnpm@9.15.9 typecheck
npx --yes pnpm@9.15.9 exec vitest run tests/unit/erp-routes.test.ts
```

ERP 数据库回归脚本位于 `scripts/`，要求显式指定隔离测试库。`qa/local-stack/` 是本次验收用的独立 Supabase 配置，使用 55421/55422 端口；不替代正式安装配置。测试账号、测试栈输出和运行环境不应发布。

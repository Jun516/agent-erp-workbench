# ERP 改造验收记录

日期：2026-11-09。来源：`learn/erp/AiNativeCrm-main.zip` 原始源码；在独立目录 `agent-erp-workbench` 完成扩展。原始压缩包未覆盖，旧 CRM 发布目录未作为修改目标。

公开仓库包含下方 JSON 验证摘要与可复现测试源码。原始日志、浏览器运行目录、个人机器路径清单和上游历史验收截图留在本机；表中这些路径不代表公开下载附件。浏览器摘要见 [17项结果](qa/browser-results.json)。

## 已验证

| 验证 | 结果与证据 |
|---|---|
| 生产构建 | Next.js production build exit 0，包含 TypeScript 检查；`qa/results/build-final.log` |
| 全仓类型检查 | UI 与 Agent 最终检查均 exit 0；`erp-ui-typecheck.log`、`erp-agent-typecheck-final.log` |
| 全仓 ESLint | exit 0、0 errors；有上游及测试文件警告，详见 `qa/results/lint-full.log` |
| API 边界 | `tests/unit/erp-routes.test.ts` 8/8：鉴权、支持会话、租户注入、版本冲突、幂等审计 |
| Agent/协议/配置 | 6 文件 77/77，见 `erp-agent-tests-final.log`：计算/待收去重、Memory权限事务、运行历史失效、Jev协议与策略、模型配置入口 |
| UI/导航 | 3 文件 13/13，见 `erp-ui-tests.log`：未知结果原幂等键重试、分批数量、viewer禁写、状态下一步、导航完整性 |
| PostgreSQL 核心 | 56/56；[逐项结果](qa/database-results.json)，包含并发、防超卖、权限、流水恒等与可回滚负控制 |
| 完整基线 | 全新 PostgreSQL 测试库安装通过，再应用一次通过；[基线结果及 SHA256](qa/baseline-results.json) |
| Windows 迁移入口 | `scripts/erp-migrate.mjs` 在有业务验收数据的独立 Supabase 中成功重复应用 baseline；`qa/results/portable-migration.log` |
| 真实浏览器 | 17 项全部通过，真实 GoTrue 登录、PostgREST 和 PostgreSQL，无前端运行时错误；`qa/results/browser-results.json` |

真实浏览器验证了：期初100、旧预占70、新需求50得到缺口20；确认/撤回Memory；未配置模型时明确失败；Jev拒绝未经确认的分享；库存变化拒绝旧采购建议；幂等草稿不重复；已有采购扣除待收；默认禁止本人审批；明确开启单人学习策略后完成采购、10+9分批收货、50预占发货；最终实物70/预占70/可用0；应收人工核销；界面公司建档与390px手机布局。

## 验收环境与范围

- PostgreSQL 15.19；核心账本回归使用独立 Docker 数据库，模拟 canonical Supabase 默认 ACL 和必要 Auth/Storage schema。
- 浏览器使用真正的本地 Supabase Auth + PostgREST，独立 project_id、55421/55422端口；Storage/Realtime/邮件未启用，只有未使用 Storage 的前置 schema，未验证这些外围能力。
- 示例公司、SKU、账号和单据均是合成数据。没有真实支付、采购通知或企业外部系统调用。
- 本轮没有真实模型/Jev凭据联调，没有测模型准确率、质量改善、费用下降、业务收益或生产容量。离线模拟覆盖模型服务协议和权限边界，不能代替供应商联调。
- Harness²采用固定允许方法的受限只读自精炼与复用；没有自动修改代码、审批规则、权限或模型权重。详见 [Agent说明](agent.md)。
- 全仓其余历史单元测试与全套CRM渠道E2E没有全部重跑；本次结论限于以上明确执行的检查。

## 修复后完成的重点检查

1. Supabase 默认 ACL 必须先撤销再最小授予；0410 service_role 无 DELETE/TRUNCATE，浏览器角色无直写权。
2. Memory 写入在事务内锁定当前成员及组织状态，撤权和角色变化不能绕过复验。
3. 幂等重放也检查当前角色与仓库授权，撤权后不能取回旧操作结果。
4. 过期库存/销售单/策略/Memory使旧分析失效，清除旧语义评测结果；采购命令仍独立复验。
5. 0410只有一个完整基线块，位于末尾匿名函数权限扫描之前；SQL使用LF换行，使内置playbook的MD5自检可复现。

## 复现本机浏览器验收

安装依赖与 Docker 后，在本目录执行：

```powershell
npx --yes supabase start --workdir qa/local-stack -x studio,realtime,storage-api,imgproxy,mailpit,postgres-meta,logflare,vector,supavisor,edge-runtime
node scripts/erp-qa-setup.mjs
node scripts/erp-qa-run.mjs node_modules/next/dist/bin/next build
node scripts/erp-qa-run.mjs node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3015
```

另开终端执行 `node scripts/erp-qa-run.mjs scripts/erp-browser-check.mjs`。需要Playwright包/Chrome，脚本支持 `ERP_PLAYWRIGHT_PATH` 和 `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH`。QA setup仅接受它固定的本机测试栈，会生成忽略提交的 `.env.erp-qa` 和合成测试账号。真实使用请按 [README-ERP](../../README-ERP.md) 配自己的独立实例。

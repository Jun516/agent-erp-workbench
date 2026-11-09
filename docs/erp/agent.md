# ERP Agent、Jev 与受限自精炼

本实现属于此 ERP 分支的核心能力。`/app/erp` 以销售订单为需求入口，当前数据库为业务账本；Agent 只生成分析和待确认的采购建议，业务采购、审批、收货、发货仍调用独立 ERP command。

## 怎样使用

1. 建公司、仓库、SKU、供应商与期初库存；创建销售单。
2. 在 Agent 分析页选择销售单。选择“规则分析”可直接计算缺口，不调用语言模型；选择“模型分析”才调用 Pi Runtime。模型在 `/app/ai/providers` 的“ERP 库存与履约分析”配置；组织默认模型亦可使用。凭证与预算复用已有 Model Gateway，不在新页面填写密钥。
3. 确认的供应/商品/仓库历史经验可由经理创建 Memory，并填写一年内有效期。页面支持撤回。Memory 不能覆盖库存实时事实。
4. 开启只读精炼可执行固定程序检查，并在模型模式最多增加一轮模型复核。查看报告里的 Probe、所用方法、是否复用和失败原因。
5. 确认建议的数量、采购价格、供应商和交期，再创建采购草稿。草稿带销售单版本和涉及 SKU 的库存版本，数据库事务里复验，并扣除已有采购待收计划防重复补货。
6. Jev 默认为可选。安装者配置服务端 `TYPESAFE_API_KEY` 与供应商实际提供的 `JEV_MODEL` 后，经理明确确认才外发本次可见报告和脱敏库存证据。**报告可能复述已确认的 Memory 内容**；不单列完整 Memory、客户资料或隐藏推理，脱敏也不能保证清除所有商业敏感内容。

## 一次分析怎样执行

`requireRole` 验证当前会话和组织 → 当前仓库权限快照 → 程序计算未发/未预占需求、可用库存、缺口与关联采购待收 → 选择有效作用域 Memory 和固定检查方法 → 可选 Pi 模型工具循环 → 结构化提交校验 → 可选只读复核候选 → 再读数据库做 fresh Probe → 持久结果 → 页面展示人工下一步。

计算区别：实物可用 = 现存 − 已预占；现货缺口 = 未发未预占需求 − 可用库存（下限 0）；建议新增采购 = 现货缺口 − 关联采购未收余量（下限 0）。草稿属于采购计划，不能加进现存。相同 SKU 多行分配可用量，防重复消耗。

供应商目前按同公司录入提前期推荐，尚无供货目录校验；销售单价只用于参考金额，采购价格须人工确认；未填写销售交期时不能承诺按时履约。这些限制进入每次报告。

## 模型、工具、程序分工

- 模型负责解释、列出不确定性和下一步。工具只有 `erp_read_analysis_evidence`、`erp_read_confirmed_memory`、`erp_submit_analysis`，不存在审批、收货、付款或发货工具。
- 程序负责缺口计算、line_id/shortage/证据指纹的一致性、作用域、版本、工具/回合/时限和最终 Probe。未知工具和超工具预算均被拦截。
- 数据库负责所有真实业务写入及审批/库存/金额/幂等校验。模型输出、Jev pass 和 Memory 都不能授权写入。

## 自精炼实现与界限

规则模式：执行一次确定性分析及最终 fresh Probe，无模型候选；`rounds=1` 代表一个固定程序检查轮次，不代表生成三个候选。三个 allowlist 方法是 `availability_first`、`purchase_pipeline_check`、`deadline_gap_check`，只改变分析检查重点与模型提示，不改权限或业务规则。

模型模式：首轮有效结构化报告完成后，至多增加一个只读模型候选。每次调用最多 4 个模型回合、6 次工具调用、1600 输出 token；每回合结束后按累计 7000 token 停止。首轮 35 秒、候选 25 秒、整体 65 秒硬时限（取消向 provider 传播）。token 限制按完成回合计量，单回合可能使累计值超过阈值；不声称是供应商计费硬上限。候选超时或结构校验不通过保留首轮结果；最终业务证据不一致则整次分析失败。

只有 completed 且 fresh Probe 通过的固定方法，才按组织＋仓库＋策略修订保存，TTL 7 天，下次同范围可复用。Memory 在模型复核前、最终返回前、Jev 外发前后重新检查；过期/撤回/失去作用域会屏蔽历史报告并要求重新分析。库存、订单或策略变化也会让历史报告 Probe 和 Jev 结果失效。

这是对 harness²“试验—Probe—保留有效方法—后续复用”的受限实现。未训练模型权重，也不生成并执行新 harness 代码；固定方法的保存来源主要是规则触发选择，并非已证明的自主策略优化。未做质量提升 A/B 实验，不声称性能或准确率提升。

## Jev 分工

Jev 位于分析完成后的语义复核环节，检查相关性与证据支持。阈值 0.8 为演示运行策略，未在标注集校准；两维均达到阈值且肯定、材料完整、程序 Probe 通过才语义 pass。否定为 fail；低置信/材料不足为 needs_review，用户在页面人工复核后重新分析或调整输入。没有自动更强语义 Judge 升级链。

高置信仍要当前权限、版本、库存、金额、职责分离和人工审批；程序失败无法被 Jev 覆盖。协议错误、网络失败、未配置不能伪装成功。供应商真实服务准确率与真实业务上线效果未在本轮测量。

## API 与存储

类型在 `lib/erp/agent/contracts.ts`。GET `/api/v1/erp/analysis` 返回 `{data:{runs,memories,configuration}}`；POST `{order_id,mode,refinement}` 返回 `{data:run}`。POST `.../[id]/review` 要求 `{share_material:true}`；POST `.../memory` 为经理确认，DELETE `.../memory?id=UUID` 为逻辑撤回。

0410 新增 `erp_agent_runs`、`erp_agent_memories`、`erp_agent_methods`。三表 RLS 开启，浏览器 anon/authenticated 无直接读写；服务端所有查询明确过滤组织，并经当前 ERP 快照重校验仓库权限。service_role 只授予 SELECT/INSERT/UPDATE，不授予 DELETE/TRUNCATE。Memory scope 为受应用层当前快照约束的多态引用，不用名称推断跨组织对象。

## Living System Checklist

1. 输入：`fn_erp_snapshot` 当前单据/仓库账本，人工确认 Memory。
2. 输出：`ErpWorkbench` 分析卡与采购草稿 command，未执行建议交由用户确认。
3. 记录：`erp_agent_runs`、`llm_calls`、`api_audit_log` 的 `erp.analysis/memory/review`。
4. 可见：`/app/erp` Agent 分析历史、Probe/错误/Jev结果、Memory列表。
5. 入口：ERP 导航与业务首页。
6. 下一步：报告 `next_action`；失败明确重配模型、刷新或重新分析，不自动执行。
7. 配置：模型设置页；Jev 安装者服务端可选配置，页面显示可用性；Memory 页面确认/撤回。
8. 连续：模型建议交人工审批；人工输入/Memory 进入下一次模型分析。
9. 返回：fresh Probe 失败不保存方法；有效固定方法在同作用域后续分析复用；失效Memory屏蔽旧报告。
10. 地图：根维护的 ERP 架构与入口记录引用此模块。

## 验证

相关离线测试：`lib/erp/agent/*.test.ts` 与 `app/api/v1/erp/analysis/route.test.ts`，覆盖共享库存、在途去重、版本变化、模型结构化事实约束、Memory撤回/范围、当前组织与权限、显式Jev确认、低置信及硬规则兜底。协议客户端沿用已测试的原 CRM Jev Choice 适配，并在本分支保留独立文件。真实数据库 ACL 与迁移安装/更新由 ERP 总体验收记录给出；真实 Pi/Jev 调用需要用户配置的可用凭证，离线通过不代表已完成供应商联调。

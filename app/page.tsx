import Link from "next/link";
import { Button } from "@/components/ui/button";
import { marcaDaSaida } from "@/lib/branding/saida";

export const dynamic = "force-dynamic";
export const metadata = { title: "ERP 与 Agent 经营工作台" };

export default async function HomePage() {
  const brand = await marcaDaSaida(null);
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 border-b px-6 py-5">
        <Link href="/" className="text-lg font-semibold">
          {brand.nome}
        </Link>
        <nav aria-label="访问工作台" className="flex items-center gap-3">
          <Button variant="ghost" asChild>
            <Link href="/login?next=/app/erp">登录</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href="/signup">创建账户</Link>
          </Button>
        </nav>
      </header>
      <section className="mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2 md:py-24">
        <div>
          <p className="text-sm font-medium tracking-wide text-accent">
            ERP × AGENT · 采购 / 库存 / 订单履约
          </p>
          <h1 className="mt-5 text-4xl leading-tight font-bold md:text-5xl">
            让经营决策
            <br />
            接上真实业务账本
          </h1>
          <p className="mt-6 max-w-xl text-base leading-8 text-muted-foreground">
            集中处理销售需求、采购审批、实物收货、库存预占和发货。Agent
            读取受权限控制的证据，分析缺货风险，辅助制定补货方案。
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" asChild>
              <Link href="/app/erp">进入 ERP 工作台</Link>
            </Button>
            <Button variant="outline" size="lg" asChild>
              <Link href="/app/contacts">打开 CRM 客户管理</Link>
            </Button>
          </div>
          <p className="mt-4 text-xs leading-6 text-muted-foreground">
            首次使用需创建账户并完成组织设置。模型分析和 Jev 复核按需配置，规则分析可独立使用。
          </p>
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5 md:p-7">
          <p className="text-sm font-semibold">一张销售单的完整路径</p>
          {[
            ["01", "需求与证据", "销售需求 → 当前库存与预占 → 缺口及在途采购核对"],
            ["02", "采购与审批", "人工确认报价 → 采购草稿 → 职责分离审批 → 下单"],
            ["03", "库存与履约", "分批实物收货 → 预占可用库存 → 发货 → 账款核销"],
            ["04", "复核与积累", "操作审计 → 可选 Jev 评测 → 人工确认业务 Memory"],
          ].map(([number, title, detail]) => (
            <div key={number} className="flex gap-4 rounded-xl border bg-background p-4">
              <span className="text-sm font-semibold text-accent">{number}</span>
              <div>
                <h2 className="font-semibold">{title}</h2>
                <p className="mt-1 text-sm leading-6 text-muted-foreground">{detail}</p>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section className="mx-auto grid max-w-6xl gap-4 px-6 pb-16 md:grid-cols-3">
        {[
          [
            "业务账本",
            "每笔库存变化关联单据与操作者；版本校验和业务幂等避免过期建议、重复提交影响库存。",
          ],
          [
            "受控 Agent",
            "模型负责分析表达，工具提供事实，程序执行权限、金额与库存硬约束。采购建议须人工确认。",
          ],
          [
            "有边界的改进",
            "只读自精炼在固定方法和预算内复查证据；Memory 支持确认、有效期和撤回。Jev 评测不代替业务审批。",
          ],
        ].map(([title, detail]) => (
          <article key={title} className="rounded-xl border p-5">
            <h2 className="font-semibold">{title}</h2>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">{detail}</p>
          </article>
        ))}
      </section>
      <footer className="border-t px-6 py-6 text-center text-xs text-muted-foreground">
        {brand.nome} · 轻量 ERP 与 Agent
        业务原型。应收应付以手工凭证核销，生产计划、税务及银行支付需进一步集成。
      </footer>
    </main>
  );
}

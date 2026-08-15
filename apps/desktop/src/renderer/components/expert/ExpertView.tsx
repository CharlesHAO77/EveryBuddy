/**
 * ExpertView - 专家·技能·连接器 主页面（对齐 demo HTML v3）。
 *
 * 布局：顶部 4 大 tab → 工具栏（搜索 + 筛选 pill + 新建）→ 卡片网格 → 点卡片弹详情 Modal。
 */

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { CreateModal } from "./CreateModal";
import { DetailModal } from "./DetailModal";
import { IconPlug, IconPlus, IconSearch, IconSparkles, IconUser, IconUsers } from "./icons";
import {
  expertIcon,
  SourceBadge,
  STATUS_LABEL,
  StatusDot,
  Tag,
  TeamStrategyBadge,
  TypeBadge,
  teamMemberCount,
} from "./ui";

type TabId = "expert" | "team" | "skill" | "connector";

const TABS: Array<{ id: TabId; labelKey: string; icon: ReactNode }> = [
  { id: "expert", labelKey: "expert.tab.expert", icon: <IconUser /> },
  { id: "team", labelKey: "expert.tab.team", icon: <IconUsers /> },
  { id: "skill", labelKey: "expert.tab.skill", icon: <IconSparkles /> },
  { id: "connector", labelKey: "expert.tab.connector", icon: <IconPlug /> },
];

const NEW_LABELS: Record<TabId, string> = {
  expert: "expert.new.expert",
  team: "expert.new.team",
  skill: "expert.new.skill",
  connector: "expert.new.connector",
};

/** 各 tab 筛选 pill（按用户要求精简）：
 *  专家 → 内置/自定义；技能 → 已安装/自定义/全局（内置已并入已安装，无项目级）；
 *  连接器 → MCP/自定义。 */
const FILTERS: Record<TabId, Array<{ id: string; labelKey: string }>> = {
  expert: [
    { id: "all", labelKey: "expert.filter.all" },
    { id: "builtin", labelKey: "expert.filter.builtin" },
    { id: "custom", labelKey: "expert.filter.custom" },
  ],
  team: [
    { id: "all", labelKey: "expert.filter.all" },
    { id: "builtin", labelKey: "expert.filter.builtin" },
    { id: "custom", labelKey: "expert.filter.custom" },
  ],
  skill: [
    { id: "all", labelKey: "expert.filter.all" },
    { id: "installed", labelKey: "expert.filter.installed" },
    { id: "custom", labelKey: "expert.filter.custom" },
    { id: "global", labelKey: "expert.filter.global" },
  ],
  connector: [
    { id: "all", labelKey: "expert.filter.all" },
    { id: "mcp", labelKey: "expert.filter.mcp" },
    { id: "custom", labelKey: "expert.filter.custom" },
  ],
};

/** 卡片统一形状（覆盖四实体） */
interface CardItem {
  id?: string;
  name?: string;
  description?: string;
  icon?: string;
  source?: string;
  status?: string;
  type?: string;
  tags?: string[];
  expertIds?: string[];
  routingStrategy?: string;
}

function matchesSearch(q: string, ...fields: Array<string | undefined>): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

export function ExpertView() {
  const { t } = useTranslation();
  const store = useExpertCenterStore();
  // Windows 自定义标题栏：顶栏右侧让位系统按钮区（WCO ~138px）
  const isWin = document.documentElement.dataset.platform === "win";
  const [tab, setTab] = useState<TabId>("expert");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<{ kind: TabId; id: string } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!store.loaded) void store.loadAll();
  }, [store.loaded, store.loadAll]);

  // ── 筛选配置 + 匹配 ──
  const filterPills = useMemo(() => FILTERS[tab], [tab]);

  const items = useMemo(() => {
    const source: Array<CardItem> =
      tab === "expert"
        ? store.experts
        : tab === "team"
          ? store.teams
          : tab === "skill"
            ? store.skills
            : store.connectors;

    const q = search.trim();
    const filtered = source.filter((it) => {
      if (!matchesSearch(q, it.name, it.description, ...(it.tags ?? []))) return false;
      if (filter === "all") return true;
      if (tab === "expert" || tab === "team" || tab === "skill") return it.source === filter;
      if (tab === "connector") return it.type === filter;
      return true;
    });
    return filtered;
  }, [store, tab, search, filter]);

  const counts: Record<TabId, number> = {
    expert: store.experts.length,
    team: store.teams.length,
    skill: store.skills.length,
    connector: store.connectors.length,
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-paper">
      {/* 顶部 4 大 tab（无标题，对齐 demo）；兼作窗口拖动区（mac/win），tab 按钮 no-drag 保持可点 */}
      <div
        className={`titlebar-drag flex h-[60px] shrink-0 items-center gap-[4px] border-b border-line px-[24px] ${
          isWin ? "pr-[160px]" : ""
        }`}
      >
        {TABS.map((tabItem) => (
          <button
            key={tabItem.id}
            type="button"
            onClick={() => {
              setTab(tabItem.id);
              setSearch("");
              setFilter("all");
              setDetail(null);
            }}
            className={`titlebar-no-drag flex h-[42px] items-center gap-[9px] rounded-[10px] px-[18px] text-[16px] transition ${
              tab === tabItem.id
                ? "bg-accent-tint font-semibold text-accent-strong"
                : "text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            {tabItem.icon}
            {t(tabItem.labelKey)}
            <span
              className={`text-[12px] font-semibold ${
                tab === tabItem.id ? "text-accent" : "text-ink-3"
              }`}
            >
              {counts[tabItem.id]}
            </span>
          </button>
        ))}
      </div>

      {/* 工具栏：搜索 + 筛选 + 新建 */}
      <div className="flex flex-wrap items-center gap-[12px] border-b border-line px-[24px] py-[14px]">
        <div className="flex w-[260px] items-center gap-[8px] rounded-full border border-line bg-card px-[16px] py-[8px] shadow-card transition focus-within:border-accent focus-within:ring-[3px] focus-within:ring-accent-tint">
          <IconSearch size={15} className="shrink-0 text-ink-3" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("expert.searchPlaceholder")}
            className="w-full bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-3"
          />
        </div>
        <div className="flex flex-wrap gap-[6px]">
          {filterPills.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setFilter(p.id)}
              className={`h-[34px] rounded-full border px-[14px] text-[14px] transition ${
                filter === p.id
                  ? "border-accent-line bg-accent-tint font-semibold text-accent-strong"
                  : "border-line bg-card text-ink-2 hover:bg-hover hover:text-ink"
              }`}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex h-[38px] items-center gap-[7px] rounded-[8px] bg-accent px-[16px] text-[15px] font-semibold text-white transition hover:bg-accent-strong active:scale-[0.98]"
        >
          <IconPlus size={16} />
          {t(NEW_LABELS[tab])}
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-[12px] px-[24px] py-[60px] text-center">
            <div className="flex h-[56px] w-[56px] items-center justify-center rounded-[14px] bg-accent-tint text-accent">
              <IconSearch size={24} />
            </div>
            <div className="text-[16px] font-semibold text-ink">{t("expert.noMatchTitle")}</div>
            <div className="text-[14px] text-ink-3">{t("expert.noMatchHint")}</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-[16px] p-[20px_24px_32px]">
            {items.map((it) => (
              <Card key={it.id} item={it} tab={tab} onOpen={(id) => setDetail({ kind: tab, id })} />
            ))}
          </div>
        )}
      </div>

      {/* Modal */}
      {detail ? (
        <DetailModal kind={detail.kind} id={detail.id} onClose={() => setDetail(null)} />
      ) : null}
      {creating ? <CreateModal kind={tab} onClose={() => setCreating(false)} /> : null}
    </div>
  );
}

/** 单张卡片（按实体分发徽章/状态/色调） */
function Card({ item, tab, onOpen }: { item: CardItem; tab: TabId; onOpen: (id: string) => void }) {
  const { t } = useTranslation();
  const id = item.id ?? "";
  const tags = (item.tags ?? []).slice(0, 4);
  const isExpert = tab === "expert";
  const isSkill = tab === "skill";
  const isConnector = tab === "connector";
  const isTeam = tab === "team";

  const toneCls = isSkill
    ? "bg-warn-tint text-warn"
    : isConnector
      ? "bg-info-tint text-info"
      : isExpert && item.source === "custom"
        ? "bg-purple-tint text-purple"
        : "bg-accent-tint text-accent";

  let topRight: ReactNode;
  if (isConnector) {
    const status = item.status ?? "reserved";
    topRight = <StatusDot status={status} label={STATUS_LABEL[status] ?? status} />;
  } else if (isExpert || isSkill || isTeam) {
    // 专家/技能/团队：恒显示来源类型徽章（内置/自定义）
    topRight = <SourceBadge source={item.source ?? "custom"} />;
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className="group flex min-h-[188px] flex-col gap-[9px] rounded-[14px] border border-line bg-card p-[18px] text-left shadow-card transition hover:-translate-y-[2px] hover:border-accent-line hover:shadow-pop"
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div
          className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px] ${toneCls}`}
        >
          {expertIcon(item.icon)}
        </div>
        {topRight}
      </div>
      <div className="flex items-center gap-[8px] text-[17px] font-semibold text-ink">
        {item.name}
        {isConnector ? <TypeBadge label={(item.type ?? "").toUpperCase()} /> : null}
      </div>
      {/* 团队 meta：人数（含主 agent）+ 运行策略标签 */}
      {isTeam ? (
        <div className="flex items-center gap-[6px]">
          <span className="text-[12px] font-medium text-ink-3">
            {t("expert.memberCount", { num: teamMemberCount(item) })}
          </span>
          <TeamStrategyBadge strategy={item.routingStrategy ?? "manual"} />
        </div>
      ) : null}
      <div className="flex-1 text-[13.5px] leading-[1.55] text-ink-3">{item.description}</div>
      {tags.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-[5px] pt-[4px]">
          {tags.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </div>
      ) : null}
    </button>
  );
}

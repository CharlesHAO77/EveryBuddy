/**
 * ExpertView - 专家·技能·连接器 主页面（对齐 demo HTML v3）。
 *
 * 布局：顶部 4 大 tab → 工具栏（搜索 + 筛选 pill + 新建）→ 卡片网格 → 点卡片弹详情 Modal。
 */

import type { ConnectorType } from "@everybuddy/ipc-contract";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { CreateModal } from "./CreateModal";
import { DetailModal } from "./DetailModal";
import { IconPlug, IconPlus, IconSearch, IconSparkles, IconUser, IconUsers } from "./icons";
import { expertIcon, SourceBadge, STATUS_LABEL, StatusDot, Tag, TypeBadge } from "./ui";

type TabId = "expert" | "team" | "skill" | "connector";

const TABS: Array<{ id: TabId; label: string; icon: ReactNode }> = [
  { id: "expert", label: "专家", icon: <IconUser /> },
  { id: "team", label: "专家团", icon: <IconUsers /> },
  { id: "skill", label: "技能", icon: <IconSparkles /> },
  { id: "connector", label: "连接器", icon: <IconPlug /> },
];

const NEW_LABELS: Record<TabId, string> = {
  expert: "新建专家",
  team: "新建专家团",
  skill: "新建技能",
  connector: "新建连接器",
};

const SOURCE_FILTERS = ["all", "builtin", "custom", "installed", "project", "global"] as const;
const SOURCE_FILTER_LABEL: Record<string, string> = {
  all: "全部",
  builtin: "内置",
  custom: "自定义",
  installed: "已安装",
  project: "项目级",
  global: "全局",
};

const TYPE_FILTERS: Array<{ id: ConnectorType; label: string }> = [
  { id: "mcp", label: "MCP" },
  { id: "filesystem", label: "文件系统" },
  { id: "http-api", label: "HTTP API" },
  { id: "datasource", label: "数据源" },
  { id: "custom", label: "自定义" },
];

/** 卡片统一形状（覆盖四实体 + 团队预留占位卡） */
interface CardItem {
  id?: string;
  __reserved?: string;
  name?: string;
  description?: string;
  icon?: string;
  source?: string;
  status?: string;
  type?: string;
  tags?: string[];
  expertIds?: string[];
}

function matchesSearch(q: string, ...fields: Array<string | undefined>): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return fields.some((f) => (f ?? "").toLowerCase().includes(needle));
}

export function ExpertView() {
  const store = useExpertCenterStore();
  const [tab, setTab] = useState<TabId>("expert");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [detail, setDetail] = useState<{ kind: TabId; id: string } | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!store.loaded) void store.loadAll();
  }, [store.loaded, store.loadAll]);

  // ── 筛选配置 + 匹配 ──
  const filterPills = useMemo(() => {
    if (tab === "connector") return [{ id: "all", label: "全部" }, ...TYPE_FILTERS];
    if (tab === "expert" || tab === "skill")
      return SOURCE_FILTERS.map((id) => ({ id, label: SOURCE_FILTER_LABEL[id] }));
    return [{ id: "all", label: "全部" }];
  }, [tab]);

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
      if (tab === "expert" || tab === "skill") return it.source === filter;
      if (tab === "connector") return it.type === filter;
      return true;
    });
    // 专家团：追加预留能力卡（仅全部筛选时展示）
    if (tab === "team" && filter === "all") {
      filtered.push({
        __reserved: "bot",
        name: "子 Agent 调度",
        description: "主 Agent 调动子 Agent 协作（预留）",
      });
      filtered.push({
        __reserved: "workflow",
        name: "Workflow 编排",
        description: "可视化节点编排多 Agent 流程（预留）",
      });
    }
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
      {/* 顶部 4 大 tab（无标题，对齐 demo） */}
      <div className="flex h-[60px] shrink-0 items-center gap-[4px] border-b border-line px-[24px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              setSearch("");
              setFilter("all");
              setDetail(null);
            }}
            className={`flex h-[42px] items-center gap-[9px] rounded-[10px] px-[18px] text-[16px] transition ${
              tab === t.id
                ? "bg-accent-tint font-semibold text-accent-strong"
                : "text-ink-2 hover:bg-hover hover:text-ink"
            }`}
          >
            {t.icon}
            {t.label}
            <span
              className={`text-[12px] font-semibold ${tab === t.id ? "text-accent" : "text-ink-3"}`}
            >
              {counts[t.id]}
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
            placeholder="搜索名称、描述或标签…"
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
              {p.label}
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
          {NEW_LABELS[tab]}
        </button>
      </div>

      {/* 卡片网格 */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="flex flex-col items-center gap-[12px] px-[24px] py-[60px] text-center">
            <div className="flex h-[56px] w-[56px] items-center justify-center rounded-[14px] bg-accent-tint text-accent">
              <IconSearch size={24} />
            </div>
            <div className="text-[16px] font-semibold text-ink">没有匹配的结果</div>
            <div className="text-[14px] text-ink-3">试试调整搜索关键词或筛选条件</div>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(258px,1fr))] gap-[16px] p-[20px_24px_32px]">
            {items.map((it) => (
              <Card
                key={it.__reserved ? `res-${it.__reserved}` : it.id}
                item={it}
                tab={tab}
                onOpen={(id) => setDetail({ kind: tab, id })}
              />
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
  const reserved = item.__reserved;
  const id = reserved ? `res-${reserved}` : (item.id ?? "");
  const tags = (item.tags ?? []).slice(0, 4);
  const isExpert = tab === "expert";
  const isSkill = tab === "skill";
  const isConnector = tab === "connector";

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
  } else if (isExpert || isSkill) {
    topRight = <SourceBadge source={item.source ?? "custom"} />;
  } else {
    topRight = reserved ? (
      <span className="rounded-[6px] bg-active px-[8px] py-[2px] text-[11px] font-semibold text-ink-2">
        预留
      </span>
    ) : (
      <span className="rounded-full border border-accent-line bg-accent-tint px-[7px] py-[1px] text-[11px] font-semibold text-accent-strong">
        {item.expertIds?.length ?? 0} 人
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => onOpen(id)}
      className={`group flex min-h-[188px] flex-col gap-[9px] rounded-[14px] border border-line bg-card p-[18px] text-left shadow-card transition hover:-translate-y-[2px] hover:border-accent-line hover:shadow-pop ${
        reserved ? "opacity-80" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-[8px]">
        <div
          className={`flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-[12px] ${toneCls}`}
        >
          {expertIcon(reserved ?? item.icon)}
        </div>
        {topRight}
      </div>
      <div className="flex items-center gap-[8px] text-[17px] font-semibold text-ink">
        {item.name}
        {isConnector ? <TypeBadge label={(item.type ?? "").toUpperCase()} /> : null}
      </div>
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

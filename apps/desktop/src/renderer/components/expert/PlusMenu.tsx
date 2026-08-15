/**
 * PlusMenu - 欢迎页输入框左下角「+」菜单：分类 + 二级子菜单（点击弹出）。
 *
 * 根菜单：专家 / 专家团 / 技能 / 附件。点分类项（而非悬停）弹出二级菜单；
 * 内容较多时二级菜单带搜索框 + 最大高度滚动 + 数量角标。
 *  - 专家 → 列内置+自定义专家（当前模式优先）
 *  - 专家团 → 列团队（本轮团队运行时未实现，选中取其首位成员作为当前助手）
 *  - 技能 → 列已装技能，选中将 `/<name> ` 插入输入框
 *  - 附件 → 直接调 openPicker
 */

import type { Expert, ExpertTeam } from "@everybuddy/ipc-contract";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { IconChevronRight, IconFile, IconPlus, IconSearch, IconSparkles, IconX } from "../icons";
import { IconUsers } from "./icons";
import { expertIcon, teamMemberCount } from "./ui";

type Submenu = "experts" | "teams" | "skills" | null;

const SUB_LABEL: Record<Exclude<Submenu, null>, string> = {
  experts: "plusMenu.experts",
  teams: "plusMenu.teams",
  skills: "plusMenu.skills",
};

export function PlusMenu({
  mode,
  expertId,
  teamId,
  onSelectExpert,
  onClearExpert,
  onSelectTeam,
  onClearTeam,
  onAddAttachment,
  onSelectSkill,
}: {
  mode: "daily" | "coding";
  expertId: string | null;
  /** 已选团队（auto/workflow；与 expertId 互斥） */
  teamId: string | null;
  onSelectExpert: (e: Expert) => void;
  onClearExpert: () => void;
  onSelectTeam: (t: ExpertTeam) => void;
  onClearTeam: () => void;
  onAddAttachment: () => void;
  onSelectSkill: (name: string) => void;
}) {
  const { t } = useTranslation();
  const experts = useExpertCenterStore((s) => s.experts);
  const teams = useExpertCenterStore((s) => s.teams);
  const skills = useExpertCenterStore((s) => s.skills);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const [search, setSearch] = useState("");
  /** 容器高度 = 根菜单高度：一级菜单位置不因子菜单变高而移动 */
  const [menuH, setMenuH] = useState(220);
  /** 二级菜单最大高度：按屏幕可见空间计算（不限于一级菜单高度） */
  const [subMax, setSubMax] = useState(340);
  const ref = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // 打开后：根菜单高度固定容器（一级菜单不动）；二级菜单用「根菜单顶部 → 屏幕底部」的可用空间
  useLayoutEffect(() => {
    if (!open || !ref.current || !rootRef.current) return;
    const rootH = rootRef.current.offsetHeight;
    setMenuH(rootH);
    const refTop = ref.current.getBoundingClientRect().top;
    // 子菜单顶部 = 根菜单顶部（refTop - 6 - rootH），向下可用到视口底部
    const available = Math.floor(window.innerHeight - refTop + 6 + rootH) - 8;
    setSubMax(Math.max(160, Math.min(460, available)));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      setSubmenu(null);
      setSearch("");
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) dismiss();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setSubmenu(null);
    setSearch("");
  };

  const toggleOpen = () => setOpen((v) => !v);

  const selected = experts.find((e) => e.id === expertId) ?? null;
  const selectedTeam = teams.find((t) => t.id === teamId) ?? null;
  const orderedExperts = [
    ...experts.filter((e) => e.mode === mode),
    ...experts.filter((e) => e.mode !== mode),
  ];
  const enabledSkills = skills.filter((s) => s.enabled);

  // 搜索过滤（内容多时收敛）
  const q = search.trim().toLowerCase();
  const filteredExperts = orderedExperts.filter(
    (e) => !q || e.name.toLowerCase().includes(q) || (e.tags ?? []).some((t) => t.includes(q)),
  );
  const filteredTeams = teams.filter((t) => !q || t.name.toLowerCase().includes(q));
  const filteredSkills = enabledSkills.filter((s) => !q || s.name.toLowerCase().includes(q));
  // 当前子菜单基准是否为空（专家恒有内置，不为空）
  const emptyBase =
    submenu === "teams"
      ? teams.length === 0
      : submenu === "skills"
        ? enabledSkills.length === 0
        : false;

  /** 点击分类项弹出/收起二级菜单（重置搜索） */
  const toggleSubmenu = (s: Exclude<Submenu, null>) => {
    setSearch("");
    setSubmenu((cur) => (cur === s ? null : s));
  };

  const handleSelectExpert = (e: Expert) => {
    onSelectExpert(e);
    close();
  };

  const handleSelectTeam = (t: ExpertTeam) => {
    if (t.routingStrategy === "manual") {
      // manual：维持现状，取其首位成员为当前助手
      const first = experts.find((x) => x.id === t.expertIds[0]);
      if (first) onSelectExpert(first);
    } else {
      // auto / workflow：绑定团队（新建任务带 teamId，运行时按策略调度）
      onSelectTeam(t);
    }
    close();
  };

  const handleSelectSkill = (name: string) => {
    onSelectSkill(name);
    close();
  };

  const rootItemCls = (active: boolean) =>
    `flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] transition hover:bg-hover ${
      active ? "bg-hover text-accent-strong" : "text-ink"
    }`;

  return (
    <div ref={ref} className="relative flex items-center gap-[8px]">
      <button
        type="button"
        onClick={toggleOpen}
        title={t("plusMenu.triggerTitle")}
        className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-accent transition hover:bg-hover hover:text-accent-strong"
      >
        <IconPlus />
      </button>

      {selectedTeam ? (
        <div className="flex h-[26px] items-center overflow-hidden rounded-full border border-accent-line bg-accent-tint text-[12.5px] font-semibold text-accent-strong">
          <button
            type="button"
            onClick={toggleOpen}
            title={t("plusMenu.switchTeam")}
            className="flex h-full items-center gap-[6px] pl-[6px] pr-[2px] transition hover:bg-accent-line/40"
          >
            <span className="flex h-[16px] w-[16px] items-center justify-center rounded-[5px] bg-white text-accent">
              <IconUsers size={11} />
            </span>
            {selectedTeam.name}
          </button>
          <button
            type="button"
            onClick={onClearTeam}
            title={t("plusMenu.clearTeam")}
            className="flex h-full items-center px-[5px] text-accent opacity-60 transition hover:opacity-100"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : selected ? (
        <div className="flex h-[26px] items-center overflow-hidden rounded-full border border-accent-line bg-accent-tint text-[12.5px] font-semibold text-accent-strong">
          <button
            type="button"
            onClick={toggleOpen}
            title={t("plusMenu.switchExpert")}
            className="flex h-full items-center gap-[6px] pl-[6px] pr-[2px] transition hover:bg-accent-line/40"
          >
            <span className="flex h-[16px] w-[16px] items-center justify-center rounded-[5px] bg-white text-accent">
              {expertIcon(selected.icon)}
            </span>
            {selected.name}
          </button>
          <button
            type="button"
            onClick={onClearExpert}
            title={t("plusMenu.clearExpert")}
            className="flex h-full items-center px-[5px] text-accent opacity-60 transition hover:opacity-100"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : null}

      {open ? (
        // items-start：子菜单与根菜单顶部对齐；容器高度固定为根菜单高度（menuH），
        // 子菜单在其内滚动 → 一级菜单位置恒不动，子菜单超出部分减少显示条数
        <div
          className="absolute bottom-full left-0 z-30 mb-[6px] flex items-start"
          style={{ height: menuH }}
        >
          {/* 根菜单：分类 */}
          <div
            ref={rootRef}
            className="w-[150px] shrink-0 overflow-hidden rounded-[12px] border border-line bg-card py-[6px] shadow-pop"
          >
            <div className="px-[14px] pb-[4px] pt-[2px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
              {t("plusMenu.add")}
            </div>
            <button
              type="button"
              onClick={() => toggleSubmenu("experts")}
              className={rootItemCls(submenu === "experts")}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-accent-tint text-accent">
                <IconSparkles size={13} />
              </span>
              <span className="flex-1">{t("expert.tab.expert")}</span>
              <IconChevronRight size={11} className="opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => toggleSubmenu("teams")}
              className={rootItemCls(submenu === "teams")}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-hover text-ink-2">
                <IconUsers size={13} />
              </span>
              <span className="flex-1">{t("expert.tab.team")}</span>
              <IconChevronRight size={11} className="opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => toggleSubmenu("skills")}
              className={rootItemCls(submenu === "skills")}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-warn-tint text-warn">
                <IconSparkles size={13} />
              </span>
              <span className="flex-1">{t("expert.tab.skill")}</span>
              <IconChevronRight size={11} className="opacity-60" />
            </button>
            <button
              type="button"
              onClick={() => {
                onAddAttachment();
                close();
              }}
              className="flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] text-ink transition hover:bg-hover"
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-hover text-ink-2">
                <IconFile size={13} />
              </span>
              <span className="flex-1">{t("plusMenu.attachment")}</span>
            </button>
          </div>

          {/* 二级菜单：搜索 + 数量 + 滚动（内联渲染，避免嵌套组件导致搜索框失焦） */}
          {submenu ? (
            <div
              className="ml-[4px] flex min-h-0 w-[236px] flex-col overflow-hidden rounded-[12px] border border-line bg-card shadow-pop"
              style={{ maxHeight: subMax }}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-line px-[12px] py-[7px]">
                <span className="text-[11px] font-semibold tracking-[0.05em] text-ink-3">
                  {t(SUB_LABEL[submenu])}
                </span>
                <span className="text-[11px] text-ink-3">
                  {t("plusMenu.itemCount", {
                    num:
                      submenu === "experts"
                        ? experts.length
                        : submenu === "teams"
                          ? teams.length
                          : enabledSkills.length,
                  })}
                </span>
              </div>
              {!emptyBase ? (
                <div className="shrink-0 border-b border-line px-[10px] py-[6px]">
                  <div className="flex items-center gap-[6px] rounded-[7px] border border-line bg-paper px-[9px] py-[5px]">
                    <IconSearch size={12} className="shrink-0 text-ink-3" />
                    <input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t("plusMenu.searchPlaceholder")}
                      className="w-full bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                    />
                  </div>
                </div>
              ) : null}
              <div className="min-h-0 flex-1 overflow-y-auto py-[4px]">
                {emptyBase ? (
                  <div className="px-[14px] py-[10px] text-[13px] text-ink-3">
                    {submenu === "teams" ? t("plusMenu.noTeams") : t("plusMenu.noSkills")}
                  </div>
                ) : (submenu === "experts"
                    ? filteredExperts
                    : submenu === "teams"
                      ? filteredTeams
                      : filteredSkills
                  ).length === 0 ? (
                  <div className="px-[14px] py-[10px] text-[13px] text-ink-3">
                    {t("plusMenu.noMatch")}
                  </div>
                ) : submenu === "experts" ? (
                  filteredExperts.map((e) => {
                    const isActive =
                      e.id === expertId ||
                      (expertId === null && e.source === "builtin" && e.mode === mode);
                    return (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => handleSelectExpert(e)}
                        className={`flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] transition hover:bg-hover ${
                          isActive ? "bg-accent-tint font-semibold text-accent-strong" : "text-ink"
                        }`}
                      >
                        <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] bg-accent-tint text-accent">
                          {expertIcon(e.icon)}
                        </span>
                        <span className="flex-1 truncate">{e.name}</span>
                        <span className="text-[11px] font-medium text-ink-3">
                          {e.source === "builtin"
                            ? t("expert.source.builtin")
                            : e.mode === "daily"
                              ? t("plusMenu.modeDaily")
                              : t("plusMenu.modeCoding")}
                        </span>
                      </button>
                    );
                  })
                ) : submenu === "teams" ? (
                  <>
                    {filteredTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        onClick={() => handleSelectTeam(team)}
                        className="flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] text-ink transition hover:bg-hover"
                      >
                        <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] bg-hover text-ink-2">
                          <IconUsers size={13} />
                        </span>
                        <span className="flex-1 truncate">{team.name}</span>
                        <span className="text-[11px] font-medium text-ink-3">
                          {t("expert.memberCount", { num: teamMemberCount(team) })}
                        </span>
                      </button>
                    ))}
                    <div className="px-[14px] pb-[2px] pt-[6px] text-[11px] text-ink-3">
                      {t("plusMenu.teamNote")}
                    </div>
                  </>
                ) : (
                  filteredSkills.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => handleSelectSkill(s.name)}
                      className="flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] text-ink transition hover:bg-hover"
                    >
                      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] bg-warn-tint text-warn">
                        <IconSparkles size={13} />
                      </span>
                      <span className="flex-1 truncate">/{s.name}</span>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

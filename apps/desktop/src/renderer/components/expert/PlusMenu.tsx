/**
 * PlusMenu - 欢迎页输入框左下角「+」菜单：分类 + 二级子菜单。
 *
 * 根菜单：专家 / 专家团 / 技能 / 附件。
 *  - 专家 → 二级菜单列内置+自定义专家（当前模式优先）
 *  - 专家团 → 二级菜单列团队（本轮团队运行时未实现，选中取其首位成员作为当前助手）
 *  - 技能 → 二级菜单列已装技能，选中将 `/<name> ` 插入输入框
 *  - 附件 → 直接调 openPicker
 * 选中自定义专家后以 chip 显示在「+」旁（点 chip 重开菜单，× 清除）。
 */

import type { Expert, ExpertTeam } from "@everybuddy/ipc-contract";
import { useEffect, useRef, useState } from "react";
import { useExpertCenterStore } from "../../stores/expertCenterStore";
import { IconChevronRight, IconFile, IconPlus, IconSparkles, IconX } from "../icons";
import { IconUsers } from "./icons";
import { expertIcon } from "./ui";

type Submenu = "experts" | "teams" | "skills" | null;

export function PlusMenu({
  mode,
  expertId,
  onSelectExpert,
  onClearExpert,
  onAddAttachment,
  onSelectSkill,
}: {
  mode: "daily" | "coding";
  expertId: string | null;
  onSelectExpert: (e: Expert) => void;
  onClearExpert: () => void;
  onAddAttachment: () => void;
  onSelectSkill: (name: string) => void;
}) {
  const experts = useExpertCenterStore((s) => s.experts);
  const teams = useExpertCenterStore((s) => s.teams);
  const skills = useExpertCenterStore((s) => s.skills);
  const [open, setOpen] = useState(false);
  const [submenu, setSubmenu] = useState<Submenu>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const dismiss = () => {
      setOpen(false);
      setSubmenu(null);
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
  };

  const selected = experts.find((e) => e.id === expertId) ?? null;
  const orderedExperts = [
    ...experts.filter((e) => e.mode === mode),
    ...experts.filter((e) => e.mode !== mode),
  ];
  const enabledSkills = skills.filter((s) => s.enabled);

  const handleSelectExpert = (e: Expert) => {
    onSelectExpert(e);
    close();
  };

  const handleSelectTeam = (t: ExpertTeam) => {
    const first = experts.find((x) => x.id === t.expertIds[0]);
    if (first) onSelectExpert(first);
    close();
  };

  const handleSelectSkill = (name: string) => {
    onSelectSkill(name);
    close();
  };

  const toggleSubmenu = (s: Exclude<Submenu, null>) => setSubmenu((cur) => (cur === s ? null : s));

  return (
    <div ref={ref} className="relative flex items-center gap-[8px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="选择专家 / 专家团 / 技能，或添加附件"
        className="flex h-[28px] w-[28px] items-center justify-center rounded-s text-accent transition hover:bg-hover hover:text-accent-strong"
      >
        <IconPlus />
      </button>

      {selected ? (
        <div className="flex h-[26px] items-center overflow-hidden rounded-full border border-accent-line bg-accent-tint text-[12.5px] font-semibold text-accent-strong">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            title="点击更换专家"
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
            title="清除，回到当前 tab 内置助手"
            className="flex h-full items-center px-[5px] text-accent opacity-60 transition hover:opacity-100"
          >
            <IconX size={12} />
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="absolute bottom-full left-0 z-30 mb-[6px] flex items-start">
          {/* 根菜单：分类 */}
          <div className="w-[150px] overflow-hidden rounded-[12px] border border-line bg-card py-[6px] shadow-pop">
            <div className="px-[14px] pb-[4px] pt-[2px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
              添加
            </div>
            <button
              type="button"
              onMouseEnter={() => setSubmenu("experts")}
              onClick={() => toggleSubmenu("experts")}
              className={`flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] transition hover:bg-hover ${
                submenu === "experts" ? "bg-hover text-accent-strong" : "text-ink"
              }`}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-accent-tint text-accent">
                <IconSparkles size={13} />
              </span>
              <span className="flex-1">专家</span>
              <IconChevronRight size={11} className="opacity-60" />
            </button>
            <button
              type="button"
              onMouseEnter={() => setSubmenu("teams")}
              onClick={() => toggleSubmenu("teams")}
              className={`flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] transition hover:bg-hover ${
                submenu === "teams" ? "bg-hover text-accent-strong" : "text-ink"
              }`}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-hover text-ink-2">
                <IconUsers size={13} />
              </span>
              <span className="flex-1">专家团</span>
              <IconChevronRight size={11} className="opacity-60" />
            </button>
            <button
              type="button"
              onMouseEnter={() => setSubmenu("skills")}
              onClick={() => toggleSubmenu("skills")}
              className={`flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] transition hover:bg-hover ${
                submenu === "skills" ? "bg-hover text-accent-strong" : "text-ink"
              }`}
            >
              <span className="flex h-[20px] w-[20px] items-center justify-center rounded-[6px] bg-warn-tint text-warn">
                <IconSparkles size={13} />
              </span>
              <span className="flex-1">技能</span>
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
              <span className="flex-1">附件</span>
            </button>
          </div>

          {/* 二级菜单 */}
          {submenu ? (
            <div className="ml-[4px] w-[228px] overflow-hidden rounded-[12px] border border-line bg-card py-[6px] shadow-pop">
              {submenu === "experts" ? (
                <>
                  <div className="px-[14px] pb-[4px] pt-[2px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
                    选择专家
                  </div>
                  {orderedExperts.map((e) => {
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
                          {e.source === "builtin" ? "内置" : e.mode === "daily" ? "日常" : "开发"}
                        </span>
                      </button>
                    );
                  })}
                </>
              ) : null}

              {submenu === "teams" ? (
                <>
                  <div className="px-[14px] pb-[4px] pt-[2px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
                    选择专家团
                  </div>
                  {teams.length === 0 ? (
                    <div className="px-[14px] py-[10px] text-[13px] text-ink-3">暂无专家团</div>
                  ) : (
                    teams.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => handleSelectTeam(t)}
                        className="flex w-full items-center gap-[9px] px-[12px] py-[8px] text-left text-[14px] text-ink transition hover:bg-hover"
                      >
                        <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] bg-hover text-ink-2">
                          <IconUsers size={13} />
                        </span>
                        <span className="flex-1 truncate">{t.name}</span>
                        <span className="text-[11px] font-medium text-ink-3">
                          {t.expertIds.length} 人
                        </span>
                      </button>
                    ))
                  )}
                  <div className="px-[14px] pb-[2px] pt-[6px] text-[11px] text-ink-3">
                    团队调度后续支持，当前以其首位成员为助手
                  </div>
                </>
              ) : null}

              {submenu === "skills" ? (
                <>
                  <div className="px-[14px] pb-[4px] pt-[2px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
                    选择技能（/调用）
                  </div>
                  {enabledSkills.length === 0 ? (
                    <div className="px-[14px] py-[10px] text-[13px] text-ink-3">暂无可用技能</div>
                  ) : (
                    enabledSkills.map((s) => (
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
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

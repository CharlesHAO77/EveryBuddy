/**
 * PickList - 工具 / 扩展的「分组列表选择」受控组件（替代自由文本 chips）。
 *
 * 已选值渲染为可移除 chip（复用 ChipRemovable）；点「添加」弹向上 popover，
 * 分组 checkbox 勾选，底部手动输入兜底。用于 ExpertForm 的 tools/extensions 字段。
 */

import type { ExpertCatalog, ExpertCatalogExtension } from "@everybuddy/ipc-contract";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { IconCheck } from "./icons";
import { ChipRemovable } from "./ui";

function useDismiss(onClose: () => void, open: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** 单条 checkbox 项 */
function PickItem({
  name,
  desc,
  on,
  onClick,
  disabled = false,
  badge,
}: {
  name: string;
  desc?: string;
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  badge?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex w-full items-center gap-[10px] px-[12px] py-[7px] text-left text-[13.5px] transition ${
        disabled ? "cursor-not-allowed opacity-55" : "hover:bg-hover"
      }`}
    >
      <span
        className={`flex h-[17px] w-[17px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px] transition ${
          on ? "border-accent bg-accent text-white" : "border-line-strong"
        } ${disabled ? "border-line bg-active text-ink-3" : ""}`}
      >
        {on ? <IconCheck size={12} strokeWidth={2.5} /> : null}
      </span>
      <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
      {badge ? (
        <span className="rounded-[5px] bg-active px-[6px] py-[1px] text-[11px] font-semibold text-ink-3">
          {badge}
        </span>
      ) : desc ? (
        <span className="max-w-[150px] truncate text-[12px] text-ink-3">{desc}</span>
      ) : null}
    </button>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-[12px] pb-[2px] pt-[8px] text-[11px] font-semibold tracking-[0.05em] text-ink-3">
      {children}
    </div>
  );
}

const popoverCls =
  "absolute bottom-full left-0 z-30 mb-[6px] w-[340px] overflow-hidden rounded-[12px] border border-line bg-card shadow-pop";

const footerInputCls =
  "min-w-0 flex-1 rounded-full border border-dashed border-line-strong px-[12px] py-[5px] text-[13px] text-ink-3 outline-none transition placeholder:text-ink-3 focus:border-accent-line focus:text-ink-2";

const searchInputCls =
  "w-full rounded-[7px] border border-line bg-paper px-[9px] py-[5px] text-[13px] text-ink outline-none transition placeholder:text-ink-3 focus:border-accent-line focus:bg-card";

/** 工具多选：平台工具 / 已连接 MCP 工具 / 自定义残留 + 手动添加 */
export function ToolMultiSelect({
  value,
  onChange,
  catalog,
  mcpTools,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  catalog: ExpertCatalog;
  mcpTools: string[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const ref = useDismiss(() => setOpen(false), open);

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((x) => x !== name) : [...value, name]);
  const addDraft = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  const platformSet = new Set(catalog.tools.map((t) => t.name));
  const mcpSet = new Set(mcpTools);
  const custom = value.filter((v) => !platformSet.has(v) && !mcpSet.has(v));
  // 内容多时搜索过滤
  const fq = filter.trim().toLowerCase();
  const platformTools = catalog.tools.filter(
    (t) => !fq || t.name.toLowerCase().includes(fq) || t.description.toLowerCase().includes(fq),
  );
  const mcpList = mcpTools.filter((n) => !fq || n.toLowerCase().includes(fq));

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-[7px]">
        {value.map((t) => (
          <ChipRemovable key={t} onRemove={() => onChange(value.filter((x) => x !== t))}>
            {t}
          </ChipRemovable>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-dashed border-line-strong px-[12px] py-[4px] text-[13px] text-ink-3 transition hover:border-accent-line hover:text-accent"
        >
          {t("picklist.addTools")}
        </button>
      </div>
      {open ? (
        <div className={popoverCls}>
          <div className="border-b border-line px-[10px] py-[6px]">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("picklist.searchTools")}
              className={searchInputCls}
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto p-[4px]">
            {platformTools.length > 0 ? (
              <>
                <GroupLabel>{t("picklist.platformTools")}</GroupLabel>
                {platformTools.map((t) => (
                  <PickItem
                    key={t.name}
                    name={t.name}
                    desc={t.description}
                    on={value.includes(t.name)}
                    onClick={() => toggle(t.name)}
                  />
                ))}
              </>
            ) : null}
            {mcpList.length > 0 ? (
              <>
                <GroupLabel>{t("picklist.mcpTools")}</GroupLabel>
                {mcpList.map((n) => (
                  <PickItem
                    key={n}
                    name={n}
                    desc={t("picklist.mcpToolDesc")}
                    on={value.includes(n)}
                    onClick={() => toggle(n)}
                  />
                ))}
              </>
            ) : null}
            {custom.length > 0 ? (
              <>
                <GroupLabel>{t("expert.filter.custom")}</GroupLabel>
                {custom.map((n) => (
                  <PickItem
                    key={n}
                    name={n}
                    desc={t("expert.filter.custom")}
                    on
                    onClick={() => toggle(n)}
                  />
                ))}
              </>
            ) : null}
            {platformTools.length === 0 && mcpList.length === 0 ? (
              <div className="px-[12px] py-[10px] text-[13px] text-ink-3">
                {t("plusMenu.noMatch")}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-[8px] border-t border-line bg-paper px-[12px] py-[8px]">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder={t("picklist.manualToolPlaceholder")}
              className={footerInputCls}
            />
            <button
              type="button"
              onClick={addDraft}
              className="shrink-0 rounded-full bg-accent px-[12px] py-[5px] text-[13px] font-semibold text-white transition hover:bg-accent-strong"
            >
              {t("picklist.add")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** 扩展多选：目录勾选（permission 恒启用灰态）+ 手动添加兜底 */
export function ExtensionMultiSelect({
  value,
  onChange,
  options,
}: {
  value: string[];
  onChange: (v: string[]) => void;
  options: ExpertCatalogExtension[];
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const [filter, setFilter] = useState("");
  const ref = useDismiss(() => setOpen(false), open);

  const toggle = (name: string) =>
    onChange(value.includes(name) ? value.filter((x) => x !== name) : [...value, name]);
  const addDraft = () => {
    const t = draft.trim();
    if (t && !value.includes(t)) onChange([...value, t]);
    setDraft("");
  };

  const known = new Set(options.map((o) => o.name));
  const custom = value.filter((v) => !known.has(v));
  const fq = filter.trim().toLowerCase();
  const filteredOptions = options.filter(
    (o) => !fq || o.name.toLowerCase().includes(fq) || o.description.toLowerCase().includes(fq),
  );

  return (
    <div ref={ref} className="relative">
      <div className="flex flex-wrap items-center gap-[7px]">
        {value.map((t) => (
          <ChipRemovable key={t} onRemove={() => onChange(value.filter((x) => x !== t))}>
            {t}
          </ChipRemovable>
        ))}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-dashed border-line-strong px-[12px] py-[4px] text-[13px] text-ink-3 transition hover:border-accent-line hover:text-accent"
        >
          {t("picklist.addExtensions")}
        </button>
      </div>
      {open ? (
        <div className={popoverCls}>
          <div className="border-b border-line px-[10px] py-[6px]">
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("picklist.searchExtensions")}
              className={searchInputCls}
            />
          </div>
          <div className="max-h-[280px] overflow-y-auto p-[4px]">
            <GroupLabel>{t("picklist.extensionCatalog")}</GroupLabel>
            {filteredOptions.map((o) =>
              o.alwaysOn ? (
                <PickItem
                  key={o.name}
                  name={o.name}
                  desc={o.description}
                  badge={t("picklist.alwaysOn")}
                  on
                  disabled
                  onClick={() => {}}
                />
              ) : (
                <PickItem
                  key={o.name}
                  name={o.name}
                  desc={o.description}
                  on={value.includes(o.name)}
                  onClick={() => toggle(o.name)}
                />
              ),
            )}
            {custom.length > 0 ? (
              <>
                <GroupLabel>{t("expert.filter.custom")}</GroupLabel>
                {custom.map((n) => (
                  <PickItem
                    key={n}
                    name={n}
                    desc={t("expert.filter.custom")}
                    on
                    onClick={() => toggle(n)}
                  />
                ))}
              </>
            ) : null}
            {filteredOptions.length === 0 ? (
              <div className="px-[12px] py-[10px] text-[13px] text-ink-3">
                {t("plusMenu.noMatch")}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-[8px] border-t border-line bg-paper px-[12px] py-[8px]">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addDraft();
                }
              }}
              placeholder={t("picklist.manualExtensionPlaceholder")}
              className={footerInputCls}
            />
            <button
              type="button"
              onClick={addDraft}
              className="shrink-0 rounded-full bg-accent px-[12px] py-[5px] text-[13px] font-semibold text-white transition hover:bg-accent-strong"
            >
              {t("picklist.add")}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

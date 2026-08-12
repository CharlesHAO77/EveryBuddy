/**
 * useSlashCommands - / 命令弹窗状态机 + 回车/IME 组合态守卫。
 *
 * ChatView / WelcomeView 两个 textarea 共用：handleChange 探测 `/keyword` 开合弹窗；
 * handleKeyDown 在弹窗打开时处理方向键/回车选中/Esc 关闭，否则仅当 Enter（非 shift、
 * 非 IME 组合态）才触发发送 —— 修复中文输入法选词回车误发送的问题。
 */

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  filterSlashCommands,
  matchSlash,
  type SlashCommand,
  type SlashCommandCtx,
} from "../slashCommands";

interface UseSlashCommandsOptions {
  taskId: string | null;
  mode: "daily" | "coding" | null;
  /** 清空输入框（选中命令后） */
  setText: (value: string) => void;
  /** 真正发送消息 */
  onSend: () => void;
}

export function useSlashCommands({ taskId, mode, setText, onSend }: UseSlashCommandsOptions) {
  const [open, setOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);
  const [keyword, setKeyword] = useState("");
  /** IME 组合态标记（onCompositionStart/End 由调用方挂在 textarea 上） */
  const composingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const ctx: SlashCommandCtx = useMemo(() => ({ taskId, mode }), [taskId, mode]);
  const items = useMemo(
    () => (open ? filterSlashCommands(keyword, ctx) : []),
    [open, keyword, ctx],
  );

  // 关键字/上下文变化时复位高亮（setHighlightIndex 稳定，deps 仅作触发时机）
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps 用于在过滤/上下文变化时复位，函数体无需读取
  useEffect(() => {
    setHighlightIndex(0);
  }, [keyword, taskId, mode]);

  // 点外关闭
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const handleChange = (value: string) => {
    setText(value);
    const kw = matchSlash(value);
    setKeyword(kw ?? "");
    setOpen(kw !== null);
  };

  const selectCommand = (cmd: SlashCommand) => {
    setOpen(false);
    // 扩展命令（/steer /follow-up）：插入前缀并保持 textarea 焦点，等待用户继续输入参数
    if (cmd.insertPrefix) {
      setText(cmd.insertPrefix);
      return;
    }
    setText("");
    cmd.run(ctx);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 弹窗打开且有候选：方向键导航、Enter/Tab 选中、Esc 关闭
    if (open && items.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setHighlightIndex((i) => (i + 1) % items.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setHighlightIndex((i) => (i - 1 + items.length) % items.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const cmd = items[highlightIndex];
        if (cmd) selectCommand(cmd);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setOpen(false);
        return;
      }
    }
    // 发送：Enter（非 shift、非 IME 组合态）；Shift+Enter 换行
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && !composingRef.current) {
      e.preventDefault();
      onSend();
    }
  };

  return {
    containerRef,
    open,
    items,
    highlightIndex,
    composingRef,
    handleChange,
    handleKeyDown,
    selectCommand,
  };
}

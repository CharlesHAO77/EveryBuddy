/**
 * useScheduleStream - 订阅 schedule:event 并更新 automationStore（在 App 顶层调用一次）。
 * 同时拉取一次任务列表，与 useAgentStream 并列。
 */

import { useEffect } from "react";
import { useAutomationStore } from "../stores/automationStore";

export function useScheduleStream(): void {
  useEffect(() => {
    const unsubscribe = window.electronAPI.schedule.onEvent((event) => {
      useAutomationStore.getState().handleEvent(event);
    });
    void useAutomationStore.getState().loadTasks();
    return unsubscribe;
  }, []);
}

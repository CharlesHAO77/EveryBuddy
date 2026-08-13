/**
 * automationStore - 自动化（定时任务）状态（Zustand）。
 * 任务列表 + 每任务运行历史；订阅 schedule:event 实时 upsert（事件先于 loadTasks 到达也能正确落位）。
 */

import type {
  CreateScheduleTaskRequest,
  ScheduledRun,
  ScheduledTask,
  ScheduleEvent,
  UpdateScheduleTaskRequest,
} from "@everybuddy/ipc-contract";
import { create } from "zustand";

function upsertTask(tasks: ScheduledTask[], task: ScheduledTask): ScheduledTask[] {
  const idx = tasks.findIndex((t) => t.id === task.id);
  if (idx < 0) return [task, ...tasks];
  const next = [...tasks];
  next[idx] = task;
  return next;
}

function prependRun(runsByTask: Record<string, ScheduledRun[]>, run: ScheduledRun) {
  const existing = runsByTask[run.taskId] ?? [];
  return { ...runsByTask, [run.taskId]: [run, ...existing.filter((r) => r.id !== run.id)] };
}

function upsertRun(runsByTask: Record<string, ScheduledRun[]>, run: ScheduledRun) {
  const existing = runsByTask[run.taskId] ?? [];
  const idx = existing.findIndex((r) => r.id === run.id);
  if (idx < 0) return { ...runsByTask, [run.taskId]: [run, ...existing] };
  const next = [...existing];
  next[idx] = run;
  return { ...runsByTask, [run.taskId]: next };
}

interface AutomationState {
  tasks: ScheduledTask[];
  loaded: boolean;
  /** 每任务运行历史（新 → 旧） */
  runsByTask: Record<string, ScheduledRun[]>;

  loadTasks: () => Promise<void>;
  loadRuns: (taskId: string) => Promise<void>;
  createTask: (req: CreateScheduleTaskRequest) => Promise<ScheduledTask>;
  updateTask: (id: string, patch: Omit<UpdateScheduleTaskRequest, "id">) => Promise<ScheduledTask>;
  deleteTask: (id: string) => Promise<void>;
  runNow: (id: string) => Promise<void>;
  handleEvent: (event: ScheduleEvent) => void;
}

export const useAutomationStore = create<AutomationState>((set, get) => ({
  tasks: [],
  loaded: false,
  runsByTask: {},

  loadTasks: async () => {
    const tasks = await window.electronAPI.schedule.listTasks();
    set({ tasks, loaded: true });
  },

  loadRuns: async (taskId) => {
    const runs = await window.electronAPI.schedule.listRuns(taskId);
    set((s) => ({ runsByTask: { ...s.runsByTask, [taskId]: runs } }));
  },

  createTask: async (req) => {
    const task = await window.electronAPI.schedule.createTask(req);
    set((s) => ({ tasks: upsertTask(s.tasks, task) }));
    return task;
  },

  updateTask: async (id, patch) => {
    const task = await window.electronAPI.schedule.updateTask({ id, ...patch });
    set((s) => ({ tasks: upsertTask(s.tasks, task) }));
    return task;
  },

  deleteTask: async (id) => {
    await window.electronAPI.schedule.deleteTask(id);
    set((s) => {
      const runsByTask = { ...s.runsByTask };
      delete runsByTask[id];
      return { tasks: s.tasks.filter((t) => t.id !== id), runsByTask };
    });
  },

  runNow: async (id) => {
    await window.electronAPI.schedule.runNow(id);
  },

  handleEvent: (event) => {
    const s = get();
    switch (event.type) {
      case "task_updated":
        set({ tasks: upsertTask(s.tasks, event.payload.task) });
        break;
      case "task_deleted":
        set({ tasks: s.tasks.filter((t) => t.id !== event.payload.id) });
        break;
      case "run_started":
        set({ runsByTask: prependRun(s.runsByTask, event.payload.run) });
        break;
      case "run_finished": {
        set({
          tasks: upsertTask(s.tasks, event.payload.task),
          runsByTask: upsertRun(s.runsByTask, event.payload.run),
        });
        break;
      }
    }
  },
}));

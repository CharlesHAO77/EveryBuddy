import { useEffect } from "react";
import { MainView } from "./components/MainView";
import { RightPanel } from "./components/RightPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { Sidebar } from "./components/Sidebar";
import { useAgentStream } from "./hooks/useAgentStream";
import { useScheduleStream } from "./hooks/useScheduleStream";
import { useSessionStore } from "./stores/sessionStore";
import { useUIStore } from "./stores/uiStore";

export function App() {
  useAgentStream();
  useScheduleStream();

  const initFromBackend = useSessionStore((s) => s.initFromBackend);
  const sessionLoaded = useSessionStore((s) => s.loaded);
  const loadModels = useUIStore((s) => s.loadModels);
  const models = useUIStore((s) => s.models);
  const uiLoaded = useUIStore((s) => s.loaded);
  const isSettingsOpen = useUIStore((s) => s.isSettingsOpen);
  const setSettingsOpen = useUIStore((s) => s.setSettingsOpen);
  const setSettingsSection = useUIStore((s) => s.setSettingsSection);

  const currentTaskTitle = useSessionStore(
    (s) => s.tasks.find((t) => t.id === s.currentTaskId)?.title ?? null,
  );
  // 自动化页不需要右侧面板（待办/文件/预览）
  const activeNav = useUIStore((s) => s.activeNav);

  // Windows 已启用自定义标题栏，对话名在应用内标题区展示，系统标题固定为 EveryBuddy
  //（避免任务栏/Alt+Tab 重复显示对话名）；macOS 保留「EveryBuddy · 对话名」供 Mission Control 使用。
  const isWindows = document.documentElement.dataset.platform === "win";
  useEffect(() => {
    document.title =
      isWindows || !currentTaskTitle ? "EveryBuddy" : `EveryBuddy · ${currentTaskTitle}`;
  }, [isWindows, currentTaskTitle]);

  useEffect(() => {
    // 加载任务/工作空间/模型配置
    Promise.all([window.electronAPI.task.list(), window.electronAPI.workspace.list()]).then(
      ([tasks, workspaces]) => {
        initFromBackend(tasks, workspaces);
      },
    );
    void loadModels();
  }, [initFromBackend, loadModels]);

  // 若没有任何可对话（聊天）模型，自动打开设置并落到「模型设置」，避免发送消息后无回复
  useEffect(() => {
    if (sessionLoaded && uiLoaded && models.filter((m) => m.type !== "image").length === 0) {
      setSettingsSection("models");
      setSettingsOpen(true);
    }
  }, [sessionLoaded, uiLoaded, models, setSettingsSection, setSettingsOpen]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-paper">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <MainView />
        {activeNav !== "auto" && <RightPanel />}
      </div>
      {isSettingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

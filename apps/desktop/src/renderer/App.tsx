import { useEffect } from "react";
import { MainView } from "./components/MainView";
import { ModelSettings } from "./components/ModelSettings";
import { Sidebar } from "./components/Sidebar";
import { useAgentStream } from "./hooks/useAgentStream";
import { useSessionStore } from "./stores/sessionStore";
import { useUIStore } from "./stores/uiStore";

export function App() {
  useAgentStream();

  const initFromBackend = useSessionStore((s) => s.initFromBackend);
  const sessionLoaded = useSessionStore((s) => s.loaded);
  const loadModels = useUIStore((s) => s.loadModels);
  const models = useUIStore((s) => s.models);
  const uiLoaded = useUIStore((s) => s.loaded);
  const isModelSettingsOpen = useUIStore((s) => s.isModelSettingsOpen);
  const setModelSettingsOpen = useUIStore((s) => s.setModelSettingsOpen);

  const currentTaskTitle = useSessionStore(
    (s) => s.tasks.find((t) => t.id === s.currentTaskId)?.title ?? null,
  );

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

  // 若没有任何模型配置，自动打开模型设置面板，避免发送消息后无回复
  useEffect(() => {
    if (sessionLoaded && uiLoaded && models.length === 0) {
      setModelSettingsOpen(true);
    }
  }, [sessionLoaded, uiLoaded, models.length, setModelSettingsOpen]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-paper">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar />
        <MainView />
      </div>
      {isModelSettingsOpen && <ModelSettings onClose={() => setModelSettingsOpen(false)} />}
    </div>
  );
}

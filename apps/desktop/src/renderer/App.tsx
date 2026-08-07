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

  // 同步窗口标题（mac Mission Control / Win·Linux 系统标题栏显示对话名）
  useEffect(() => {
    document.title = currentTaskTitle ? `EveryBuddy · ${currentTaskTitle}` : "EveryBuddy";
  }, [currentTaskTitle]);

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

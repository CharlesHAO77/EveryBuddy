import { useEffect } from "react";
import { MainView } from "./components/MainView";
import { Sidebar } from "./components/Sidebar";
import { useAgentStream } from "./hooks/useAgentStream";
import { useSessionStore } from "./stores/sessionStore";
import { useUIStore } from "./stores/uiStore";

export function App() {
  useAgentStream();

  const initFromBackend = useSessionStore((s) => s.initFromBackend);
  const _loaded = useSessionStore((s) => s.loaded);
  const loadModels = useUIStore((s) => s.loadModels);

  useEffect(() => {
    // 加载任务/工作空间/模型配置
    Promise.all([window.electronAPI.task.list(), window.electronAPI.workspace.list()]).then(
      ([tasks, workspaces]) => {
        initFromBackend(tasks, workspaces);
      },
    );
    void loadModels();
  }, [initFromBackend, loadModels]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-main)]">
      <Sidebar />
      <MainView />
    </div>
  );
}

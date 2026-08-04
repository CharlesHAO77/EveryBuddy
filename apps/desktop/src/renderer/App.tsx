import { Sidebar } from "./components/Sidebar";
import { MainView } from "./components/MainView";

export function App() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-[var(--bg-main)]">
      <Sidebar />
      <MainView />
    </div>
  );
}

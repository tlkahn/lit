import { useEffect, useState } from "react";
import { Sidebar } from "./components/Sidebar";
import { ContentArea } from "./components/ContentArea";
import { ThemeToggle } from "./components/ThemeToggle";
import { SidebarPositionToggle } from "./components/SidebarPositionToggle";
import { useTheme } from "./hooks/useTheme";
import { useSidebarPosition } from "./hooks/useSidebarPosition";
import { getAppInfo, type AppInfo } from "./lib/ipc";

function App() {
  const { theme, toggleTheme } = useTheme();
  const { position, togglePosition } = useSidebarPosition();
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    getAppInfo().then(setAppInfo);
  }, []);

  return (
    <div className={`flex h-screen ${position === "right" ? "flex-row-reverse" : "flex-row"}`}>
      <Sidebar />
      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-700">
          <SidebarPositionToggle position={position} onToggle={togglePosition} />
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </header>
        <ContentArea appName={appInfo?.name} appVersion={appInfo?.version} />
      </div>
    </div>
  );
}

export default App;

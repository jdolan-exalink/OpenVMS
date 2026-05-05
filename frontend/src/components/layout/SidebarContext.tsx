import { createContext, useContext, useState, ReactNode } from "react";

const SIDEBAR_KEY = "openvms_sidebar_collapsed";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (v: boolean) => void;
}

const SidebarContext = createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => {},
});

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === "true";
    } catch {
      return false;
    }
  });

  function setCollapsed(v: boolean) {
    try {
      localStorage.setItem(SIDEBAR_KEY, String(v));
    } catch {}
    setCollapsedState(v);
  }

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed }}>
      {children}
    </SidebarContext.Provider>
  );
}

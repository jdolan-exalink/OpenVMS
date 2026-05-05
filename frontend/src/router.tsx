import { createBrowserRouter, Navigate } from "react-router-dom";
import Layout from "./components/layout/Layout";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import LiveView from "./pages/LiveView";
import Events from "./pages/Events";
import Playback from "./pages/Playback";
import Settings from "./pages/Settings";
import EnterpriseAnalytics from "./pages/EnterpriseAnalytics";
import PluginPage from "./pages/PluginPage";
import CameraWizard from "./pages/CameraWizard";
import { useAuthStore } from "./store/authStore";

function RequireAuth({ children }: { children: JSX.Element }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: (
      <RequireAuth>
        <Layout />
      </RequireAuth>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: "live", element: <LiveView /> },
      { path: "events", element: <Events /> },
      { path: "playback", element: <Playback /> },
      { path: "enterprise-analytics", element: <EnterpriseAnalytics /> },
      { path: "settings", element: <Settings /> },
      { path: "cameras/new", element: <CameraWizard /> },
      { path: "plugins/:pluginName", element: <PluginPage /> },
    ],
  },
  { path: "*", element: <Navigate to="/" replace /> },
]);

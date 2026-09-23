import { useRoute } from "wouter";
import AdminLayout from "./AdminLayout";
import AdminDashboard from "./Dashboard";
import AdminRequests from "./Requests";
import AdminUsers from "./Users";
import AdminCache from "./Cache";
import AdminPremium from "./Premium";
import AdminAds from "./Ads";

export default function AdminPage() {
  const [, params] = useRoute("/admin/:rest*");
  const section = (params as Record<string, string>)?.["rest*"] ?? "";

  return (
    <AdminLayout>
      {section === "" || section === "dashboard" ? (
        <AdminDashboard />
      ) : section === "requests" ? (
        <AdminRequests />
      ) : section === "users" ? (
        <AdminUsers />
      ) : section === "cache" ? (
        <AdminCache />
      ) : section === "premium" ? (
        <AdminPremium />
      ) : section === "ads" ? (
        <AdminAds />
      ) : (
        <AdminDashboard />
      )}
    </AdminLayout>
  );
}

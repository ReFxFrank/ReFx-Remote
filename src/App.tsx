import { useEffect } from "react";
import { useAuth } from "./store/auth";
import { useNav } from "./store/nav";
import { isStaffPerms } from "./lib/perms";
import SignIn from "./screens/SignIn";
import Servers from "./screens/Servers";
import AdminApp from "./components/admin/AdminApp";
import { Aurora } from "./components/Logo";
import UpdateBanner from "./components/UpdateBanner";

export default function App() {
  const { status, init, profile } = useAuth();
  const view = useNav((s) => s.view);
  const staff = isStaffPerms(profile?.permissions);

  useEffect(() => {
    void init();
  }, [init]);

  // Show the admin surface only to staff, even if a stale "admin" view lingers
  // (e.g. after signing out of a staff account into a customer one).
  const signedInView = staff && view === "admin" ? <AdminApp /> : <Servers />;

  return (
    <>
      <Aurora />
      <UpdateBanner />
      {status === "loading" ? (
        <main className="flex h-screen items-center justify-center">
          <p className="text-sm text-muted-foreground">Starting…</p>
        </main>
      ) : status === "signedIn" ? (
        signedInView
      ) : (
        <SignIn />
      )}
    </>
  );
}

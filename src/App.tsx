import { useEffect } from "react";
import { useAuth } from "./store/auth";
import SignIn from "./screens/SignIn";
import Servers from "./screens/Servers";
import { Aurora } from "./components/Logo";
import UpdateBanner from "./components/UpdateBanner";

export default function App() {
  const { status, init } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  return (
    <>
      <Aurora />
      <UpdateBanner />
      {status === "loading" ? (
        <main className="flex h-screen items-center justify-center">
          <p className="text-sm text-muted-foreground">Starting…</p>
        </main>
      ) : status === "signedIn" ? (
        <Servers />
      ) : (
        <SignIn />
      )}
    </>
  );
}

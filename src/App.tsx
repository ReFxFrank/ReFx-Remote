import { useEffect } from "react";
import { useAuth } from "./store/auth";
import SignIn from "./screens/SignIn";
import Home from "./screens/Home";

export default function App() {
  const { status, init } = useAuth();

  useEffect(() => {
    void init();
  }, [init]);

  if (status === "loading") {
    return (
      <main className="flex h-screen items-center justify-center bg-zinc-950">
        <p className="text-sm text-zinc-500">Starting…</p>
      </main>
    );
  }
  if (status === "signedIn") return <Home />;
  return <SignIn />;
}

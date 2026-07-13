import { create } from "zustand";
import { errorMessage, ipc, type Profile } from "../lib/ipc";

type Status = "loading" | "signedOut" | "mfa" | "signedIn";

type AuthStore = {
  status: Status;
  profile: Profile | null;
  mfaMethods: string[];
  busy: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  verifyMfa: (code: string, method?: "totp" | "recovery") => Promise<void>;
  backToSignIn: () => void;
  sessionExpired: () => void;
  logout: () => Promise<void>;
  clearError: () => void;
};

export const useAuth = create<AuthStore>((set, get) => ({
  status: "loading",
  profile: null,
  mfaMethods: [],
  busy: false,
  error: null,

  init: async () => {
    try {
      const s = await ipc.authStatus();
      set(
        s.signedIn
          ? { status: "signedIn", profile: s.profile ?? null, error: null }
          : { status: "signedOut", profile: null },
      );
    } catch (e) {
      set({ status: "signedOut", profile: null, error: errorMessage(e) });
    }
  },

  // Note: busy stays true until init() resolves — releasing it earlier
  // re-enables the submit button mid-flight and invites a double submit.
  login: async (email, password, remember) => {
    set({ busy: true, error: null });
    try {
      const result = await ipc.authLogin(email, password, remember);
      if (result.status === "mfa") {
        set({ status: "mfa", mfaMethods: result.methods, busy: false });
        return;
      }
      await get().init();
      set({ busy: false });
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
    }
  },

  verifyMfa: async (code, method) => {
    set({ busy: true, error: null });
    try {
      await ipc.authMfaVerify(code, method);
      await get().init();
      set({ busy: false });
    } catch (e) {
      set({ busy: false, error: errorMessage(e) });
    }
  },

  backToSignIn: () => set({ status: "signedOut", mfaMethods: [], error: null }),

  // Called when any authed request discovers the session died server-side
  // (revoked from another device, refresh-family revocation). Route back to
  // sign-in instead of stranding the user on a stale, silently-failing screen.
  sessionExpired: () =>
    set({
      status: "signedOut",
      profile: null,
      mfaMethods: [],
      error: "You were signed out. Please sign in again.",
    }),

  logout: async () => {
    set({ busy: true, error: null });
    try {
      await ipc.authLogout();
    } catch {
      // Local sign-out always wins; server revocation is best-effort.
    }
    set({ status: "signedOut", profile: null, busy: false });
  },

  clearError: () => set({ error: null }),
}));

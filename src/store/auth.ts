import { create } from "zustand";
import { errorMessage, ipc, isIpcError, type Profile } from "../lib/ipc";

type Status = "loading" | "signedOut" | "offline" | "mfa" | "signedIn";

// Auto-retry timer for the offline/reconnecting state. Module-scoped so it
// survives store updates and never stacks.
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
function clearReconnect() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

type AuthStore = {
  status: Status;
  profile: Profile | null;
  mfaMethods: string[];
  busy: boolean;
  error: string | null;
  init: () => Promise<void>;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  verifyMfa: (code: string, method?: "totp" | "recovery") => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
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
    clearReconnect();
    try {
      const s = await ipc.authStatus();
      if (s.signedIn) {
        set({ status: "signedIn", profile: s.profile ?? null, error: null });
      } else if (s.offline) {
        // A resumable session exists but the server is unreachable. Show a
        // reconnecting state and retry, rather than forcing a re-login.
        set({ status: "offline", profile: null, error: null });
        reconnectTimer = setTimeout(() => void get().init(), 4000);
      } else {
        set({ status: "signedOut", profile: null });
      }
    } catch (e) {
      // A network error with an unknown session state: keep trying instead of
      // dropping to sign-in. Anything else is a genuine signed-out.
      if (isIpcError(e) && e.code === "NETWORK") {
        set({ status: "offline", profile: null, error: null });
        reconnectTimer = setTimeout(() => void get().init(), 4000);
      } else {
        set({ status: "signedOut", profile: null, error: errorMessage(e) });
      }
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

  // Change password while the account is locked for a required change. On
  // success the backend clears `mustChangePassword`; re-running init() re-reads
  // the profile and lands us on the app (or on sign-in if the change ended the
  // session).
  changePassword: async (current, next) => {
    set({ busy: true, error: null });
    try {
      await ipc.accountPassword(current, next);
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
    clearReconnect();
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

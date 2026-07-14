import { create } from "zustand";

/** In-window views. The app uses no router — navigation is in-memory state. */
export type View = "customer" | "admin";

/** Admin screens. Screens not yet implemented render a "coming soon" placeholder. */
export type AdminScreen =
  | "dashboard"
  | "servers"
  | "users"
  | "nodes"
  | "locations"
  | "database-hosts"
  | "templates"
  | "support"
  | "audit"
  | "alerts"
  | "invoices"
  | "subscriptions"
  | "payments"
  | "orders"
  | "growth"
  | "coupons"
  | "gift-cards"
  | "products"
  | "content"
  | "team"
  | "roles"
  | "settings";

type NavStore = {
  view: View;
  adminScreen: AdminScreen;
  setView: (v: View) => void;
  goAdmin: (screen: AdminScreen) => void;
};

export const useNav = create<NavStore>((set) => ({
  view: "customer",
  adminScreen: "servers",
  setView: (view) => set({ view }),
  goAdmin: (screen) => set({ view: "admin", adminScreen: screen }),
}));

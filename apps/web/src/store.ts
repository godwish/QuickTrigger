import { create } from "zustand";

import { getCurrentLanguage, translate, useLocaleStore, type SupportedLanguage } from "./i18n";
import {
  ApiError,
  api,
  clearStoredAuthToken,
  cloneCategories,
  createClientId,
  type DashboardTransferPayload,
  findItemLocation,
  moveCategoryToCell,
  moveItemSnapshot,
  normalizeCategories,
  sortCategoriesByPosition,
  setStoredAuthToken,
  type DashboardItemMove,
  type DashboardCategory,
  type InstallStatus,
  type DashboardSetting,
  type Role,
  type Toast,
  type User
} from "./lib";

const HISTORY_LIMIT = 30;

function t(key: Parameters<typeof translate>[1], params?: Record<string, string | number>) {
  return translate(getCurrentLanguage(), key, params);
}

type ToastState = {
  toasts: Toast[];
  push: (toast: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (toast) =>
    set((state) => ({
      toasts: [
        ...state.toasts,
        {
          ...toast,
          id: createClientId()
        }
      ]
    })),
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id)
    }))
}));

type DashboardStore = {
  settings: DashboardSetting | null;
  categories: DashboardCategory[];
  status: "idle" | "loading" | "ready";
  editMode: boolean;
  isSaving: boolean;
  past: DashboardCategory[][];
  future: DashboardCategory[][];
  loadDashboard: () => Promise<void>;
  reset: () => void;
  setEditMode: (value: boolean) => void;
  updateSettings: (payload: { title: string; columnCount: number; language: SupportedLanguage }) => Promise<void>;
  exportDashboard: () => Promise<DashboardTransferPayload>;
  importDashboard: (payload: unknown) => Promise<void>;
  createCategory: (payload: { title: string; color: string; targetX?: number; targetY?: number }) => Promise<void>;
  updateCategory: (id: string, payload: { title?: string; color?: string }) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  moveCategory: (categoryId: string, targetX: number, targetY: number) => Promise<void>;
  createItem: (payload: { categoryId: string; displayName: string; url: string }) => Promise<void>;
  updateItem: (id: string, payload: { displayName?: string; url?: string }) => Promise<void>;
  deleteItem: (id: string) => Promise<void>;
  moveItem: (move: DashboardItemMove) => Promise<void>;
  undo: () => Promise<void>;
  redo: () => Promise<void>;
};

function pushError(message: string) {
  useToastStore.getState().push({
    tone: "error",
    title: t("toast.saveFailed"),
    description: message
  });
}

function pushSuccess(title: string, description?: string) {
  useToastStore.getState().push({
    tone: "success",
    title,
    description
  });
}

function trimHistory(history: DashboardCategory[][]) {
  return history.slice(-HISTORY_LIMIT);
}

function syncSettingsLanguage(settings: Pick<DashboardSetting, "language"> | null | undefined) {
  if (!settings?.language) {
    return;
  }

  useLocaleStore.getState().setLanguage(settings.language);
}

export const useDashboardStore = create<DashboardStore>((set, get) => ({
  settings: null,
  categories: [],
  status: "idle",
  editMode: false,
  isSaving: false,
  past: [],
  future: [],
  loadDashboard: async () => {
    set({ status: "loading" });

    try {
      const payload = await api.getDashboard();
      syncSettingsLanguage(payload.settings);
      set({
        settings: payload.settings,
        categories: normalizeCategories(sortCategoriesByPosition(payload.categories)),
        status: "ready",
        past: [],
        future: []
      });
    } catch (error) {
      set({ status: "ready" });
      pushError(error instanceof Error ? error.message : t("dashboard.loadFailed"));
    }
  },
  reset: () =>
    set({
      settings: null,
      categories: [],
      status: "idle",
      editMode: false,
      isSaving: false,
      past: [],
      future: []
    }),
  setEditMode: (value) => set({ editMode: value }),
  updateSettings: async (payload) => {
    set({ isSaving: true });

    try {
      const settings = await api.updateSettings(payload);
      syncSettingsLanguage(settings);
      set({ settings, isSaving: false });
      pushSuccess(translate(settings.language, "dashboard.settingsSaved"));
    } catch (error) {
      set({ isSaving: false });
      pushError(error instanceof Error ? error.message : t("dashboard.settingsSaveFailed"));
      throw error;
    }
  },
  exportDashboard: async () => {
    return api.exportDashboard();
  },
  importDashboard: async (payload) => {
    set({ isSaving: true });

    try {
      const next = await api.importDashboard(payload);
      syncSettingsLanguage(next.settings);
      set({
        settings: next.settings,
        categories: normalizeCategories(sortCategoriesByPosition(next.categories)),
        past: [],
        future: [],
        editMode: false,
        isSaving: false,
        status: "ready"
      });
      pushSuccess(t("dashboard.imported"));
    } catch (error) {
      set({ isSaving: false });
      pushError(error instanceof Error ? error.message : t("dashboard.importFailed"));
      throw error;
    }
  },
  createCategory: async (payload) => {
    set({ isSaving: true });

    try {
      const category = await api.createCategory(payload);
      const current = cloneCategories(get().categories);
      const past = get().past;
      const future = get().future;
      const appended = normalizeCategories([...current, category]);
      const hasTarget = Number.isFinite(payload.targetX) && Number.isFinite(payload.targetY);
      const next = hasTarget
        ? moveCategoryToCell(
            appended,
            category.id,
            Number(payload.targetX),
            Number(payload.targetY),
            get().settings?.columnCount ?? 6
          )
        : appended;

      if (hasTarget) {
        await api.syncDashboard(next);
      }

      set({
        categories: next,
        past: trimHistory([...past, cloneCategories(current)]),
        future: [],
        isSaving: false
      });
    } catch (error) {
      set({ isSaving: false });
      pushError(error instanceof Error ? error.message : t("dashboard.categoryCreateFailed"));
      throw error;
    }
  },
  updateCategory: async (id, payload) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const next = normalizeCategories(
      previous.map((category) => (category.id === id ? { ...category, ...payload } : category))
    );

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.updateCategory(id, payload);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.categoryUpdateFailed"));
      throw error;
    }
  },
  deleteCategory: async (id) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const next = normalizeCategories(previous.filter((category) => category.id !== id));

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.deleteCategory(id);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.categoryDeleteFailed"));
      throw error;
    }
  },
  moveCategory: async (categoryId, targetX, targetY) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const activeCategory = previous.find((category) => category.id === categoryId);
    const columnCount = get().settings?.columnCount ?? 6;

    if (!activeCategory) {
      return;
    }

    if (activeCategory.gridX === targetX && activeCategory.gridY === targetY) {
      return;
    }

    const next = moveCategoryToCell(previous, categoryId, targetX, targetY, columnCount);

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.syncDashboard(next);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.categoryMoveFailed"));
      throw error;
    }
  },
  createItem: async (payload) => {
    set({ isSaving: true });

    try {
      const item = await api.createItem(payload);
      const previous = cloneCategories(get().categories);
      const past = get().past;
      const future = get().future;
      const next = normalizeCategories(
        previous.map((category) =>
          category.id === payload.categoryId ? { ...category, items: [...category.items, item] } : category
        )
      );

      set({
        categories: next,
        past: trimHistory([...past, cloneCategories(previous)]),
        future: [],
        isSaving: false
      });
    } catch (error) {
      set({ isSaving: false });
      pushError(error instanceof Error ? error.message : t("dashboard.itemCreateFailed"));
      throw error;
    }
  },
  updateItem: async (id, payload) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const next = normalizeCategories(
      previous.map((category) => ({
        ...category,
        items: category.items.map((item) => (item.id === id ? { ...item, ...payload } : item))
      }))
    );

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.updateItem(id, payload);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.itemUpdateFailed"));
      throw error;
    }
  },
  deleteItem: async (id) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const location = findItemLocation(previous, id);

    if (!location) {
      return;
    }

    const next = normalizeCategories(
      previous.map((category) =>
        category.id === location.category.id
          ? { ...category, items: category.items.filter((item) => item.id !== id) }
          : category
      )
    );

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.deleteItem(id);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.itemDeleteFailed"));
      throw error;
    }
  },
  moveItem: async (move) => {
    const previous = cloneCategories(get().categories);
    const past = get().past;
    const future = get().future;
    const source = findItemLocation(previous, move.itemId);

    if (!source) {
      return;
    }

    const next = moveItemSnapshot(previous, move);

    if (JSON.stringify(next) === JSON.stringify(previous)) {
      return;
    }

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(previous)]),
      future: [],
      isSaving: true
    });

    try {
      await api.syncDashboard(next);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: previous,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.itemMoveFailed"));
      throw error;
    }
  },
  undo: async () => {
    const past = get().past;

    if (!past.length) {
      return;
    }

    const previous = cloneCategories(past[past.length - 1] ?? []);
    const current = cloneCategories(get().categories);
    const future = get().future;

    set({
      categories: previous,
      past: past.slice(0, -1),
      future: trimHistory([cloneCategories(current), ...future]),
      isSaving: true
    });

    try {
      await api.syncDashboard(previous);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: current,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.undoFailed"));
      throw error;
    }
  },
  redo: async () => {
    const future = get().future;

    if (!future.length) {
      return;
    }

    const next = cloneCategories(future[0] ?? []);
    const current = cloneCategories(get().categories);
    const past = get().past;

    set({
      categories: next,
      past: trimHistory([...past, cloneCategories(current)]),
      future: future.slice(1),
      isSaving: true
    });

    try {
      await api.syncDashboard(next);
      set({ isSaving: false });
    } catch (error) {
      set({
        categories: current,
        past,
        future,
        isSaving: false
      });
      pushError(error instanceof Error ? error.message : t("dashboard.redoFailed"));
      throw error;
    }
  }
}));

type SessionState = {
  user: User | null;
  status: "idle" | "loading" | "ready";
  loadSession: () => Promise<void>;
  login: (payload: { username: string; password: string }) => Promise<void>;
  logout: () => Promise<void>;
  setSession: (payload: { user: User; token: string }) => void;
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) => Promise<void>;
};

export const useSessionStore = create<SessionState>((set) => ({
  user: null,
  status: "idle",
  loadSession: async () => {
    set({ status: "loading" });

    try {
      const payload = await api.me();
      setStoredAuthToken(payload.token);
      set({ user: payload.user, status: "ready" });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) {
        pushError(error instanceof Error ? error.message : t("session.loadFailed"));
      }

      clearStoredAuthToken();
      set({ user: null, status: "ready" });
    }
  },
  login: async (payload) => {
    const response = await api.login(payload);
    setStoredAuthToken(response.token);
    set({ user: response.user, status: "ready" });
  },
  setSession: ({ user, token }) => {
    setStoredAuthToken(token);
    set({ user, status: "ready" });
  },
  logout: async () => {
    try {
      await api.logout();
    } finally {
      clearStoredAuthToken();
      set({ user: null, status: "ready" });
      useDashboardStore.getState().reset();
    }
  },
  changePassword: async (payload) => {
    await api.changePassword(payload);
  }
}));

type InstallState = {
  installStatus: InstallStatus | null;
  status: "idle" | "loading" | "ready";
  loadStatus: () => Promise<void>;
  configureDatabase: (payload:
    | {
        provider: "sqlite";
      }
    | {
        provider: "mysql";
        address: string;
        database: string;
        username: string;
        password: string;
      }) => Promise<InstallStatus>;
  completeInstallation: (payload: {
    username: string;
    password: string;
    confirmPassword: string;
    dashboardTitle: string;
    language: SupportedLanguage;
  }) => Promise<{ status: InstallStatus; user: User; token: string }>;
  reset: () => void;
};

export const useInstallStore = create<InstallState>((set) => ({
  installStatus: null,
  status: "idle",
  loadStatus: async () => {
    set({ status: "loading" });

    try {
      const installStatus = await api.getInstallStatus();
      set({ installStatus, status: "ready" });
    } catch (error) {
      set({ status: "ready" });
      pushError(error instanceof Error ? error.message : t("install.statusFailed"));
      throw error;
    }
  },
  configureDatabase: async (payload) => {
    const installStatus = await api.configureInstallDatabase(payload);
    set({ installStatus, status: "ready" });
    pushSuccess(t("install.databaseConfigured"));
    return installStatus;
  },
  completeInstallation: async (payload) => {
    const response = await api.completeInstallation(payload);
    set({ installStatus: response.status, status: "ready" });
    pushSuccess(t("install.completed"));
    return response;
  },
  reset: () =>
    set({
      installStatus: null,
      status: "idle"
    })
}));

export function roleCanEdit(role: Role | undefined) {
  return role === "manager" || role === "admin";
}

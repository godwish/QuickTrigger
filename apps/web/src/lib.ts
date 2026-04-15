import clsx from "clsx";

import { getCurrentLanguage, translate, type SupportedLanguage } from "./i18n";

export type Role = "user" | "manager" | "admin";
const AUTH_TOKEN_KEY = "dashboard_auth_token";

export type User = {
  id: string;
  username: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InstallStatus = {
  databaseConfigured: boolean;
  setupComplete: boolean;
  step: "database" | "admin" | "complete";
  provider?: "sqlite" | "mysql";
  database?: {
    address?: string;
    database?: string;
    username?: string;
    filePath?: string;
  };
};

export type DashboardSetting = {
  id: string;
  title: string;
  columnCount: number;
  language: SupportedLanguage;
  createdAt: string;
  updatedAt: string;
};

export type DashboardItem = {
  id: string;
  categoryId: string;
  displayName: string;
  url: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type DashboardCategory = {
  id: string;
  title: string;
  color: string;
  gridX: number;
  gridY: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  items: DashboardItem[];
};

export type DashboardPayload = {
  settings: DashboardSetting;
  categories: DashboardCategory[];
};

export type DashboardTransferItem = {
  id: string;
  categoryId?: string;
  displayName: string;
  url: string;
  sortOrder?: number;
};

export type DashboardTransferCategory = {
  id: string;
  title: string;
  color: string;
  gridX: number;
  gridY: number;
  sortOrder?: number;
  items: DashboardTransferItem[];
};

export type DashboardTransferPayload = {
  version?: number;
  exportedAt?: string;
  settings: {
    title: string;
    columnCount: number;
    language?: SupportedLanguage;
  };
  categories: DashboardTransferCategory[];
};

export type DashboardItemMove =
  | {
      mode: "insert";
      itemId: string;
      targetItemId: string;
      placement: "before" | "after";
    }
  | {
      mode: "end";
      itemId: string;
      targetCategoryId: string;
    };

export type ToastTone = "success" | "error" | "info";

export type Toast = {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
};

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

const JSON_HEADERS = {
  "Content-Type": "application/json"
};

function getStoredAuthToken() {
  if (typeof window === "undefined") {
    return "";
  }

  return window.localStorage.getItem(AUTH_TOKEN_KEY) ?? "";
}

async function apiRequest<T>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers ?? {});

  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const token = getStoredAuthToken();

  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? ""}${path}`, {
    credentials: "include",
    ...init,
    headers
  });

  if (!response.ok) {
    const fallbackMessage = translate(getCurrentLanguage(), "error.requestFailed");

    try {
      const payload = (await response.json()) as { message?: string };
      throw new ApiError(payload.message || fallbackMessage, response.status);
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }

      throw new ApiError(fallbackMessage, response.status);
    }
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export const api = {
  getInstallStatus: () => apiRequest<InstallStatus>("/api/install/status"),
  configureInstallDatabase: (payload:
    | {
        provider: "sqlite";
      }
    | {
        provider: "mysql";
        address: string;
        database: string;
        username: string;
        password: string;
      }) =>
    apiRequest<InstallStatus>("/api/install/database", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  completeInstallation: (payload: {
    username: string;
    password: string;
    confirmPassword: string;
    dashboardTitle: string;
    language: SupportedLanguage;
  }) =>
    apiRequest<{ status: InstallStatus; user: User; token: string }>("/api/install/bootstrap", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  login: (payload: { username: string; password: string }) =>
    apiRequest<{ user: User; token: string }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  logout: () =>
    apiRequest<void>("/api/auth/logout", {
      method: "POST"
    }),
  me: () => apiRequest<{ user: User; token: string }>("/api/auth/me"),
  changePassword: (payload: {
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }) =>
    apiRequest<{ ok: true }>("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  getDashboard: () => apiRequest<DashboardPayload>("/api/dashboard"),
  exportDashboard: () => apiRequest<DashboardTransferPayload>("/api/admin/dashboard-export"),
  importDashboard: (payload: unknown) =>
    apiRequest<DashboardPayload>("/api/admin/dashboard-import", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateSettings: (payload: { title: string; columnCount: number; language: SupportedLanguage }) =>
    apiRequest<DashboardSetting>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  listUsers: () => apiRequest<User[]>("/api/admin/users"),
  createUser: (payload: { username: string; role: Role }) =>
    apiRequest<{ user: User; temporaryPassword: string }>("/api/admin/users", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateUser: (id: string, payload: { role?: Role; isActive?: boolean }) =>
    apiRequest<{ user: User }>(`/api/admin/users/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  resetUserPassword: (id: string) =>
    apiRequest<{ user: User; temporaryPassword: string }>(`/api/admin/users/${id}/reset-password`, {
      method: "POST"
    }),
  createCategory: (payload: { title: string; color: string }) =>
    apiRequest<DashboardCategory>("/api/categories", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateCategory: (id: string, payload: Partial<Pick<DashboardCategory, "title" | "color">>) =>
    apiRequest<DashboardCategory>(`/api/categories/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteCategory: (id: string) =>
    apiRequest<void>(`/api/categories/${id}`, {
      method: "DELETE"
    }),
  moveCategory: (payload: { categoryId: string; targetX: number; targetY: number }) =>
    apiRequest<{ ok: true }>("/api/categories/move", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  reorderCategories: (orderedIds: string[]) =>
    apiRequest<{ ok: true }>("/api/categories/reorder", {
      method: "POST",
      body: JSON.stringify({ orderedIds })
    }),
  createItem: (payload: { categoryId: string; displayName: string; url: string }) =>
    apiRequest<DashboardItem>("/api/items", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateItem: (id: string, payload: Partial<Pick<DashboardItem, "displayName" | "url">>) =>
    apiRequest<DashboardItem>(`/api/items/${id}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    }),
  deleteItem: (id: string) =>
    apiRequest<void>(`/api/items/${id}`, {
      method: "DELETE"
    }),
  reorderItems: (categoryId: string, orderedIds: string[]) =>
    apiRequest<{ ok: true }>("/api/items/reorder", {
      method: "POST",
      body: JSON.stringify({ categoryId, orderedIds })
    }),
  moveItem: (payload: { itemId: string; targetCategoryId: string; targetIndex: number }) =>
    apiRequest<{ ok: true }>("/api/items/move", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  syncDashboard: (categories: DashboardCategory[]) =>
    apiRequest<DashboardPayload>("/api/dashboard/state", {
      method: "PUT",
      body: JSON.stringify({
        categories: categories.map((category, categoryIndex) => ({
          id: category.id,
          title: category.title,
          color: category.color,
          gridX: category.gridX,
          gridY: category.gridY,
          sortOrder: categoryIndex,
          items: category.items.map((item, itemIndex) => ({
            id: item.id,
            categoryId: category.id,
            displayName: item.displayName,
            url: item.url,
            sortOrder: itemIndex
          }))
        }))
      })
    })
};

export const CATEGORY_PALETTE = [
  "#b98a43",
  "#4c8d83",
  "#587fb5",
  "#b06767",
  "#8668b6",
  "#5c8f88",
  "#6a9566",
  "#667383"
];

export const cn = (...inputs: Array<string | undefined | false | null>) => clsx(inputs);

export function setStoredAuthToken(token: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function clearStoredAuthToken() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export function createClientId() {
  if (typeof globalThis !== "undefined" && globalThis.crypto) {
    if (typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    if (typeof globalThis.crypto.getRandomValues === "function") {
      const bytes = new Uint8Array(16);
      globalThis.crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 0x0f) | 0x40;
      bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, "0"));

      return [
        hex.slice(0, 4).join(""),
        hex.slice(4, 6).join(""),
        hex.slice(6, 8).join(""),
        hex.slice(8, 10).join(""),
        hex.slice(10, 16).join("")
      ].join("-");
    }
  }

  return `id-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function cloneCategories(categories: DashboardCategory[]) {
  return categories.map((category) => ({
    ...category,
    items: category.items.map((item) => ({ ...item }))
  }));
}

export function sortCategoriesByPosition(categories: DashboardCategory[]) {
  return cloneCategories(categories).sort(
    (left, right) =>
      left.gridY - right.gridY || left.gridX - right.gridX || left.sortOrder - right.sortOrder
  );
}

export function normalizeCategories(categories: DashboardCategory[]) {
  return sortCategoriesByPosition(categories).map((category, categoryIndex) => ({
    ...category,
    sortOrder: categoryIndex,
    items: category.items.map((item, itemIndex) => ({
      ...item,
      categoryId: category.id,
      sortOrder: itemIndex
    }))
  }));
}

export function getBoardRowCount(
  categories: DashboardCategory[],
  columnCount: number,
  showPlacementRows: boolean
) {
  const columnHeights = Array.from({ length: columnCount }, (_, column) =>
    categories.filter((category) => category.gridX === column).length
  );
  const occupiedRowCount = Math.max(...columnHeights, categories.length ? 1 : 0);

  if (!showPlacementRows) {
    return Math.max(occupiedRowCount, 1);
  }

  return Math.max(occupiedRowCount + 1, 1);
}

export function moveArray<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [moved] = nextItems.splice(fromIndex, 1);

  nextItems.splice(toIndex, 0, moved);
  return nextItems;
}

export function moveArrayToIndex<T>(items: T[], fromIndex: number, toIndex: number) {
  const nextItems = [...items];
  const [moved] = nextItems.splice(fromIndex, 1);

  if (moved === undefined) {
    return nextItems;
  }

  const safeIndex = Math.max(0, Math.min(toIndex, nextItems.length));
  nextItems.splice(safeIndex, 0, moved);
  return nextItems;
}

function getGridCellIndex(gridX: number, gridY: number, columnCount: number) {
  return gridY * columnCount + gridX;
}

function getGridCoordinates(index: number, columnCount: number) {
  return {
    gridX: index % columnCount,
    gridY: Math.floor(index / columnCount)
  };
}

export function moveCategoryToCell(
  categories: DashboardCategory[],
  activeCategoryId: string,
  targetX: number,
  targetY: number,
  columnCount: number
) {
  const nextCategories = cloneCategories(categories);
  const activeCategory = nextCategories.find((category) => category.id === activeCategoryId);
  const sourceColumnCategories = nextCategories
    .filter((category) => category.gridX === activeCategory?.gridX)
    .sort((left, right) => left.gridY - right.gridY || left.sortOrder - right.sortOrder);
  const sourceIndex = sourceColumnCategories.findIndex((category) => category.id === activeCategoryId);

  if (!activeCategory) {
    return nextCategories;
  }

  if (activeCategory.gridX === targetX && activeCategory.gridY === targetY) {
    return nextCategories;
  }

  const columns = Array.from({ length: columnCount }, (_, columnIndex) =>
    nextCategories
      .filter((category) => category.gridX === columnIndex && category.id !== activeCategoryId)
      .sort((left, right) => left.gridY - right.gridY || left.sortOrder - right.sortOrder)
  );

  if (targetX < 0 || targetX >= columns.length) {
    return nextCategories;
  }

  const targetColumn = columns[targetX] ?? [];
  const adjustedIndex =
    activeCategory.gridX === targetX && sourceIndex >= 0 && sourceIndex < targetY ? targetY - 1 : targetY;
  const safeIndex = Math.max(0, Math.min(adjustedIndex, targetColumn.length));
  targetColumn.splice(safeIndex, 0, activeCategory);

  const rebuiltCategories = columns.flatMap((columnCategories, columnIndex) =>
    columnCategories.map((category, index) => ({
      ...category,
      gridX: columnIndex,
      gridY: index
    }))
  );

  return normalizeCategories(rebuiltCategories);
}

export function insertItemSnapshot(
  categories: DashboardCategory[],
  itemId: string,
  targetItemId: string,
  placement: "before" | "after"
) {
  const nextCategories = cloneCategories(categories);
  const source = findItemLocation(nextCategories, itemId);
  const target = findItemLocation(nextCategories, targetItemId);

  if (!source || !target || itemId === targetItemId) {
    return nextCategories;
  }

  const sourceCategory = nextCategories.find((category) => category.id === source.category.id);
  const targetCategory = nextCategories.find((category) => category.id === target.category.id);

  if (!sourceCategory || !targetCategory) {
    return nextCategories;
  }

  const [movingItem] = sourceCategory.items.splice(source.itemIndex, 1);

  if (!movingItem) {
    return nextCategories;
  }

  const rawInsertIndex = target.itemIndex + (placement === "after" ? 1 : 0);
  const insertIndex =
    sourceCategory.id === targetCategory.id && source.itemIndex < rawInsertIndex
      ? rawInsertIndex - 1
      : rawInsertIndex;

  targetCategory.items.splice(insertIndex, 0, {
    ...movingItem,
    categoryId: targetCategory.id
  });

  return normalizeCategories(nextCategories);
}

export function moveItemToEndSnapshot(
  categories: DashboardCategory[],
  itemId: string,
  targetCategoryId: string
) {
  const nextCategories = cloneCategories(categories);
  const source = findItemLocation(nextCategories, itemId);

  if (!source) {
    return nextCategories;
  }

  const sourceCategory = nextCategories.find((category) => category.id === source.category.id);
  const targetCategory = nextCategories.find((category) => category.id === targetCategoryId);

  if (!sourceCategory || !targetCategory) {
    return nextCategories;
  }

  if (
    sourceCategory.id === targetCategory.id &&
    source.itemIndex === sourceCategory.items.length - 1
  ) {
    return nextCategories;
  }

  const [movingItem] = sourceCategory.items.splice(source.itemIndex, 1);

  if (!movingItem) {
    return nextCategories;
  }

  targetCategory.items.push({
    ...movingItem,
    categoryId: targetCategory.id
  });

  return normalizeCategories(nextCategories);
}

export function moveItemSnapshot(
  categories: DashboardCategory[],
  move: DashboardItemMove
) {
  if (move.mode === "insert") {
    return insertItemSnapshot(categories, move.itemId, move.targetItemId, move.placement);
  }

  return moveItemToEndSnapshot(categories, move.itemId, move.targetCategoryId);
}

export function findItemLocation(categories: DashboardCategory[], itemId: string) {
  for (const category of categories) {
    const itemIndex = category.items.findIndex((item) => item.id === itemId);

    if (itemIndex >= 0) {
      return {
        category,
        itemIndex
      };
    }
  }

  return null;
}

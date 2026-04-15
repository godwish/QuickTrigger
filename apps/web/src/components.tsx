import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragCancelEvent,
  type CollisionDetection,
  type DragEndEvent
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
} from "@dnd-kit/sortable";
import { LayoutGrid, LogOut, Pencil, Plus, Shield, Trash2, UserRound } from "lucide-react";
import type {
  ButtonHTMLAttributes,
  ChangeEvent,
  CSSProperties,
  DragEvent as ReactDragEvent,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes
} from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";

import { getLanguageOptionLabel, getRoleLabel, translate, useI18n, type SupportedLanguage } from "./i18n";
import {
  CATEGORY_PALETTE,
  cn,
  type DashboardItemMove,
  type DashboardCategory,
  type DashboardItem,
  type DashboardSetting,
  type DashboardTransferPayload,
  type Role,
  type Toast
} from "./lib";
import { useToastStore } from "./store";

function categoryDragId(id: string) {
  return `category:${id}`;
}

function itemDragId(id: string) {
  return `item:${id}`;
}

function itemEndSlotId(categoryId: string) {
  return `item-end-slot:${categoryId}`;
}

const HTML_DROP_TYPES = ["text/html", "public.html"];
const URI_DROP_TYPES = ["text/uri-list", "public.url", "UniformResourceLocator", "UniformResourceLocatorW"];
const PLAIN_TEXT_DROP_TYPES = ["text/plain", "text", "Text", "public.utf8-plain-text", "public.text"];
const LINK_NAME_DROP_TYPES = ["public.url-name", "text/x-moz-url-desc"];
const MOZ_URL_DROP_TYPES = ["text/x-moz-url"];
const DOWNLOAD_URL_DROP_TYPES = ["DownloadURL"];
const EXTERNAL_LINK_TYPES = [
  ...HTML_DROP_TYPES,
  ...URI_DROP_TYPES,
  ...PLAIN_TEXT_DROP_TYPES,
  ...LINK_NAME_DROP_TYPES,
  ...MOZ_URL_DROP_TYPES,
  ...DOWNLOAD_URL_DROP_TYPES
];

function hasExternalLinkPayload(dataTransfer: DataTransfer | null) {
  if (!dataTransfer) {
    return false;
  }

  const types = Array.from(dataTransfer.types ?? []);
  return EXTERNAL_LINK_TYPES.some((type) => types.includes(type));
}

function sanitizeLinkText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function softenCategoryColor(color: string) {
  const hex = color.trim().replace("#", "");
  const normalized = hex.length === 3 ? hex.split("").map((char) => char + char).join("") : hex;

  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) {
    return color;
  }

  const red = Number.parseInt(normalized.slice(0, 2), 16);
  const green = Number.parseInt(normalized.slice(2, 4), 16);
  const blue = Number.parseInt(normalized.slice(4, 6), 16);
  const mix = (value: number, target: number, amount: number) =>
    Math.round(value * (1 - amount) + target * amount);
  const toned = {
    red: mix(mix(red, 255, 0.22), 71, 0.08),
    green: mix(mix(green, 255, 0.22), 85, 0.08),
    blue: mix(mix(blue, 255, 0.22), 105, 0.08)
  };

  return `rgb(${toned.red}, ${toned.green}, ${toned.blue})`;
}

function readFirstData(dataTransfer: Pick<DataTransfer, "getData">, types: string[]) {
  for (const type of types) {
    const value = dataTransfer.getData(type);

    if (value) {
      return value;
    }
  }

  return "";
}

function tryParseHttpUrl(value: string) {
  const candidate = value.trim().replace(/^<|>$/g, "");

  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url : null;
  } catch {
    if (!/^[\w.-]+\.[A-Za-z]{2,}(?:[/:?#][^\s]*)?$/.test(candidate)) {
      return null;
    }

    try {
      const url = new URL(`https://${candidate}`);
      return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
      return null;
    }
  }
}

function extractUrlFromText(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    const parsed = tryParseHttpUrl(line);

    if (parsed) {
      return parsed.href;
    }

    const match = line.match(/https?:\/\/[^\s"'<>]+|(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'<>]*/i);
    if (match) {
      const matched = tryParseHttpUrl(match[0]);

      if (matched) {
        return matched.href;
      }
    }
  }

  return null;
}

function extractUrlFromUriList(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (line.startsWith("#")) {
      continue;
    }

    const parsed = tryParseHttpUrl(line);
    if (parsed) {
      return parsed.href;
    }
  }

  return null;
}

function extractLinkDataFromMozUrl(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => sanitizeLinkText(line))
    .filter(Boolean);

  if (!lines.length) {
    return { url: "", text: "" };
  }

  return {
    url: tryParseHttpUrl(lines[0])?.href ?? "",
    text: lines.slice(1).join(" ").trim()
  };
}

function extractLinkDataFromDownloadUrl(value: string) {
  const parts = value
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length < 2) {
    return { url: "", text: "" };
  }

  const url = tryParseHttpUrl(parts[parts.length - 1])?.href ?? "";
  const text = sanitizeLinkText(parts.slice(1, -1).join(":"));

  return {
    url,
    text
  };
}

function stripHtmlTags(value: string) {
  return sanitizeLinkText(value.replace(/<[^>]+>/g, " "));
}

function extractLinkDataFromHtml(html: string) {
  if (!html) {
    return { url: "", text: "", title: "" };
  }

  if (typeof DOMParser !== "undefined") {
    try {
      const document = new DOMParser().parseFromString(html, "text/html");
      const anchor = document.querySelector("a[href]");

      return {
        url: anchor?.getAttribute("href") ?? "",
        text: sanitizeLinkText(anchor?.textContent ?? ""),
        title: sanitizeLinkText(anchor?.getAttribute("title") ?? "")
      };
    } catch {
      return { url: "", text: "", title: "" };
    }
  }

  const anchorMatch = html.match(/<a\b[^>]*href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
  if (!anchorMatch) {
    return { url: "", text: "", title: "" };
  }

  const [, , href, contents] = anchorMatch;
  const titleMatch = anchorMatch[0].match(/\btitle=(["'])(.*?)\1/i);

  return {
    url: href ?? "",
    text: stripHtmlTags(contents ?? ""),
    title: sanitizeLinkText(titleMatch?.[2] ?? "")
  };
}

function getFallbackDisplayName(url: string) {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "") || url;
  } catch {
    return url;
  }
}

function extractPlainTextDisplayName(value: string) {
  const lines = value
    .split(/\r?\n/)
    .map((line) => sanitizeLinkText(line))
    .filter(Boolean);

  for (const line of lines) {
    const withoutUrl = sanitizeLinkText(
      line.replace(/https?:\/\/[^\s"'<>]+|(?:www\.)?[A-Za-z0-9.-]+\.[A-Za-z]{2,}[^\s"'<>]*/gi, " ")
    );

    if (withoutUrl) {
      return withoutUrl;
    }

    if (!extractUrlFromText(line)) {
      return line;
    }
  }

  return "";
}

export function parseExternalDropData(dataTransfer: Pick<DataTransfer, "getData">) {
  const uriList = readFirstData(dataTransfer, URI_DROP_TYPES);
  const plainText = readFirstData(dataTransfer, PLAIN_TEXT_DROP_TYPES);
  const html = readFirstData(dataTransfer, HTML_DROP_TYPES);
  const mozUrl = readFirstData(dataTransfer, MOZ_URL_DROP_TYPES);
  const linkName = sanitizeLinkText(readFirstData(dataTransfer, LINK_NAME_DROP_TYPES));
  const downloadUrl = readFirstData(dataTransfer, DOWNLOAD_URL_DROP_TYPES);
  const htmlData = extractLinkDataFromHtml(html);
  const mozData = extractLinkDataFromMozUrl(mozUrl);
  const downloadData = extractLinkDataFromDownloadUrl(downloadUrl);
  const url =
    tryParseHttpUrl(htmlData.url)?.href ??
    tryParseHttpUrl(mozData.url)?.href ??
    tryParseHttpUrl(downloadData.url)?.href ??
    extractUrlFromUriList(uriList) ??
    extractUrlFromText(plainText) ??
    "";

  if (!url) {
    return null;
  }

  const displayName =
    htmlData.text ||
    htmlData.title ||
    mozData.text ||
    downloadData.text ||
    linkName ||
    extractPlainTextDisplayName(plainText) ||
    getFallbackDisplayName(url);

  return {
    url,
    displayName
  };
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
};

export function Button({ className, variant = "primary", ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-semibold transition",
        variant === "primary" &&
          "bg-slate-900 text-white shadow-sm hover:bg-slate-800 disabled:bg-slate-400",
        variant === "secondary" &&
          "border border-slate-300 bg-white/80 text-slate-900 hover:border-slate-400 hover:bg-white",
        variant === "ghost" && "text-slate-700 hover:bg-slate-900/5",
        variant === "danger" &&
          "bg-rose-600 text-white shadow-sm hover:bg-rose-500 disabled:bg-rose-300",
        "disabled:cursor-not-allowed",
        className
      )}
      {...props}
    />
  );
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-xl border border-slate-300 bg-white/90 px-3 py-2.5 text-sm outline-none transition placeholder:text-slate-400 focus:border-amber-500 focus:ring-4 focus:ring-amber-200/70",
        props.className
      )}
    />
  );
}

export function SelectInput(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-xl border border-slate-300 bg-white/90 px-3 py-2.5 text-sm outline-none transition focus:border-amber-500 focus:ring-4 focus:ring-amber-200/70",
        props.className
      )}
    />
  );
}

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  tone?: "light" | "neutral" | "danger";
  stopPropagation?: boolean;
};

function IconButton({
  label,
  tone = "neutral",
  stopPropagation = false,
  className,
  onPointerDown,
  children,
  ...props
}: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={cn(
        "inline-flex h-6 w-6 items-center justify-center rounded-full transition",
        tone === "light" && "bg-white/18 text-white hover:bg-white/28",
        tone === "neutral" && "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
        tone === "danger" && "border border-rose-200 bg-white text-rose-600 hover:bg-rose-50",
        className
      )}
      onPointerDown={(event) => {
        if (stopPropagation) {
          event.stopPropagation();
        }

        onPointerDown?.(event);
      }}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}

export function RoleBadge({ role }: { role: Role }) {
  const { language } = useI18n();

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]",
        role === "admin" && "bg-rose-100 text-rose-700",
        role === "manager" && "bg-teal-100 text-teal-700",
        role === "user" && "bg-slate-200 text-slate-700"
      )}
    >
      {getRoleLabel(language, role)}
    </span>
  );
}

export function LoadingScreen() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="paper-panel max-w-md rounded-[2rem] px-10 py-12 text-center">
        <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-amber-100 p-3 text-amber-700">
          <div className="h-full w-full animate-spin rounded-full border-4 border-amber-600 border-t-transparent" />
        </div>
        <p className="text-lg font-semibold">{t("loading.title")}</p>
        <p className="mt-2 text-sm text-slate-500">{t("loading.description")}</p>
      </div>
    </div>
  );
}

export function Modal({
  open,
  title,
  description,
  children,
  footer,
  onClose
}: {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div className="dialog-backdrop fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="paper-panel w-full max-w-lg rounded-[2rem] p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
            {description ? <p className="mt-1 text-sm text-slate-500">{description}</p> : null}
          </div>
          <Button variant="ghost" aria-label={t("action.close")} onClick={onClose}>
            {t("action.close")}
          </Button>
        </div>
        <div>{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ToastViewport() {
  const { toasts, dismiss } = useToastStore();

  useEffect(() => {
    const timers = toasts.map((toast) =>
      window.setTimeout(() => {
        dismiss(toast.id);
      }, 3200)
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [dismiss, toasts]);

  return (
    <div className="fixed bottom-4 right-4 z-[60] flex w-[min(92vw,24rem)] flex-col gap-3">
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onClose={() => dismiss(toast.id)} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  const { t } = useI18n();

  return (
    <div
      className={cn(
        "paper-panel rounded-3xl px-4 py-4",
        toast.tone === "error" && "border-rose-200 bg-white/95",
        toast.tone === "success" && "border-emerald-200 bg-white/95"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
          {toast.description ? <p className="mt-1 text-sm text-slate-500">{toast.description}</p> : null}
        </div>
        <button className="text-sm text-slate-500" onClick={onClose} type="button">
          {t("toast.close")}
        </button>
      </div>
    </div>
  );
}

type DashboardBoardProps = {
  settings: DashboardSetting | null;
  categories: DashboardCategory[];
  editMode: boolean;
  canEdit: boolean;
  onCreateCategoryAt: (targetX: number, targetY: number) => void;
  onEditCategory: (category: DashboardCategory) => void;
  onDeleteCategory: (category: DashboardCategory) => void;
  onCreateItem: (category: DashboardCategory) => void;
  onEditItem: (category: DashboardCategory, item: DashboardItem) => void;
  onDeleteItem: (category: DashboardCategory, item: DashboardItem) => void;
  onMoveCategory: (categoryId: string, targetX: number, targetY: number) => Promise<void> | void;
  onMoveItem: (move: DashboardItemMove) => Promise<void> | void;
  onCreateItemFromDrop: (payload: { categoryId: string; displayName: string; url: string }) => Promise<void> | void;
};

export function DashboardBoard({
  settings,
  categories,
  editMode,
  canEdit,
  onCreateCategoryAt,
  onEditCategory,
  onDeleteCategory,
  onCreateItem,
  onEditItem,
  onDeleteItem,
  onMoveCategory,
  onMoveItem,
  onCreateItemFromDrop
}: DashboardBoardProps) {
  const { t } = useI18n();
  const pushToast = useToastStore((state) => state.push);
  const [activeDragType, setActiveDragType] = useState<"category" | "item" | null>(null);
  const [activeCategoryPreview, setActiveCategoryPreview] = useState<DashboardCategory | null>(null);
  const [activeItemPreview, setActiveItemPreview] = useState<DashboardItem | null>(null);
  const [activeDragRect, setActiveDragRect] = useState<{ width: number; height: number } | null>(null);
  const [externalDropCategoryId, setExternalDropCategoryId] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 }
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 150, tolerance: 8 }
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates
    })
  );
  const columnCount = settings?.columnCount ?? 6;

  const categoryColumns = useMemo(
    () =>
      Array.from({ length: columnCount }, (_column, x) => ({
        x,
        categories: categories
          .filter((category) => category.gridX === x)
          .sort((left, right) => left.gridY - right.gridY || left.sortOrder - right.sortOrder)
      })),
    [categories, columnCount]
  );
  const isCategoryDragging = activeDragType === "category";
  const isItemDragging = activeDragType === "item";

  const collisionDetection: CollisionDetection = (args) => {
    const activeType = String(args.active.data.current?.type ?? "");
    const filteredContainers = args.droppableContainers.filter((container) => {
      const containerId = String(container.id);
      const containerType = String(container.data.current?.type ?? "");

      if (containerId === String(args.active.id)) {
        return false;
      }

      if (activeType === "category") {
        if (containerType !== "category" && containerType !== "category-end-slot") {
          return false;
        }
        return String(container.data.current?.categoryId ?? "") !== String(args.active.data.current?.categoryId ?? "");
      }

      if (activeType === "item") {
        return containerType === "item" || containerType === "item-end-slot";
      }

      return true;
    });

    const scopedArgs = {
      ...args,
      droppableContainers: filteredContainers.length ? filteredContainers : args.droppableContainers
    };

    if (activeType === "category") {
      const pointerHits = pointerWithin(scopedArgs);

      if (pointerHits.length) {
        return pointerHits;
      }

      return closestCorners(scopedArgs);
    }

    const pointerHits = pointerWithin(scopedArgs);

    if (pointerHits.length) {
      return pointerHits;
    }

    return closestCorners(scopedArgs);
  };

  const resetDragState = () => {
    setActiveDragType(null);
    setActiveCategoryPreview(null);
    setActiveItemPreview(null);
    setActiveDragRect(null);
    setExternalDropCategoryId(null);
  };

  const handleExternalDropCreateItem = async (category: DashboardCategory, dataTransfer: DataTransfer) => {
    const payload = parseExternalDropData(dataTransfer);

    if (!payload) {
      pushToast({
        tone: "error",
        title: t("dashboard.externalDropErrorTitle"),
        description: t("dashboard.externalDropErrorDescription")
      });
      return;
    }

    await onCreateItemFromDrop({
      categoryId: category.id,
      displayName: payload.displayName,
      url: payload.url
    });
  };

  const handleDragStart = (event: DragStartEvent) => {
    const activeType = String(event.active.data.current?.type ?? "");
    const initialRect = event.active.rect.current.initial;

    setActiveDragRect(
      initialRect ? { width: Math.max(initialRect.width, 0), height: Math.max(initialRect.height, 0) } : null
    );

    if (activeType === "category") {
      const categoryId = String(
        event.active.data.current?.categoryId ?? String(event.active.id).replace("category:", "")
      );
      const activeCategory = categories.find((category) => category.id === categoryId) ?? null;

      setActiveDragType(activeType);
      setActiveCategoryPreview(activeCategory ? cloneCategoryPreview(activeCategory) : null);
      setActiveItemPreview(null);
      return;
    }

    if (activeType === "item") {
      const itemId = String(event.active.data.current?.itemId ?? String(event.active.id).replace("item:", ""));
      const activeItem = categories.flatMap((category) => category.items).find((item) => item.id === itemId) ?? null;

      setActiveDragType(activeType);
      setActiveCategoryPreview(null);
      setActiveItemPreview(activeItem ? { ...activeItem } : null);
      return;
    }

    setActiveDragType(null);
    setActiveCategoryPreview(null);
    setActiveItemPreview(null);
    setActiveDragRect(null);
  };

  const handleDragCancel = (_event: DragCancelEvent) => {
    resetDragState();
  };

  const handleCategoryDragEnd = async (event: DragEndEvent) => {
    if (!canEdit || !editMode || !event.over) {
      return;
    }

    const activeType = String(event.active.data.current?.type ?? "");
    const overType = String(event.over.data.current?.type ?? "");

    if (activeType !== "category") {
      return;
    }

    const activeCategoryId = String(event.active.data.current?.categoryId ?? "");
    if (!activeCategoryId) {
      return;
    }

    if (overType === "category") {
      const overCategoryId = String(event.over.data.current?.categoryId ?? "");
      const targetX = Number(event.over.data.current?.gridX ?? -1);
      const baseIndex = Number(event.over.data.current?.index ?? -1);
      const translatedRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = event.over.rect;
      const placement =
        translatedRect && overRect
          ? translatedRect.top + translatedRect.height / 2 < overRect.top + overRect.height / 2
            ? "before"
            : "after"
          : "before";
      const targetIndex = baseIndex + (placement === "after" ? 1 : 0);

      if (
        !overCategoryId ||
        overCategoryId === activeCategoryId ||
        !Number.isFinite(targetX) ||
        !Number.isFinite(baseIndex) ||
        targetX < 0 ||
        baseIndex < 0
      ) {
        return;
      }

      await onMoveCategory(activeCategoryId, targetX, targetIndex);
      return;
    }

    if (overType === "category-end-slot") {
      const targetX = Number(event.over.data.current?.gridX ?? -1);
      const targetIndex = Number(event.over.data.current?.index ?? -1);

      if (!Number.isFinite(targetX) || !Number.isFinite(targetIndex) || targetX < 0 || targetIndex < 0) {
        return;
      }

      await onMoveCategory(activeCategoryId, targetX, targetIndex);
    }
  };

  const handleItemDragEnd = async (event: DragEndEvent) => {
    if (!canEdit || !editMode || !event.over) {
      return;
    }

    const activeId = String(event.active.id);
    const overId = String(event.over.id);
    const overType = String(event.over.data.current?.type ?? "");
    const activeType = String(event.active.data.current?.type ?? "");

    if (activeType !== "item") {
      return;
    }

    const itemId = activeId.replace("item:", "");

    if (overType === "item") {
      const overItemId = String(event.over.data.current?.itemId ?? overId.replace("item:", ""));
      const translatedRect = event.active.rect.current.translated ?? event.active.rect.current.initial;
      const overRect = event.over.rect;
      const placement =
        translatedRect && overRect
          ? translatedRect.top + translatedRect.height / 2 < overRect.top + overRect.height / 2
            ? "before"
            : "after"
          : "before";

      if (overItemId && overItemId !== itemId) {
        await onMoveItem({
          mode: "insert",
          itemId,
          targetItemId: overItemId,
          placement
        });
      }

      return;
    }

    if (overType === "item-end-slot") {
      const targetCategoryId = String(event.over.data.current?.categoryId ?? "");

      if (targetCategoryId) {
        await onMoveItem({
          mode: "end",
          itemId,
          targetCategoryId
        });
      }
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    try {
      const activeType = String(event.active.data.current?.type ?? "");

      if (activeType === "category") {
        await handleCategoryDragEnd(event);
      }

      if (activeType === "item") {
        await handleItemDragEnd(event);
      }
    } finally {
      resetDragState();
    }
  };

  return (
    <div className="space-y-4">
      <div className="soft-scrollbar overflow-auto pb-2">
        <DndContext
          collisionDetection={collisionDetection}
          onDragCancel={handleDragCancel}
          onDragEnd={handleDragEnd}
          onDragStart={handleDragStart}
          sensors={sensors}
        >
          <div
            className="board-grid mx-auto flex w-max items-start gap-3"
            style={{ ["--dashboard-columns" as const]: columnCount } as CSSProperties}
          >
            {categoryColumns.map((column) => (
              <CategoryColumn
                canEdit={canEdit}
                categories={column.categories}
                columnX={column.x}
                editMode={editMode}
                externalDropCategoryId={externalDropCategoryId}
                isCategoryDragging={isCategoryDragging}
                isItemDragging={isItemDragging}
                key={`column-${column.x}`}
                onCreateCategoryAt={onCreateCategoryAt}
                onCreateItem={onCreateItem}
                onDeleteCategory={onDeleteCategory}
                onDeleteItem={onDeleteItem}
                onEditCategory={onEditCategory}
                onEditItem={onEditItem}
                onExternalLinkDrop={handleExternalDropCreateItem}
                onExternalLinkHoverChange={setExternalDropCategoryId}
              />
            ))}
          </div>
          {typeof document !== "undefined"
            ? createPortal(
                <DragOverlay dropAnimation={null} zIndex={9999}>
                  {activeDragType === "category" && activeCategoryPreview ? (
                    <CategoryDragPreview category={activeCategoryPreview} rect={activeDragRect} />
                  ) : null}
                  {activeDragType === "item" && activeItemPreview ? (
                    <ItemDragPreview item={activeItemPreview} rect={activeDragRect} />
                  ) : null}
                </DragOverlay>,
                document.body
              )
            : null}
        </DndContext>
      </div>
    </div>
  );
}

function CategoryColumn({
  columnX,
  categories,
  editMode,
  canEdit,
  isCategoryDragging,
  isItemDragging,
  externalDropCategoryId,
  onCreateCategoryAt,
  onEditCategory,
  onDeleteCategory,
  onCreateItem,
  onEditItem,
  onDeleteItem,
  onExternalLinkHoverChange,
  onExternalLinkDrop
}: {
  columnX: number;
  categories: DashboardCategory[];
  editMode: boolean;
  canEdit: boolean;
  isCategoryDragging: boolean;
  isItemDragging: boolean;
  externalDropCategoryId: string | null;
  onCreateCategoryAt: (targetX: number, targetY: number) => void;
  onEditCategory: (category: DashboardCategory) => void;
  onDeleteCategory: (category: DashboardCategory) => void;
  onCreateItem: (category: DashboardCategory) => void;
  onEditItem: (category: DashboardCategory, item: DashboardItem) => void;
  onDeleteItem: (category: DashboardCategory, item: DashboardItem) => void;
  onExternalLinkHoverChange: (categoryId: string | null) => void;
  onExternalLinkDrop: (category: DashboardCategory, dataTransfer: DataTransfer) => Promise<void> | void;
}) {
  return (
    <div className="flex w-[210px] shrink-0 flex-col gap-4">
      {categories.map((category, index) => (
        <CategoryCard
          canEdit={canEdit}
          category={category}
          categoryIndex={index}
          editMode={editMode}
          isCategoryDragging={isCategoryDragging}
          isItemDragging={isItemDragging}
          isExternalLinkOver={externalDropCategoryId === category.id}
          key={category.id}
          onCreateItem={onCreateItem}
          onDeleteCategory={onDeleteCategory}
          onDeleteItem={onDeleteItem}
          onEditCategory={onEditCategory}
          onEditItem={onEditItem}
          onExternalLinkDrop={onExternalLinkDrop}
          onExternalLinkHoverChange={onExternalLinkHoverChange}
        />
      ))}
      {editMode && canEdit ? (
        <CategoryColumnEndSlot
          active={isCategoryDragging}
          columnX={columnX}
          index={categories.length}
          onCreateCategoryAt={onCreateCategoryAt}
        />
      ) : null}
    </div>
  );
}

function CategoryColumnEndSlot({
  columnX,
  index,
  active,
  onCreateCategoryAt
}: {
  columnX: number;
  index: number;
  active: boolean;
  onCreateCategoryAt: (targetX: number, targetY: number) => void;
}) {
  const { t } = useI18n();
  const { isOver, setNodeRef } = useDroppable({
    id: `category-end-slot:${columnX}`,
    data: {
      type: "category-end-slot",
      gridX: columnX,
      index
    },
    disabled: !active
  });

  return (
    <div
      ref={setNodeRef}
      onClick={() => {
        if (!active) {
          onCreateCategoryAt(columnX, index);
        }
      }}
      className={cn(
        "flex min-h-[4.75rem] items-center justify-center rounded-[0.18rem] border border-dashed border-slate-300/90 bg-white text-[10px] text-slate-400 transition",
        !active && "cursor-pointer hover:border-slate-400 hover:bg-slate-50 hover:text-slate-600",
        isOver && "border-amber-300 bg-amber-100/70 ring-2 ring-amber-200 text-amber-700"
      )}
    >
      {active ? t("dashboard.emptySlot") : t("dashboard.createCategory")}
    </div>
  );
}

function CategoryCard({
  category,
  categoryIndex,
  editMode,
  canEdit,
  isCategoryDragging,
  isItemDragging,
  isExternalLinkOver,
  onEditCategory,
  onDeleteCategory,
  onCreateItem,
  onEditItem,
  onDeleteItem,
  onExternalLinkHoverChange,
  onExternalLinkDrop
}: {
  category: DashboardCategory;
  categoryIndex: number;
  editMode: boolean;
  canEdit: boolean;
  isCategoryDragging: boolean;
  isItemDragging: boolean;
  isExternalLinkOver: boolean;
  onEditCategory: (category: DashboardCategory) => void;
  onDeleteCategory: (category: DashboardCategory) => void;
  onCreateItem: (category: DashboardCategory) => void;
  onEditItem: (category: DashboardCategory, item: DashboardItem) => void;
  onDeleteItem: (category: DashboardCategory, item: DashboardItem) => void;
  onExternalLinkHoverChange: (categoryId: string | null) => void;
  onExternalLinkDrop: (category: DashboardCategory, dataTransfer: DataTransfer) => Promise<void> | void;
}) {
  const { t } = useI18n();
  const {
    attributes,
    listeners,
    setNodeRef: setDraggableNodeRef,
    isDragging
  } = useDraggable({
    id: categoryDragId(category.id),
    data: {
      type: "category",
      categoryId: category.id,
      gridX: category.gridX,
      index: categoryIndex
    },
    disabled: !editMode || !canEdit
  });
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: categoryDragId(category.id),
    data: {
      type: "category",
      categoryId: category.id,
      gridX: category.gridX,
      index: categoryIndex
    },
    disabled: !editMode || !canEdit
  });
  const dragHandleProps = editMode && canEdit ? { ...attributes, ...listeners } : {};
  const setNodeRef = (node: HTMLElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  };
  const acceptsExternalDrop = canEdit && editMode;
  const headerColor = softenCategoryColor(category.color);

  const handleExternalDragOver = (event: ReactDragEvent<HTMLElement>) => {
    if (!acceptsExternalDrop || !hasExternalLinkPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
    onExternalLinkHoverChange(category.id);
  };

  const handleExternalDragLeave = (event: ReactDragEvent<HTMLElement>) => {
    if (!acceptsExternalDrop) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
      return;
    }

    onExternalLinkHoverChange(null);
  };

  const handleExternalDrop = async (event: ReactDragEvent<HTMLElement>) => {
    if (!acceptsExternalDrop || !hasExternalLinkPayload(event.dataTransfer)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    onExternalLinkHoverChange(null);
    await onExternalLinkDrop(category, event.dataTransfer);
  };

  return (
    <section
      ref={setNodeRef}
      onDragLeave={handleExternalDragLeave}
      onDragOver={handleExternalDragOver}
      onDrop={(event) => {
        void handleExternalDrop(event);
      }}
      className={cn(
        "grid-card flex w-full min-h-[4.75rem] flex-col rounded-[0.18rem] border border-slate-300 bg-white transition",
        editMode && canEdit && isOver && !isDragging && isCategoryDragging && "border-amber-300 bg-amber-50",
        isExternalLinkOver && "border-emerald-300 bg-emerald-50/90 ring-2 ring-emerald-200",
        isDragging && "opacity-35"
      )}
    >
      <div className="px-2 pt-2">
        <header
          {...dragHandleProps}
          className={cn(
            "rounded-[0.18rem] border-b border-white/35 px-2 py-1 text-white",
            editMode && canEdit && "cursor-grab select-none active:cursor-grabbing"
          )}
          style={{ backgroundColor: headerColor }}
        >
          <div className="relative flex items-center justify-center">
            {editMode && canEdit ? (
              <div className="absolute left-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <IconButton label={t("dashboard.categoryEditTitle")} onClick={() => onEditCategory(category)} stopPropagation tone="light">
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ) : null}
            <h3 className="px-9 text-center text-[13px] font-semibold leading-[1.15rem]">{category.title}</h3>
            {editMode && canEdit ? (
              <div className="absolute right-0 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
                <IconButton label={t("dashboard.categoryDeleteTitle")} onClick={() => onDeleteCategory(category)} stopPropagation tone="light">
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            ) : null}
          </div>
        </header>
      </div>

      <div className="px-2 pt-[4px] pb-[8px]">
        <div className="space-y-[2px] pr-0.5">
          {category.items.length ? (
            category.items.map((item) => (
              <ItemCard
                key={item.id}
                canEdit={canEdit}
                category={category}
                editMode={editMode}
                item={item}
                onDeleteItem={onDeleteItem}
                onEditItem={onEditItem}
              />
            ))
          ) : (
            <div className="rounded-[0.18rem] border border-dashed border-slate-300 px-3 py-1.5 text-center text-[10px] text-slate-400">
              {t("dashboard.emptyItems")}
            </div>
          )}
          {editMode && canEdit ? (
            <ItemEndSlot active={isItemDragging} category={category} onCreateItem={onCreateItem} />
          ) : null}
        </div>
      </div>
    </section>
  );
}

function ItemEndSlot({
  category,
  active,
  onCreateItem
}: {
  category: DashboardCategory;
  active: boolean;
  onCreateItem: (category: DashboardCategory) => void;
}) {
  const { t } = useI18n();
  const { isOver, setNodeRef } = useDroppable({
    id: itemEndSlotId(category.id),
    data: {
      type: "item-end-slot",
      categoryId: category.id
    },
    disabled: !active
  });

  return (
    <div
      ref={setNodeRef}
      onClick={() => {
        if (!active) {
          onCreateItem(category);
        }
      }}
      className={cn(
        "rounded-[0.18rem] border border-dashed px-2 py-1 text-center text-[10px] transition",
        category.items.length
          ? "border-slate-300/90 bg-white/40 text-slate-400"
          : "border-slate-300 bg-slate-50/70 text-slate-400",
        !active && "cursor-pointer hover:border-slate-400 hover:bg-slate-50 hover:text-slate-600",
        isOver && "border-amber-300 bg-amber-50 text-amber-700"
      )}
    >
      {active ? t("dashboard.emptySlot") : t("dashboard.addLink")}
    </div>
  );
}

function cloneCategoryPreview(category: DashboardCategory) {
  return {
    ...category,
    items: category.items.map((item) => ({ ...item }))
  };
}

function CategoryDragPreview({
  category,
  rect
}: {
  category: DashboardCategory;
  rect: { width: number; height: number } | null;
}) {
  const { t } = useI18n();

  return (
    <section
      className="grid-card flex flex-col rounded-[0.18rem] border border-slate-300 bg-white shadow-xl"
      style={{
        width: rect?.width ? `${rect.width}px` : undefined,
        minHeight: rect?.height ? `${rect.height}px` : undefined
      }}
    >
      <div className="px-2 pt-2">
        <header
          className="rounded-[0.18rem] border-b border-white/35 px-2 py-1 text-white"
          style={{ backgroundColor: softenCategoryColor(category.color) }}
        >
          <div className="text-center text-[13px] font-semibold leading-[1.15rem]">{category.title}</div>
        </header>
      </div>
      <div className="px-2 pt-[4px] pb-[8px]">
        <div className="space-y-[2px] pr-0.5">
          {category.items.length ? (
            category.items.slice(0, 5).map((item) => (
              <div
                key={item.id}
                className="rounded-[0.18rem] border border-slate-200 bg-white px-2 py-0.5 text-center text-[12px] font-medium leading-4 text-slate-800"
              >
                {item.displayName}
              </div>
            ))
          ) : (
            <div className="rounded-[0.18rem] border border-dashed border-slate-300 px-3 py-1.5 text-center text-[10px] text-slate-400">
              {t("dashboard.emptyItems")}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function ItemDragPreview({
  item,
  rect
}: {
  item: DashboardItem;
  rect: { width: number; height: number } | null;
}) {
  return (
    <div
      className="rounded-[0.18rem] border border-slate-300 bg-white px-2 py-1 shadow-xl"
      style={{
        width: rect?.width ? `${rect.width}px` : undefined,
        minHeight: rect?.height ? `${rect.height}px` : undefined
      }}
    >
        <div className="rounded-[0.16rem] px-2 py-0.5 text-center text-[12px] font-medium leading-4 text-slate-800">
        {item.displayName}
      </div>
    </div>
  );
}

function ItemCard({
  item,
  category,
  editMode,
  canEdit,
  onEditItem,
  onDeleteItem
}: {
  item: DashboardItem;
  category: DashboardCategory;
  editMode: boolean;
  canEdit: boolean;
  onEditItem: (category: DashboardCategory, item: DashboardItem) => void;
  onDeleteItem: (category: DashboardCategory, item: DashboardItem) => void;
}) {
  const { attributes, listeners, setNodeRef: setDraggableNodeRef, isDragging } = useDraggable({
    id: itemDragId(item.id),
    data: {
      type: "item",
      itemId: item.id,
      categoryId: category.id
    },
    disabled: !editMode || !canEdit
  });
  const { isOver, setNodeRef: setDroppableNodeRef } = useDroppable({
    id: itemDragId(item.id),
    data: {
      type: "item",
      itemId: item.id,
      categoryId: category.id
    },
    disabled: !editMode || !canEdit
  });
  const dragHandleProps = editMode && canEdit ? { ...attributes, ...listeners } : {};
  const setNodeRef = (node: HTMLDivElement | null) => {
    setDraggableNodeRef(node);
    setDroppableNodeRef(node);
  };
  const hasUrl = Boolean(item.url.trim());
  const { t } = useI18n();

  return (
    <div
      ref={setNodeRef}
      {...dragHandleProps}
      className={cn(
        "relative rounded-[0.18rem] border border-slate-200 bg-white px-2 py-0.5 transition hover:border-slate-300",
        editMode && canEdit && "cursor-grab select-none active:cursor-grabbing",
        editMode && canEdit && isOver && !isDragging && "border-amber-300 bg-amber-50",
        isDragging && "opacity-35"
      )}
    >
      {editMode && canEdit ? (
        <>
          <div className="absolute left-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <IconButton label={t("dashboard.itemEditTitle")} onClick={() => onEditItem(category, item)} stopPropagation>
              <Pencil className="h-3.5 w-3.5" />
            </IconButton>
          </div>
          <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
            <IconButton label={t("dashboard.itemDeleteTitle")} onClick={() => onDeleteItem(category, item)} stopPropagation tone="danger">
              <Trash2 className="h-3.5 w-3.5" />
            </IconButton>
          </div>
        </>
      ) : null}

      {editMode && canEdit ? (
        <div className="px-7 py-0.5 text-center text-[12px] font-medium leading-4 text-slate-800">
          {item.displayName}
        </div>
      ) : hasUrl ? (
        <a
          className="block rounded-[0.16rem] px-2 py-0.5 text-center text-[12px] font-medium leading-4 text-slate-900 no-underline outline-none transition visited:text-slate-900 hover:text-slate-900 focus:text-slate-900 focus:ring-2 focus:ring-amber-300"
          href={item.url}
          rel="noreferrer"
          target="_blank"
        >
          {item.displayName}
        </a>
      ) : (
        <div
          aria-disabled="true"
          className="block rounded-[0.24rem] px-2 py-0.5 text-center text-[12px] font-medium leading-4 text-slate-400"
        >
          {item.displayName}
        </div>
      )}
    </div>
  );
}

type CategoryDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  initialValue?: { title: string; color: string };
  onClose: () => void;
  onSubmit: (payload: { title: string; color: string }) => Promise<void>;
};

export function CategoryDialog({
  open,
  mode,
  initialValue,
  onClose,
  onSubmit
}: CategoryDialogProps) {
  const { t } = useI18n();
  const [title, setTitle] = useState(initialValue?.title ?? "");
  const [color, setColor] = useState(initialValue?.color ?? CATEGORY_PALETTE[0]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formId = `category-dialog-${mode}`;

  useEffect(() => {
    setTitle(initialValue?.title ?? "");
    setColor(initialValue?.color ?? CATEGORY_PALETTE[0]);
    setError("");
  }, [initialValue, open]);

  return (
    <Modal
      open={open}
      title={mode === "create" ? t("dashboard.categoryCreateTitle") : t("dashboard.categoryEditTitle")}
      description={t("dashboard.categoryDescription")}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            {t("action.cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            form={formId}
            type="submit"
          >
            {mode === "create" ? t("action.create") : t("action.save")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setIsSubmitting(true);
          setError("");

          try {
            await onSubmit({ title, color });
            onClose();
          } catch (submissionError) {
            setError(
              submissionError instanceof Error ? submissionError.message : t("dashboard.categorySaveError")
            );
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("dashboard.categoryName")}</span>
          <TextInput autoFocus maxLength={40} value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <div className="space-y-2">
          <p className="text-sm font-semibold text-slate-700">{t("dashboard.categoryColor")}</p>
          <div className="grid grid-cols-4 gap-3">
            {CATEGORY_PALETTE.map((option) => (
              <button
                key={option}
                className={cn(
                  "h-12 rounded-2xl border-2 transition",
                  color === option ? "border-slate-900 scale-[1.02]" : "border-transparent"
                )}
                onClick={() => setColor(option)}
                style={{ backgroundColor: option }}
                title={option}
                type="button"
              />
            ))}
          </div>
        </div>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </form>
    </Modal>
  );
}

type ItemDialogProps = {
  open: boolean;
  mode: "create" | "edit";
  initialValue?: { displayName: string; url: string };
  categoryTitle?: string;
  onClose: () => void;
  onSubmit: (payload: { displayName: string; url: string }) => Promise<void>;
};

export function ItemDialog({
  open,
  mode,
  initialValue,
  categoryTitle,
  onClose,
  onSubmit
}: ItemDialogProps) {
  const { t } = useI18n();
  const [displayName, setDisplayName] = useState(initialValue?.displayName ?? "");
  const [url, setUrl] = useState(initialValue?.url ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const formId = `item-dialog-${mode}`;

  useEffect(() => {
    setDisplayName(initialValue?.displayName ?? "");
    setUrl(initialValue?.url ?? "");
    setError("");
  }, [initialValue, open]);

  return (
    <Modal
      open={open}
      title={mode === "create" ? t("dashboard.itemCreateTitle") : t("dashboard.itemEditTitle")}
      description={
        categoryTitle
          ? t("dashboard.itemDescriptionWithCategory", { category: categoryTitle })
          : t("dashboard.itemDescription")
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            {t("action.cancel")}
          </Button>
          <Button
            disabled={isSubmitting}
            form={formId}
            type="submit"
          >
            {mode === "create" ? t("action.add") : t("action.save")}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="space-y-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setIsSubmitting(true);
          setError("");

          try {
            await onSubmit({ displayName, url });
            onClose();
          } catch (submissionError) {
            setError(submissionError instanceof Error ? submissionError.message : t("dashboard.itemSaveError"));
          } finally {
            setIsSubmitting(false);
          }
        }}
      >
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("dashboard.itemDisplayName")}</span>
          <TextInput
            autoFocus
            maxLength={60}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("dashboard.itemUrl")}</span>
          <TextInput
            placeholder="https://example.com"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>
        <p className="text-xs text-slate-500">{t("dashboard.itemUrlHint")}</p>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      </form>
    </Modal>
  );
}

export function ConfirmDialog({
  open,
  title,
  description,
  actionLabel,
  onClose,
  onConfirm
}: {
  open: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setError("");
      setLoading(false);
    }
  }, [open]);

  return (
    <Modal
      open={open}
      title={title}
      description={description}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} type="button" variant="ghost">
            {t("action.cancel")}
          </Button>
          <Button
            variant="danger"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              setError("");

              try {
                await onConfirm();
                onClose();
              } catch (confirmError) {
                setError(confirmError instanceof Error ? confirmError.message : t("dashboard.confirmError"));
              } finally {
                setLoading(false);
              }
            }}
            type="button"
          >
            {actionLabel}
          </Button>
        </>
      }
    >
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </Modal>
  );
}

type AdminPanelProps = {
  settings: DashboardSetting | null;
  users: User[];
  loadingUsers: boolean;
  onRefreshUsers: () => Promise<void>;
  onSaveSettings: (payload: { title: string; columnCount: number; language: SupportedLanguage }) => Promise<void>;
  onExportDashboard: () => Promise<DashboardTransferPayload>;
  onImportDashboard: (payload: unknown) => Promise<void>;
  onCreateUser: (payload: { username: string; role: Role }) => Promise<{ user: User; temporaryPassword: string }>;
  onUpdateUser: (id: string, payload: { role?: Role; isActive?: boolean }) => Promise<void>;
  onResetPassword: (id: string) => Promise<{ user: User; temporaryPassword: string }>;
};

export function AdminPanel({
  settings,
  users,
  loadingUsers,
  onRefreshUsers,
  onSaveSettings,
  onExportDashboard,
  onImportDashboard,
  onCreateUser,
  onUpdateUser,
  onResetPassword
}: AdminPanelProps) {
  const { language: activeLanguage, languageOptions, t } = useI18n();
  const [title, setTitle] = useState(settings?.title ?? "");
  const [columnCount, setColumnCount] = useState(String(settings?.columnCount ?? 6));
  const [language, setLanguage] = useState<SupportedLanguage>(settings?.language ?? activeLanguage);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [dataMessage, setDataMessage] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [userMessage, setUserMessage] = useState("");
  const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isImportDragOver, setIsImportDragOver] = useState(false);
  const [temporaryPassword, setTemporaryPassword] = useState<{ username: string; password: string } | null>(
    null
  );
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitle(settings?.title ?? "");
    setColumnCount(String(settings?.columnCount ?? 6));
    setLanguage(settings?.language ?? activeLanguage);
  }, [activeLanguage, settings]);

  const importDashboardFile = async (file: File | null | undefined) => {
    if (!file) {
      return;
    }

    if (!(file.type.includes("json") || file.name.toLowerCase().endsWith(".json"))) {
      setDataMessage(t("admin.importOnlyJson"));
      return;
    }

    setIsImporting(true);
    setDataMessage("");

    try {
      const text = await file.text();
      const payload = JSON.parse(text) as unknown;

      await onImportDashboard(payload);
      setDataMessage(t("admin.importCompleted", { fileName: file.name }));
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : t("admin.importFailed"));
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    void importDashboardFile(file);
  };

  const handleExportDashboard = async () => {
    setDataMessage("");

    try {
      const payload = await onExportDashboard();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json"
      });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      anchor.href = url;
      anchor.download = `quick-trigger-dashboard-${stamp}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
      setDataMessage(t("admin.exportCompleted"));
    } catch (error) {
      setDataMessage(error instanceof Error ? error.message : t("admin.exportFailed"));
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[1.1fr_1.4fr]">
      <section className="paper-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("admin.caption")}</p>
            <h2 className="mt-2 text-2xl font-semibold">{t("admin.dashboardSettings")}</h2>
          </div>
          <RoleBadge role="admin" />
        </div>
        <form
          className="mt-6 space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();

            try {
              await onSaveSettings({
                title,
                columnCount: Number(columnCount),
                language
              });
              setSettingsMessage(translate(language, "dashboard.settingsSaved"));
            } catch (error) {
              setSettingsMessage(
                error instanceof Error ? error.message : translate(language, "dashboard.settingsSaveFailed")
              );
            }
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">{t("admin.dashboardTitle")}</span>
            <TextInput value={title} onChange={(event) => setTitle(event.target.value)} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">{t("admin.columnCount")}</span>
            <SelectInput value={columnCount} onChange={(event) => setColumnCount(event.target.value)}>
              {[4, 5, 6, 7, 8].map((value) => (
                <option key={value} value={value}>
                  {t("admin.columnOption", { count: value })}
                </option>
              ))}
            </SelectInput>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">{t("admin.language")}</span>
            <SelectInput value={language} onChange={(event) => setLanguage(event.target.value as SupportedLanguage)}>
              {languageOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {getLanguageOptionLabel(option.value)}
                </option>
              ))}
            </SelectInput>
          </label>
          <div className="flex justify-end">
            <Button type="submit">
              {t("action.save")}
            </Button>
          </div>
          {settingsMessage ? <p className="text-sm text-slate-500">{settingsMessage}</p> : null}
        </form>

        <div className="mt-10 border-t border-slate-200 pt-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("admin.backupCaption")}</p>
              <h3 className="mt-2 text-xl font-semibold">{t("admin.importExport")}</h3>
            </div>
            <Button onClick={() => void handleExportDashboard()} type="button" variant="secondary">
              {t("action.exportJson")}
            </Button>
          </div>
          <input
            ref={importInputRef}
            accept=".json,application/json"
            className="hidden"
            onChange={handleImportInputChange}
            type="file"
          />
          <div
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget;
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) {
                return;
              }

              setIsImportDragOver(false);
            }}
            onDragOver={(event) => {
              if (!Array.from(event.dataTransfer.types ?? []).includes("Files")) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = "copy";
              setIsImportDragOver(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setIsImportDragOver(false);
              void importDashboardFile(event.dataTransfer.files?.[0]);
            }}
            className={cn(
              "mt-5 rounded-[1.4rem] border border-dashed px-5 py-6 text-center transition",
              isImportDragOver
                ? "border-emerald-400 bg-emerald-50 text-emerald-700"
                : "border-slate-300 bg-white/70 text-slate-500"
            )}
          >
            <p className="text-sm font-medium text-slate-700">{t("admin.importDropTitle")}</p>
            <p className="mt-2 text-xs text-slate-500">
              {t("admin.importDropDescription")}
            </p>
            <div className="mt-4 flex justify-center">
              <Button
                disabled={isImporting}
                onClick={() => importInputRef.current?.click()}
                type="button"
                variant="secondary"
              >
                {t("action.importJson")}
              </Button>
            </div>
          </div>
          {dataMessage ? <p className="mt-4 text-sm text-slate-500">{dataMessage}</p> : null}
        </div>
      </section>

      <section className="paper-panel rounded-[2rem] p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("admin.userManagementCaption")}</p>
            <h2 className="mt-2 text-2xl font-semibold">{t("admin.userManagement")}</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={() => setIsCreateUserModalOpen(true)} type="button">
              <Plus className="h-3.5 w-3.5" />
              {t("admin.addUser")}
            </Button>
            <Button onClick={() => void onRefreshUsers()} type="button" variant="secondary">
              {t("action.refresh")}
            </Button>
          </div>
        </div>

        {userMessage ? <p className="mt-4 text-sm text-slate-500">{userMessage}</p> : null}

        {temporaryPassword ? (
          <div className="mt-5 rounded-[1rem] border border-amber-200 bg-amber-50 px-4 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-700">{t("admin.tempPasswordCaption")}</p>
            <p className="mt-2 text-sm text-slate-700">
              {t("admin.tempPasswordDescription", { username: temporaryPassword.username })}
            </p>
            <div className="mt-3 rounded-[0.65rem] border border-amber-200/70 bg-white px-3 py-2 font-mono text-base tracking-[0.16em] text-slate-900">
              {temporaryPassword.password}
            </div>
          </div>
        ) : null}

        <div className="mt-6 space-y-2">
          {loadingUsers ? (
            <p className="text-sm text-slate-500">{t("admin.loadingUsers")}</p>
          ) : (
            users.map((user) => (
              <article
                key={user.id}
                className="rounded-[0.9rem] border border-slate-200 bg-white/90 px-4 py-3"
              >
                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem_9.5rem] lg:items-center">
                  <p className="truncate text-[15px] font-semibold text-slate-900">{user.username}</p>
                  <div>
                    <SelectInput
                      className="h-10"
                      value={user.role}
                      onChange={async (event) => {
                        try {
                          await onUpdateUser(user.id, {
                            role: event.target.value as Role
                          });
                          setUserMessage(t("admin.roleChanged"));
                        } catch (error) {
                          setUserMessage(
                            error instanceof Error ? error.message : t("admin.roleChangeFailed")
                          );
                        }
                      }}
                    >
                      <option value="user">{getRoleLabel(activeLanguage, "user")}</option>
                      <option value="manager">{getRoleLabel(activeLanguage, "manager")}</option>
                      <option value="admin">{getRoleLabel(activeLanguage, "admin")}</option>
                    </SelectInput>
                  </div>
                  <Button
                    className="h-10"
                    onClick={async () => {
                      try {
                        await onUpdateUser(user.id, {
                          isActive: !user.isActive
                        });
                        setUserMessage(t("admin.userStatusChanged"));
                      } catch (error) {
                        setUserMessage(
                          error instanceof Error ? error.message : t("admin.userStatusChangeFailed")
                        );
                      }
                    }}
                    type="button"
                    variant="secondary"
                  >
                    {user.isActive ? t("admin.deactivate") : t("admin.activate")}
                  </Button>
                  <Button
                    className="h-10"
                    onClick={async () => {
                      try {
                        const result = await onResetPassword(user.id);
                        setTemporaryPassword({
                          username: result.user.username,
                          password: result.temporaryPassword
                        });
                        setUserMessage(t("admin.resetPasswordCompleted"));
                      } catch (error) {
                        setUserMessage(
                          error instanceof Error ? error.message : t("admin.resetPasswordFailed")
                        );
                      }
                    }}
                    type="button"
                  >
                    {t("admin.resetPassword")}
                  </Button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>

      <Modal
        open={isCreateUserModalOpen}
        title={t("admin.createUserTitle")}
        description={t("admin.createUserDescription")}
        onClose={() => setIsCreateUserModalOpen(false)}
        footer={
          <>
            <Button onClick={() => setIsCreateUserModalOpen(false)} type="button" variant="ghost">
              {t("action.cancel")}
            </Button>
            <Button form="create-user-form" type="submit">
              {t("admin.createUserSubmit")}
            </Button>
          </>
        }
      >
        <form
          id="create-user-form"
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setUserMessage("");

            try {
              const result = await onCreateUser({ username, role });
              setTemporaryPassword({
                username: result.user.username,
                password: result.temporaryPassword
              });
              setUsername("");
              setRole("user");
              setUserMessage(t("admin.userCreated"));
              setIsCreateUserModalOpen(false);
            } catch (error) {
              setUserMessage(error instanceof Error ? error.message : t("admin.userCreateFailed"));
            }
          }}
        >
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">{t("admin.username")}</span>
            <TextInput autoFocus value={username} onChange={(event) => setUsername(event.target.value)} />
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-semibold text-slate-700">{t("admin.userRole")}</span>
            <SelectInput value={role} onChange={(event) => setRole(event.target.value as Role)}>
              <option value="user">{getRoleLabel(activeLanguage, "user")}</option>
              <option value="manager">{getRoleLabel(activeLanguage, "manager")}</option>
              <option value="admin">{getRoleLabel(activeLanguage, "admin")}</option>
            </SelectInput>
          </label>
        </form>
      </Modal>
    </div>
  );
}

export function AuthCard({
  title,
  description,
  children
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-8">
      <div className="paper-panel w-full max-w-md rounded-[2.2rem] p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">QUICK TRIGGER</p>
        <h1 className="mt-4 text-3xl font-semibold text-slate-900">{title}</h1>
        {description ? <p className="mt-3 text-sm leading-6 text-slate-500">{description}</p> : null}
        <div className={cn(description ? "mt-8" : "mt-6")}>{children}</div>
      </div>
    </div>
  );
}

function HeaderLinkButton({
  to,
  label,
  icon,
  emphasis = false
}: {
  to: string;
  label: string;
  icon: ReactNode;
  emphasis?: boolean;
}) {
  return (
    <Link
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-[0.18rem] px-3 py-1.5 text-[13px] font-semibold transition",
        emphasis
          ? "border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
          : "text-slate-600 hover:bg-slate-900/5"
      )}
      to={to}
    >
      {icon}
      <span>{label}</span>
    </Link>
  );
}

export function TopNavigation({
  title,
  username,
  canEdit,
  editMode,
  isSaving,
  onToggleEditMode,
  onLogout,
  accountPath,
  adminPath,
  homePath,
  showModeToggle = false,
  compact = false,
  columnCount = 6
}: {
  title: string;
  username: string;
  canEdit: boolean;
  editMode: boolean;
  isSaving: boolean;
  onToggleEditMode: () => void;
  onLogout: () => void;
  accountPath: string;
  adminPath?: string;
  homePath?: string;
  showModeToggle?: boolean;
  compact?: boolean;
  columnCount?: number;
}) {
  const { t } = useI18n();
  const targetWidth = columnCount * 210 + Math.max(columnCount - 1, 0) * 12;

  return (
    <header
      className={cn(
        "paper-panel sticky top-3 z-40 rounded-[0.18rem] py-2.5 lg:top-8",
        compact && "mx-auto w-fit max-w-full"
      )}
      style={compact ? { width: `${targetWidth}px` } : undefined}
    >
      <div className="overflow-hidden">
        <div
          className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 px-2.5"
        >
          <div className="flex flex-nowrap items-center gap-2">
          {homePath ? (
            <HeaderLinkButton
              emphasis={false}
              icon={<LayoutGrid className="h-3.5 w-3.5" />}
              label={t("nav.board")}
              to={homePath}
            />
          ) : null}
          {showModeToggle ? (
            <div className="inline-flex rounded-[0.18rem] border border-slate-200 bg-slate-100 p-1">
              <button
                aria-pressed={!editMode}
                className={cn(
                  "rounded-[0.18rem] px-3 py-1.5 text-[13px] font-semibold transition",
                  !editMode ? "bg-white text-slate-900 shadow-sm" : "text-slate-600 hover:bg-white/70"
                )}
                onClick={() => {
                  if (editMode) {
                    onToggleEditMode();
                  }
                }}
                type="button"
              >
                {t("nav.view")}
              </button>
              <button
                aria-pressed={editMode}
                className={cn(
                  "rounded-[0.18rem] px-3 py-1.5 text-[13px] font-semibold transition",
                  editMode ? "bg-slate-900 text-white shadow-sm" : "text-slate-600 hover:bg-white/70",
                  !canEdit && "cursor-not-allowed opacity-50"
                )}
                disabled={!canEdit}
                onClick={() => {
                  if (!editMode) {
                    onToggleEditMode();
                  }
                }}
                type="button"
              >
                {t("nav.edit")}
              </button>
            </div>
          ) : null}
          {isSaving ? (
            <span className="rounded-[0.18rem] bg-amber-100 px-3 py-1.5 text-[13px] font-semibold text-amber-800">
              {t("nav.saving")}
            </span>
          ) : null}
          </div>

          <div className="px-4 text-center">
            <h1 className="truncate whitespace-nowrap text-[1.55rem] font-semibold tracking-tight text-slate-900">
              {title}
            </h1>
          </div>

          <div className="flex flex-nowrap items-center justify-end gap-2">
            {adminPath ? (
              <HeaderLinkButton
                emphasis={false}
                icon={<Shield className="h-3.5 w-3.5" />}
                label={t("nav.admin")}
                to={adminPath}
              />
            ) : null}
            <HeaderLinkButton
              icon={<UserRound className="h-3.5 w-3.5" />}
              label={username}
              to={accountPath}
            />
            <Button className="rounded-[0.18rem]" onClick={onLogout} type="button" variant="ghost">
              <LogOut className="h-3.5 w-3.5" />
              {t("nav.logout")}
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
}

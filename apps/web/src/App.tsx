import type { FormEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

import {
  AdminPanel,
  AuthCard,
  Button,
  CategoryDialog,
  ConfirmDialog,
  DashboardBoard,
  ItemDialog,
  LoadingScreen,
  SelectInput,
  TextInput,
  ToastViewport,
  TopNavigation
} from "./components";
import { getRoleLabel, useI18n } from "./i18n";
import { api, type DashboardCategory, type DashboardItem, type InstallStatus, type Role, type User } from "./lib";
import {
  roleCanEdit,
  useDashboardStore,
  useInstallStore,
  useSessionStore,
  useToastStore
} from "./store";

type CategoryDialogState =
  | {
      mode: "create";
      targetX?: number;
      targetY?: number;
    }
  | {
      mode: "edit";
      category: DashboardCategory;
    }
  | null;

type ItemDialogState =
  | {
      mode: "create";
      category: DashboardCategory;
    }
  | {
      mode: "edit";
      category: DashboardCategory;
      item: DashboardItem;
    }
  | null;

type ConfirmState =
  | {
      type: "category";
      category: DashboardCategory;
    }
  | {
      type: "item";
      category: DashboardCategory;
      item: DashboardItem;
    }
  | null;

function RequireAuth({ user, children }: { user: User | null; children: ReactNode }) {
  if (!user) {
    return <Navigate replace to="/login" />;
  }

  return <>{children}</>;
}

function RequireAdmin({ user, children }: { user: User | null; children: ReactNode }) {
  if (!user) {
    return <Navigate replace to="/login" />;
  }

  if (user.role !== "admin") {
    return <Navigate replace to="/" />;
  }

  return <>{children}</>;
}

function LoginPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const login = useSessionStore((state) => state.login);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      await login({ username, password });
      await useDashboardStore.getState().loadDashboard();
      navigate("/", { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : t("login.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard title={t("login.title")}>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("login.id")}</span>
          <TextInput
            autoComplete="username"
            autoFocus
            placeholder={t("login.id")}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("login.password")}</span>
          <TextInput
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {t("login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

function InstallDatabasePage({ onConfigured }: { onConfigured?: () => void }) {
  const { t } = useI18n();
  const configureDatabase = useInstallStore((state) => state.configureDatabase);
  const [provider, setProvider] = useState<"sqlite" | "mysql">("sqlite");
  const [address, setAddress] = useState("127.0.0.1:3306");
  const [database, setDatabase] = useState("quick_trigger");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      if (provider === "sqlite") {
        await configureDatabase({
          provider: "sqlite"
        });
      } else {
        await configureDatabase({
          provider: "mysql",
          address,
          database,
          username,
          password
        });
      }
      onConfigured?.();
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : t("install.database.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={t("install.database.title")}
      description={t("install.database.description")}
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("install.database.provider")}</span>
          <SelectInput
            autoFocus
            value={provider}
            onChange={(event) => setProvider(event.target.value as "sqlite" | "mysql")}
          >
            <option value="sqlite">{t("install.database.provider.sqlite")}</option>
            <option value="mysql">{t("install.database.provider.mysql")}</option>
          </SelectInput>
        </label>
        {provider === "mysql" ? (
          <>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("install.database.address")}</span>
              <TextInput
                placeholder="127.0.0.1:3306"
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("install.database.name")}</span>
              <TextInput value={database} onChange={(event) => setDatabase(event.target.value)} />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("install.database.username")}</span>
              <TextInput value={username} onChange={(event) => setUsername(event.target.value)} />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("install.database.password")}</span>
              <TextInput
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
          </>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            {t("install.database.sqliteHint")}
          </div>
        )}
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <Button className="w-full" disabled={isSubmitting} type="submit">
          {t("install.database.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

function InstallBootstrapPage({
  installStatus,
  onBack
}: {
  installStatus: InstallStatus;
  onBack: () => void;
}) {
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const completeInstallation = useInstallStore((state) => state.completeInstallation);
  const setSession = useSessionStore((state) => state.setSession);
  const loadDashboard = useDashboardStore((state) => state.loadDashboard);
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [dashboardTitle, setDashboardTitle] = useState("Quick Trigger");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setError("");

    try {
      const response = await completeInstallation({
        username,
        password,
        confirmPassword,
        dashboardTitle,
        language
      });
      setSession({
        user: response.user,
        token: response.token
      });
      await loadDashboard();
      navigate("/", { replace: true });
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : t("install.bootstrap.error"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={t("install.bootstrap.title")}
      description={
        installStatus.provider === "sqlite"
          ? t("install.bootstrap.sqliteReady", {
              filePath: installStatus.database?.filePath ?? ".runtime/quick-trigger.sqlite"
            })
          : t("install.bootstrap.mysqlReady", {
              address: installStatus.database?.address ?? "",
              database: installStatus.database?.database ?? ""
            })
      }
    >
      <form className="space-y-4" onSubmit={handleSubmit}>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("install.bootstrap.adminId")}</span>
          <TextInput
            autoFocus
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("install.bootstrap.adminPassword")}</span>
          <TextInput
            autoComplete="new-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("install.bootstrap.confirmPassword")}</span>
          <TextInput
            autoComplete="new-password"
            type="password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
          />
        </label>
        <label className="block space-y-2">
          <span className="text-sm font-semibold text-slate-700">{t("install.bootstrap.dashboardTitle")}</span>
          <TextInput value={dashboardTitle} onChange={(event) => setDashboardTitle(event.target.value)} />
        </label>
        {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        <div className="flex gap-3">
          <Button className="flex-1" onClick={onBack} type="button" variant="ghost">
            {t("action.backToDatabaseSetup")}
          </Button>
          <Button className="flex-1" disabled={isSubmitting} type="submit">
            {t("action.finishInstallation")}
          </Button>
        </div>
      </form>
    </AuthCard>
  );
}

function InstallPage({ installStatus }: { installStatus: InstallStatus }) {
  const [manualStep, setManualStep] = useState<"database" | null>(null);
  const currentStep = manualStep ?? (installStatus.step === "database" ? "database" : "admin");

  useEffect(() => {
    if (installStatus.step === "database") {
      setManualStep(null);
    }
  }, [installStatus.step]);

  if (currentStep === "database") {
    return <InstallDatabasePage onConfigured={() => setManualStep(null)} />;
  }

  return <InstallBootstrapPage installStatus={installStatus} onBack={() => setManualStep("database")} />;
}

function DashboardPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const {
    settings,
    categories,
    status,
    editMode,
    isSaving,
    loadDashboard,
    setEditMode,
    createCategory,
    updateCategory,
    deleteCategory,
    moveCategory,
    createItem,
    updateItem,
    deleteItem,
    moveItem,
    undo,
    redo
  } = useDashboardStore();
  const logout = useSessionStore((state) => state.logout);
  const canEdit = roleCanEdit(user.role);
  const [categoryDialog, setCategoryDialog] = useState<CategoryDialogState>(null);
  const [itemDialog, setItemDialog] = useState<ItemDialogState>(null);
  const [confirmDialog, setConfirmDialog] = useState<ConfirmState>(null);

  useEffect(() => {
    if (status === "idle") {
      void loadDashboard();
    }
  }, [loadDashboard, status]);

  useEffect(() => {
    if (!canEdit && editMode) {
      setEditMode(false);
    }
  }, [canEdit, editMode, setEditMode]);

  useEffect(() => {
    if (!canEdit || !editMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const modifier = navigator.platform.toLowerCase().includes("mac") ? event.metaKey : event.ctrlKey;

      if (!modifier) {
        return;
      }

      if (event.key.toLowerCase() === "z" && !event.shiftKey) {
        event.preventDefault();
        void undo();
      }

      if (event.key.toLowerCase() === "y" || (event.key.toLowerCase() === "z" && event.shiftKey)) {
        event.preventDefault();
        void redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [canEdit, editMode, redo, undo]);

  const pageTitle = settings?.title?.trim() || "main";

  if (status !== "ready") {
    return <LoadingScreen />;
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1900px] flex-col gap-4 px-3 py-3 sm:px-4 lg:gap-8 lg:px-6 lg:py-8">
      <TopNavigation
        accountPath="/account"
        adminPath={user.role === "admin" ? "/admin" : undefined}
        canEdit={canEdit}
        columnCount={settings?.columnCount ?? 6}
        compact
        editMode={editMode}
        isSaving={isSaving}
        onLogout={() => {
          void logout().then(() => {
            navigate("/login", { replace: true });
          });
        }}
        onToggleEditMode={() => setEditMode(!editMode)}
        showModeToggle
        title={pageTitle}
        username={user.username}
      />

      <main className="flex-1 pb-8">
        <DashboardBoard
          canEdit={canEdit}
          categories={categories}
          editMode={editMode}
          onCreateItem={(category) => setItemDialog({ mode: "create", category })}
          onDeleteCategory={(category) => setConfirmDialog({ type: "category", category })}
          onDeleteItem={(category, item) => setConfirmDialog({ type: "item", category, item })}
          onEditCategory={(category) => setCategoryDialog({ mode: "edit", category })}
          onEditItem={(category, item) => setItemDialog({ mode: "edit", category, item })}
          onCreateCategoryAt={(targetX, targetY) => setCategoryDialog({ mode: "create", targetX, targetY })}
          onCreateItemFromDrop={createItem}
          onMoveItem={moveItem}
          onMoveCategory={moveCategory}
          settings={settings}
        />
      </main>

      <CategoryDialog
        initialValue={
          categoryDialog?.mode === "edit"
            ? { title: categoryDialog.category.title, color: categoryDialog.category.color }
            : undefined
        }
        mode={categoryDialog?.mode ?? "create"}
        onClose={() => setCategoryDialog(null)}
        onSubmit={(payload) =>
          categoryDialog?.mode === "edit"
            ? updateCategory(categoryDialog.category.id, payload)
            : createCategory({
                ...payload,
                targetX: categoryDialog?.targetX,
                targetY: categoryDialog?.targetY
              })
        }
        open={Boolean(categoryDialog)}
      />

      <ItemDialog
        categoryTitle={itemDialog?.category.title}
        initialValue={
          itemDialog?.mode === "edit"
            ? { displayName: itemDialog.item.displayName, url: itemDialog.item.url }
            : undefined
        }
        mode={itemDialog?.mode ?? "create"}
        onClose={() => setItemDialog(null)}
        onSubmit={(payload) =>
          itemDialog?.mode === "edit"
            ? updateItem(itemDialog.item.id, payload)
            : itemDialog
              ? createItem({
                  categoryId: itemDialog.category.id,
                  ...payload
                })
              : Promise.resolve()
        }
        open={Boolean(itemDialog)}
      />

      <ConfirmDialog
        actionLabel={
          confirmDialog?.type === "category" ? t("dashboard.categoryDeleteTitle") : t("dashboard.itemDeleteTitle")
        }
        description={
          confirmDialog?.type === "category"
            ? t("dashboard.categoryDeleteDescription")
            : t("dashboard.itemDeleteDescription")
        }
        onClose={() => setConfirmDialog(null)}
        onConfirm={() => {
          if (!confirmDialog) {
            return Promise.resolve();
          }

          if (confirmDialog.type === "category") {
            return deleteCategory(confirmDialog.category.id);
          }

          return deleteItem(confirmDialog.item.id);
        }}
        open={Boolean(confirmDialog)}
        title={
          confirmDialog?.type === "category" ? t("dashboard.categoryDeleteTitle") : t("dashboard.itemDeleteTitle")
        }
      />
    </div>
  );
}

function AccountPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const { language, t } = useI18n();
  const logout = useSessionStore((state) => state.logout);
  const changePassword = useSessionStore((state) => state.changePassword);
  const pushToast = useToastStore((state) => state.push);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    setMessage("");

    try {
      await changePassword({
        currentPassword,
        newPassword,
        confirmPassword
      });
      pushToast({
        tone: "success",
        title: t("account.passwordChangedTitle"),
        description: t("account.passwordChangedDescription")
      });
      await logout();
      navigate("/login", { replace: true });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("account.passwordChangeFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-[1200px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
      <TopNavigation
        accountPath="/account"
        adminPath={user.role === "admin" ? "/admin" : undefined}
        canEdit={false}
        editMode={false}
        homePath="/"
        isSaving={false}
        onLogout={() => {
          void logout().then(() => navigate("/login", { replace: true }));
        }}
        onToggleEditMode={() => undefined}
        title={t("account.title")}
        username={user.username}
      />

      <main className="grid gap-6 pb-8 pt-4 lg:grid-cols-[0.8fr_1.2fr]">
        <section className="paper-panel rounded-[2rem] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("account.sectionCaption")}</p>
          <h2 className="mt-3 text-3xl font-semibold">{t("account.heading")}</h2>
          <div className="mt-8 space-y-5 text-sm text-slate-600">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("account.id")}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{user.username}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("account.role")}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">{getRoleLabel(language, user.role)}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-400">{t("account.status")}</p>
              <p className="mt-2 text-lg font-semibold text-slate-900">
                {user.isActive ? t("account.active") : t("account.inactive")}
              </p>
            </div>
          </div>
        </section>

        <section className="paper-panel rounded-[2rem] p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{t("account.securityCaption")}</p>
          <h2 className="mt-3 text-3xl font-semibold">{t("account.passwordHeading")}</h2>
          <p className="mt-3 text-sm leading-6 text-slate-500">
            {t("account.passwordDescription")}
          </p>
          <form className="mt-8 space-y-4" onSubmit={handleSubmit}>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("account.currentPassword")}</span>
              <TextInput
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("account.newPassword")}</span>
              <TextInput
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
              />
            </label>
            <label className="block space-y-2">
              <span className="text-sm font-semibold text-slate-700">{t("account.confirmNewPassword")}</span>
              <TextInput
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
              />
            </label>
            {message ? <p className="text-sm text-rose-600">{message}</p> : null}
            <div className="flex justify-end">
              <Button disabled={isSubmitting} type="submit">
                {t("action.savePassword")}
              </Button>
            </div>
          </form>
        </section>
      </main>
    </div>
  );
}

function AdminPage({ user }: { user: User }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const logout = useSessionStore((state) => state.logout);
  const { settings, updateSettings, loadDashboard, exportDashboard, importDashboard } = useDashboardStore();
  const toast = useToastStore((state) => state.push);
  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);

  const refreshUsers = async () => {
    setLoadingUsers(true);

    try {
      const nextUsers = await api.listUsers();
      setUsers(nextUsers);
    } catch (error) {
      toast({
        tone: "error",
        title: t("admin.usersLoadFailed"),
        description: error instanceof Error ? error.message : undefined
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    if (!settings) {
      void loadDashboard();
    }
    void refreshUsers();
  }, [loadDashboard, settings]);

  return (
    <div className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-6 px-4 py-4 sm:px-6 lg:px-8">
      <TopNavigation
        accountPath="/account"
        adminPath="/admin"
        canEdit={false}
        editMode={false}
        homePath="/"
        isSaving={false}
        onLogout={() => {
          void logout().then(() => navigate("/login", { replace: true }));
        }}
        onToggleEditMode={() => navigate("/")}
        title={t("admin.title")}
        username={user.username}
      />

      <main className="pb-8">
        <AdminPanel
          onExportDashboard={exportDashboard}
          loadingUsers={loadingUsers}
          onCreateUser={async (payload: { username: string; role: Role }) => {
            const result = await api.createUser(payload);
            await refreshUsers();
            return result;
          }}
          onImportDashboard={importDashboard}
          onRefreshUsers={refreshUsers}
          onResetPassword={async (id: string) => {
            const result = await api.resetUserPassword(id);
            await refreshUsers();
            return result;
          }}
          onSaveSettings={updateSettings}
          onUpdateUser={async (id: string, payload: { role?: Role; isActive?: boolean }) => {
            await api.updateUser(id, payload);
            await refreshUsers();
          }}
          settings={settings}
          users={users}
        />
      </main>
    </div>
  );
}

function NotFoundPage() {
  const { t } = useI18n();

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="paper-panel max-w-md rounded-[2rem] px-8 py-10 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-500">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-slate-900">{t("notFound.title")}</h1>
        <p className="mt-3 text-sm text-slate-500">{t("notFound.description")}</p>
      </div>
    </div>
  );
}

export default function App() {
  const installState = useInstallStore((state) => state.installStatus);
  const installStatus = useInstallStore((state) => state.status);
  const user = useSessionStore((state) => state.user);
  const sessionStatus = useSessionStore((state) => state.status);

  useEffect(() => {
    if (installStatus === "idle") {
      void useInstallStore.getState().loadStatus();
    }
  }, [installStatus]);

  useEffect(() => {
    if (installState?.setupComplete && sessionStatus === "idle") {
      void useSessionStore.getState().loadSession();
    }
  }, [installState?.setupComplete, sessionStatus]);

  if (installStatus === "idle" || installStatus === "loading") {
    return <LoadingScreen />;
  }

  if (!installState?.setupComplete) {
    return (
      <>
        <Routes>
          <Route element={<InstallPage installStatus={installState ?? { databaseConfigured: false, setupComplete: false, step: "database" }} />} path="*" />
        </Routes>
        <ToastViewport />
      </>
    );
  }

  if (sessionStatus === "idle" || sessionStatus === "loading") {
    return <LoadingScreen />;
  }

  return (
    <>
      <Routes>
        <Route element={user ? <Navigate replace to="/" /> : <LoginPage />} path="/login" />
        <Route
          element={
            <RequireAuth user={user}>
              <DashboardPage user={user!} />
            </RequireAuth>
          }
          path="/"
        />
        <Route
          element={
            <RequireAuth user={user}>
              <AccountPage user={user!} />
            </RequireAuth>
          }
          path="/account"
        />
        <Route
          element={
            <RequireAuth user={user}>
              <Navigate replace to="/account" />
            </RequireAuth>
          }
          path="/account/password"
        />
        <Route
          element={
            <RequireAdmin user={user}>
              <AdminPage user={user!} />
            </RequireAdmin>
          }
          path="/admin"
        />
        <Route element={<NotFoundPage />} path="*" />
      </Routes>
      <ToastViewport />
    </>
  );
}

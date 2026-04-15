import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { NextFunction, Request, Response } from "express";

import { AppError, env } from "./config.js";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const INSTALL_DIR = path.resolve(process.cwd(), ".runtime");
const INSTALL_CONFIG_PATH = path.join(INSTALL_DIR, "install-config.json");
const SQLITE_DB_RELATIVE_PATH = ".runtime/quick-trigger.sqlite";
const SQLITE_PRISMA_URL = "file:../.runtime/quick-trigger.sqlite";
const SQLITE_SCHEMA_PATH = path.resolve(process.cwd(), "prisma/schema.sqlite.prisma");
const MYSQL_SCHEMA_PATH = path.resolve(process.cwd(), "prisma/schema.mysql.prisma");
const NODE_BINARY_PATH = path.resolve(process.cwd(), "node_modules/node/bin/node");
const PRISMA_CLI_PATH = path.resolve(process.cwd(), "node_modules/prisma/build/index.js");

type DatabaseProvider = "sqlite" | "mysql";
type RuntimePrismaClient = import("@prisma/client").PrismaClient;

type RuntimeInstallConfig = {
  version: 2;
  provider: DatabaseProvider;
  sqlite?: {
    filePath: string;
  };
  database?: {
    host: string;
    port: number;
    name: string;
    username: string;
    password: string;
  };
  schemaReadyAt: string;
  setupCompleteAt?: string;
};

export type InstallStatus = {
  databaseConfigured: boolean;
  setupComplete: boolean;
  step: "database" | "admin" | "complete";
  provider?: DatabaseProvider;
  database?: {
    address?: string;
    database?: string;
    username?: string;
    filePath?: string;
  };
};

export type InstallDatabaseInput =
  | {
      provider: "sqlite";
    }
  | {
      provider: "mysql";
      address: string;
      database: string;
      username: string;
      password: string;
    };

let cachedInstallConfig = readInstallConfigSync();
let cachedPrismaClient: RuntimePrismaClient | null = null;
let cachedPrismaUrl = "";

function readInstallConfigSync() {
  if (!fs.existsSync(INSTALL_CONFIG_PATH)) {
    return null;
  }

  try {
    const raw = fs.readFileSync(INSTALL_CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as RuntimeInstallConfig;
  } catch {
    return null;
  }
}

function clearPrismaRequireCache() {
  for (const cacheKey of Object.keys(require.cache)) {
    if (cacheKey.includes(`${path.sep}node_modules${path.sep}@prisma${path.sep}client`) ||
        cacheKey.includes(`${path.sep}node_modules${path.sep}.prisma${path.sep}client`)) {
      delete require.cache[cacheKey];
    }
  }
}

function loadPrismaClientClass() {
  clearPrismaRequireCache();
  const prismaModule = require("@prisma/client") as {
    PrismaClient: new (options?: { datasourceUrl?: string; log?: string[] }) => RuntimePrismaClient;
  };

  return prismaModule.PrismaClient;
}

function createPrismaClient(databaseUrl: string) {
  const PrismaClient = loadPrismaClientClass();

  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: env.NODE_ENV === "development" ? ["warn", "error"] : ["error"]
  });
}

function escapeDatabaseIdentifier(value: string) {
  return `\`${value.replace(/`/g, "``")}\``;
}

function formatAddress(host: string, port: number) {
  return port === 3306 ? host : `${host}:${port}`;
}

function getSchemaPath(provider: DatabaseProvider) {
  return provider === "sqlite" ? SQLITE_SCHEMA_PATH : MYSQL_SCHEMA_PATH;
}

function buildSqliteUrl() {
  return SQLITE_PRISMA_URL;
}

export function parseMariaDbAddress(input: string) {
  const value = input.trim();

  if (!value) {
    throw new AppError("MariaDB 주소를 입력해 주세요.", 400);
  }

  try {
    const parsed = new URL(value.includes("://") ? value : `mysql://${value}`);

    if (!parsed.hostname) {
      throw new AppError("MariaDB 주소 형식이 올바르지 않습니다.", 400);
    }

    return {
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306
    };
  } catch {
    throw new AppError("MariaDB 주소 형식이 올바르지 않습니다.", 400);
  }
}

function buildMariaDbUrl(config: NonNullable<RuntimeInstallConfig["database"]>) {
  const username = encodeURIComponent(config.username);
  const password = encodeURIComponent(config.password);
  const host = config.host.includes(":") ? `[${config.host}]` : config.host;
  const database = encodeURIComponent(config.name);

  return `mysql://${username}:${password}@${host}:${config.port}/${database}`;
}

function buildAdminDatabaseUrl(config: NonNullable<RuntimeInstallConfig["database"]>) {
  return buildMariaDbUrl({
    ...config,
    name: "mysql"
  });
}

async function writeInstallConfig(config: RuntimeInstallConfig) {
  await mkdir(INSTALL_DIR, { recursive: true });
  await writeFile(INSTALL_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf-8",
    mode: 0o600
  });
  cachedInstallConfig = config;
}

function getDatabaseUrl(config: RuntimeInstallConfig) {
  if (config.provider === "sqlite") {
    return buildSqliteUrl();
  }

  if (!config.database) {
    throw new AppError("MariaDB 연결 설정이 누락되었습니다.", 400);
  }

  return buildMariaDbUrl(config.database);
}

async function inspectDatabaseState(databaseUrl: string) {
  const prisma = createPrismaClient(databaseUrl);

  try {
    await prisma.$connect();
    const [adminCount, settingCount] = await Promise.all([
      prisma.user.count({
        where: { role: "admin", isActive: true }
      }),
      prisma.dashboardSetting.count()
    ]);

    return {
      setupComplete: adminCount > 0 && settingCount > 0
    };
  } catch {
    return {
      setupComplete: false
    };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function ensureDatabaseExists(config: NonNullable<RuntimeInstallConfig["database"]>) {
  const adminClient = createPrismaClient(buildAdminDatabaseUrl(config));

  try {
    await adminClient.$connect();
    await adminClient.$executeRawUnsafe(
      `CREATE DATABASE IF NOT EXISTS ${escapeDatabaseIdentifier(config.name)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch {
    // Some MariaDB users may not have access to the mysql schema.
    // In that case db push below will still succeed when the target DB already exists.
  } finally {
    await adminClient.$disconnect().catch(() => undefined);
  }
}

async function generatePrismaClient(provider: DatabaseProvider) {
  try {
    await execFileAsync(
      NODE_BINARY_PATH,
      [PRISMA_CLI_PATH, "generate", "--schema", getSchemaPath(provider)],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
          DATABASE_URL: provider === "sqlite" ? buildSqliteUrl() : "mysql://root:password@127.0.0.1:3306/quick_trigger"
        }
      }
    );
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim() || error.message
        : error instanceof Error
          ? error.message
          : "Prisma client 생성에 실패했습니다.";
    throw new AppError(message, 500);
  }
}

async function ensureSqliteDatabaseFile(relativePath: string) {
  const absolutePath = path.resolve(process.cwd(), relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });

  if (!fs.existsSync(absolutePath)) {
    await writeFile(absolutePath, "", { encoding: "utf-8" });
  }
}

async function pushSchemaToDatabase(provider: DatabaseProvider, databaseUrl: string) {
  try {
    await execFileAsync(
      NODE_BINARY_PATH,
      [PRISMA_CLI_PATH, "db", "push", "--schema", getSchemaPath(provider), "--skip-generate"],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
          PRISMA_HIDE_UPDATE_MESSAGE: "1"
        }
      }
    );
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim() || error.message
        : error instanceof Error
          ? error.message
          : "데이터베이스 스키마 적용에 실패했습니다.";
    throw new AppError(message, 400);
  }
}

export function getInstallConfig() {
  return cachedInstallConfig;
}

export function isSetupCompleteLocally() {
  return Boolean(cachedInstallConfig?.setupCompleteAt);
}

export async function resetPrismaClient() {
  if (cachedPrismaClient) {
    const previous = cachedPrismaClient;
    cachedPrismaClient = null;
    cachedPrismaUrl = "";
    await previous.$disconnect().catch(() => undefined);
  } else {
    cachedPrismaUrl = "";
  }

  clearPrismaRequireCache();
}

function getPrismaUrlOrThrow() {
  const config = getInstallConfig();

  if (!config) {
    throw new AppError("설치가 필요합니다.", 503);
  }

  return getDatabaseUrl(config);
}

function getPrismaClient() {
  const databaseUrl = getPrismaUrlOrThrow();

  if (!cachedPrismaClient || cachedPrismaUrl !== databaseUrl) {
    void cachedPrismaClient?.$disconnect().catch(() => undefined);
    cachedPrismaClient = createPrismaClient(databaseUrl);
    cachedPrismaUrl = databaseUrl;
  }

  return cachedPrismaClient;
}

export const prisma = new Proxy({} as RuntimePrismaClient, {
  get(_target, property) {
    const client = getPrismaClient() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(client, property);
    return typeof value === "function" ? value.bind(client) : value;
  }
});

export async function getInstallStatus(): Promise<InstallStatus> {
  const config = getInstallConfig();

  if (!config) {
    return {
      databaseConfigured: false,
      setupComplete: false,
      step: "database"
    };
  }

  let setupComplete = Boolean(config.setupCompleteAt);

  if (!setupComplete) {
    const inspection = await inspectDatabaseState(getDatabaseUrl(config));
    setupComplete = inspection.setupComplete;

    if (setupComplete) {
      await writeInstallConfig({
        ...config,
        setupCompleteAt: new Date().toISOString()
      });
    }
  }

  return {
    databaseConfigured: true,
    setupComplete,
    step: setupComplete ? "complete" : "admin",
    provider: config.provider,
    database:
      config.provider === "sqlite"
        ? {
            filePath: config.sqlite?.filePath ?? SQLITE_DB_RELATIVE_PATH
          }
        : {
            address: config.database ? formatAddress(config.database.host, config.database.port) : undefined,
            database: config.database?.name,
            username: config.database?.username
          }
  };
}

export async function configureInstallDatabase(input: InstallDatabaseInput) {
  const parsedMysqlAddress = input.provider === "mysql" ? parseMariaDbAddress(input.address) : null;
  const nextConfig: RuntimeInstallConfig =
    input.provider === "sqlite"
      ? {
          version: 2,
          provider: "sqlite",
          sqlite: {
            filePath: SQLITE_DB_RELATIVE_PATH
          },
          schemaReadyAt: new Date().toISOString()
        }
      : {
          version: 2,
          provider: "mysql",
          database: {
            host: parsedMysqlAddress!.host,
            port: parsedMysqlAddress!.port,
            name: input.database.trim(),
            username: input.username.trim(),
            password: input.password
          },
          schemaReadyAt: new Date().toISOString()
        };

  await mkdir(INSTALL_DIR, { recursive: true });
  if (nextConfig.provider === "sqlite") {
    await ensureSqliteDatabaseFile(nextConfig.sqlite?.filePath ?? SQLITE_DB_RELATIVE_PATH);
  }
  await generatePrismaClient(nextConfig.provider);

  if (nextConfig.provider === "mysql" && nextConfig.database) {
    await ensureDatabaseExists(nextConfig.database);
  }

  const databaseUrl = getDatabaseUrl(nextConfig);
  await pushSchemaToDatabase(nextConfig.provider, databaseUrl);

  const inspection = await inspectDatabaseState(databaseUrl);

  await writeInstallConfig({
    ...nextConfig,
    ...(inspection.setupComplete ? { setupCompleteAt: new Date().toISOString() } : {})
  });
  await resetPrismaClient();

  return getInstallStatus();
}

export async function markInstallationComplete() {
  const config = getInstallConfig();

  if (!config) {
    throw new AppError("먼저 데이터베이스 연결을 완료해 주세요.", 400);
  }

  await writeInstallConfig({
    ...config,
    setupCompleteAt: new Date().toISOString()
  });
}

export async function ensureInstallationComplete(
  _request: Request,
  _response: Response,
  next: NextFunction
) {
  if (isSetupCompleteLocally()) {
    next();
    return;
  }

  try {
    const status = await getInstallStatus();

    if (status.setupComplete) {
      next();
      return;
    }
  } catch {
    // Ignore and fall through to install-required response below.
  }

  next(new AppError("설치가 필요합니다.", 503));
}

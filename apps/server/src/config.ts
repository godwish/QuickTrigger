import type { NextFunction, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ZodError, z } from "zod";

function loadLocalEnvFile() {
  const envPath = path.resolve(process.cwd(), ".env");

  if (!fs.existsSync(envPath)) {
    return;
  }

  const raw = fs.readFileSync(envPath, "utf-8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, "");

    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

loadLocalEnvFile();

const envSchema = z.object({
  DATABASE_URL: z.string().min(1).optional(),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().default(4000),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  COOKIE_NAME: z.string().min(1).default("dashboard_session"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET must be at least 16 characters."),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

export const env = envSchema.parse(process.env);

export const appRoleSchema = z.enum(["user", "manager", "admin"]);

export type AppRole = z.infer<typeof appRoleSchema>;

export type AuthenticatedUser = {
  id: string;
  username: string;
  role: AppRole;
  isActive: boolean;
};

export type AuthenticatedRequest = Request & {
  user?: AuthenticatedUser;
};

export class AppError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
  }
}

export const roleWeight: Record<AppRole, number> = {
  user: 1,
  manager: 2,
  admin: 3
};

export const asyncHandler =
  <
    TRequest extends Request = Request,
    TResponse extends Response = Response
  >(
    handler: (request: TRequest, response: TResponse) => Promise<unknown>
  ) =>
  (request: TRequest, response: TResponse, next: NextFunction) => {
    Promise.resolve(handler(request, response)).catch(next);
  };

export const sanitizeUser = (user: {
  id: string;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: user.id,
  username: user.username,
  role: coerceRole(user.role),
  isActive: user.isActive,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt
});

export const coerceRole = (role: string): AppRole => appRoleSchema.parse(role);

export const passwordSchema = z
  .string()
  .min(8, "비밀번호는 최소 8자 이상이어야 합니다.")
  .max(64, "비밀번호는 최대 64자까지 허용됩니다.");

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const comparePassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const normalizeUrl = (input: string) => {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new AppError("URL은 http 또는 https 프로토콜만 허용됩니다.", 400);
  }

  return parsed.toString();
};

export const generateTemporaryPassword = () =>
  crypto
    .randomUUID()
    .replace(/-/g, "")
    .slice(0, 14);

export const signToken = (payload: { sub: string; username: string; role: AppRole }) =>
  jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: "7d"
  });

export const verifyToken = (token: string) =>
  jwt.verify(token, env.JWT_SECRET) as {
    sub: string;
    username: string;
    role: AppRole;
    iat: number;
    exp: number;
  };

export const attachAuthCookie = (response: Response, token: string) => {
  response.cookie(env.COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7
  });
};

export const clearAuthCookie = (response: Response) => {
  response.clearCookie(env.COOKIE_NAME, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production"
  });
};

export const normalizeZodError = (error: ZodError) =>
  error.issues.map((issue) => issue.message).join(", ");

import type { NextFunction, Response } from "express";

import {
  AppError,
  type AppRole,
  type AuthenticatedRequest,
  coerceRole,
  env,
  roleWeight,
  verifyToken
} from "./config.js";
import { prisma } from "./database.js";

function readBearerToken(headerValue: string | undefined) {
  if (!headerValue) {
    return "";
  }

  const [scheme, token] = headerValue.split(" ");

  if (scheme?.toLowerCase() !== "bearer" || !token) {
    return "";
  }

  return token.trim();
}

export async function authenticate(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction
) {
  const token =
    request.cookies?.[env.COOKIE_NAME] ||
    readBearerToken(request.headers.authorization);

  if (!token) {
    next(new AppError("인증이 필요합니다.", 401));
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (!user || !user.isActive) {
      next(new AppError("비활성화되었거나 존재하지 않는 계정입니다.", 401));
      return;
    }

    request.user = {
      id: user.id,
      username: user.username,
      role: coerceRole(user.role),
      isActive: user.isActive
    };
    next();
  } catch {
    next(new AppError("세션이 만료되었거나 유효하지 않습니다.", 401));
  }
}

export async function optionalAuthenticate(
  request: AuthenticatedRequest,
  _response: Response,
  next: NextFunction
) {
  const token =
    request.cookies?.[env.COOKIE_NAME] ||
    readBearerToken(request.headers.authorization);

  if (!token) {
    next();
    return;
  }

  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.sub }
    });

    if (user && user.isActive) {
      request.user = {
        id: user.id,
        username: user.username,
        role: coerceRole(user.role),
        isActive: user.isActive
      };
    }
  } catch {
    request.user = undefined;
  }

  next();
}

export const requireRole =
  (requiredRole: AppRole) =>
  (request: AuthenticatedRequest, _response: Response, next: NextFunction) => {
    if (!request.user) {
      next(new AppError("인증이 필요합니다.", 401));
      return;
    }

    if (roleWeight[request.user.role] < roleWeight[requiredRole]) {
      next(new AppError("권한이 부족합니다.", 403));
      return;
    }

    next();
  };

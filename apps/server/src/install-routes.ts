import { Router } from "express";
import { z } from "zod";

import {
  AppError,
  appRoleSchema,
  asyncHandler,
  attachAuthCookie,
  hashPassword,
  normalizeZodError,
  passwordSchema,
  sanitizeUser,
  signToken
} from "./config.js";
import {
  configureInstallDatabase,
  getInstallConfig,
  getInstallStatus,
  markInstallationComplete,
  prisma
} from "./database.js";

const bootstrapSchema = z
  .object({
    username: z
      .string()
      .trim()
      .min(3, "관리자 ID는 최소 3자 이상이어야 합니다.")
      .max(32, "관리자 ID는 최대 32자까지 허용됩니다.")
      .regex(/^[a-zA-Z0-9._-]+$/, "관리자 ID는 영문, 숫자, ., _, - 만 사용할 수 있습니다."),
    password: passwordSchema,
    confirmPassword: passwordSchema,
    dashboardTitle: z.string().trim().min(1, "대시보드 이름을 입력해 주세요.").max(60),
    language: z.enum(["ko", "en", "ja", "zh-CN"]).default("ko")
  })
  .refine((value) => value.password === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "비밀번호 확인이 일치하지 않습니다."
  });

const parseBody = <TSchema extends z.ZodTypeAny>(schema: TSchema, input: unknown): z.infer<TSchema> => {
  try {
    return schema.parse(input);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new AppError(normalizeZodError(error), 400);
    }

    throw error;
  }
};

export const installRouter = Router();

installRouter.get(
  "/status",
  asyncHandler(async (_request, response) => {
    response.json(await getInstallStatus());
  })
);

// Database setup is now automatic during bootstrap or status check

installRouter.post(
  "/bootstrap",
  asyncHandler(async (request, response) => {
    const status = await getInstallStatus();

    if (status.setupComplete) {
      throw new AppError("이미 설치가 완료되었습니다. 로그인 후 사용해 주세요.", 400);
    }

    const payload = parseBody(bootstrapSchema, request.body);
    let installConfig = getInstallConfig();

    if (!installConfig) {
      await configureInstallDatabase();
      installConfig = getInstallConfig();
    }

    const existingAdminCount = await prisma.user.count({
      where: {
        role: appRoleSchema.parse("admin")
      }
    });

    if (existingAdminCount > 0) {
      await markInstallationComplete();
      throw new AppError("이미 관리자 계정이 존재합니다. 로그인 화면으로 이동해 주세요.", 400);
    }

    const user = await prisma.$transaction(async (tx) => {
      const existingSetting = await tx.dashboardSetting.findFirst({
        orderBy: { createdAt: "asc" }
      });

      if (existingSetting) {
        await tx.dashboardSetting.update({
          where: { id: existingSetting.id },
          data: {
            title: payload.dashboardTitle,
            columnCount: existingSetting.columnCount || 6,
            language: payload.language
          }
        });
      } else {
        await tx.dashboardSetting.create({
          data: {
            id: "singleton-dashboard-setting",
            title: payload.dashboardTitle,
            columnCount: 6,
            language: payload.language
          }
        });
      }

      // Add sample data for a better initial experience
      const isKorean = payload.language === "ko";
      const cat1 = await tx.category.create({
        data: {
          title: isKorean ? "필수 도구" : "Core Tools",
          color: "#d97706",
          gridX: 0,
          gridY: 0,
          sortOrder: 0
        }
      });
      const cat2 = await tx.category.create({
        data: {
          title: isKorean ? "모니터링" : "Monitoring",
          color: "#0f766e",
          gridX: 1,
          gridY: 0,
          sortOrder: 1
        }
      });

      await tx.item.createMany({
        data: [
          { categoryId: cat1.id, displayName: "GitHub", url: "https://github.com", sortOrder: 0 },
          { categoryId: cat1.id, displayName: "Notion", url: "https://www.notion.so", sortOrder: 1 },
          { categoryId: cat2.id, displayName: "Grafana", url: "https://grafana.com", sortOrder: 0 },
          { categoryId: cat2.id, displayName: "Sentry", url: "https://sentry.io", sortOrder: 1 }
        ]
      });

      return tx.user.create({
        data: {
          username: payload.username,
          passwordHash: await hashPassword(payload.password),
          role: "admin",
          isActive: true
        }
      });
    });

    await markInstallationComplete();

    const token = signToken({
      sub: user.id,
      username: user.username,
      role: "admin"
    });

    attachAuthCookie(response, token);

    response.status(201).json({
      status: await getInstallStatus(),
      user: sanitizeUser(user),
      token
    });
  })
);

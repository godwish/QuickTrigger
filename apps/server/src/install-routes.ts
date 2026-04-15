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

const installDatabaseSchema = z.object({
  provider: z.enum(["sqlite", "mysql"]),
  address: z.string().optional(),
  database: z.string().optional(),
  username: z.string().optional(),
  password: z.string().optional()
}).superRefine((value, context) => {
  if (value.provider !== "mysql") {
    return;
  }

  if (!value.address?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["address"],
      message: "MariaDB 주소를 입력해 주세요."
    });
  }

  const database = value.database?.trim() ?? "";
  if (!database) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["database"],
      message: "데이터베이스 이름을 입력해 주세요."
    });
  } else if (!/^[A-Za-z0-9$_-]+$/.test(database)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["database"],
      message: "데이터베이스 이름은 영문, 숫자, _, -, $ 만 사용할 수 있습니다."
    });
  }

  if (!value.username?.trim()) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["username"],
      message: "DB 아이디를 입력해 주세요."
    });
  }
});

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

installRouter.post(
  "/database",
  asyncHandler(async (request, response) => {
    const status = await getInstallStatus();

    if (status.setupComplete) {
      throw new AppError("이미 설치가 완료되었습니다. 관리자 화면에서 운영해 주세요.", 400);
    }

    const payload = parseBody(installDatabaseSchema, request.body);
    if (payload.provider === "sqlite") {
      response.json(await configureInstallDatabase({ provider: "sqlite" }));
      return;
    }

    response.json(
      await configureInstallDatabase({
        provider: "mysql",
        address: payload.address?.trim() ?? "",
        database: payload.database?.trim() ?? "",
        username: payload.username?.trim() ?? "",
        password: payload.password ?? ""
      })
    );
  })
);

installRouter.post(
  "/bootstrap",
  asyncHandler(async (request, response) => {
    const status = await getInstallStatus();

    if (status.setupComplete) {
      throw new AppError("이미 설치가 완료되었습니다. 로그인 후 사용해 주세요.", 400);
    }

    const payload = parseBody(bootstrapSchema, request.body);
    const installConfig = getInstallConfig();

    if (!installConfig) {
      throw new AppError("먼저 MariaDB 연결 설정을 완료해 주세요.", 400);
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

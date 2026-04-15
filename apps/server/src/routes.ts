import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { z } from "zod";

import { authenticate, optionalAuthenticate, requireRole } from "./auth.js";
import {
  AppError,
  appRoleSchema,
  asyncHandler,
  attachAuthCookie,
  clearAuthCookie,
  comparePassword,
  coerceRole,
  generateTemporaryPassword,
  hashPassword,
  normalizeUrl,
  normalizeZodError,
  passwordSchema,
  sanitizeUser,
  signToken,
  type AuthenticatedRequest
} from "./config.js";
import { prisma } from "./database.js";

const roleSchema = appRoleSchema;

const loginSchema = z.object({
  username: z.string().min(3).max(32),
  password: z.string().min(1)
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
    confirmPassword: passwordSchema
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ["confirmPassword"],
    message: "새 비밀번호 확인이 일치하지 않습니다."
  });

const categorySchema = z.object({
  title: z.string().min(1, "카테고리 이름은 필수입니다.").max(40),
  color: z
    .string()
    .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "색상 값이 올바르지 않습니다.")
});

const itemSchema = z.object({
  categoryId: z.string().min(1),
  displayName: z.string().min(1, "표시 이름은 필수입니다.").max(60),
  url: z.string().min(1)
});

const categoryReorderSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1)
});

const categoryMoveSchema = z.object({
  categoryId: z.string().min(1),
  targetX: z.number().int().min(0),
  targetY: z.number().int().min(0)
});

const itemReorderSchema = z.object({
  categoryId: z.string().min(1),
  orderedIds: z.array(z.string().min(1))
});

const itemMoveSchema = z.object({
  itemId: z.string().min(1),
  targetCategoryId: z.string().min(1),
  targetIndex: z.number().int().min(0)
});

const languageSchema = z.enum(["ko", "en", "ja", "zh-CN"]);

const settingsSchema = z.object({
  title: z.string().min(1, "대시보드 제목은 필수입니다.").max(60),
  columnCount: z.number().int().min(4).max(8),
  language: languageSchema.default("ko")
});

const createUserSchema = z.object({
  username: z
    .string()
    .min(3, "사용자명은 최소 3자 이상이어야 합니다.")
    .max(32, "사용자명은 최대 32자까지 허용됩니다.")
    .regex(/^[a-zA-Z0-9._-]+$/, "사용자명은 영문, 숫자, ., _, - 만 사용할 수 있습니다."),
  role: roleSchema
});

const patchUserSchema = z
  .object({
    role: roleSchema.optional(),
    isActive: z.boolean().optional()
  })
  .refine((value) => value.role !== undefined || value.isActive !== undefined, {
    message: "변경할 사용자 정보가 필요합니다."
});

const categoryPatchSchema = categorySchema
  .partial()
  .refine((value) => Object.keys(value).length > 0, "변경할 카테고리 정보가 필요합니다.");

const itemPatchSchema = itemSchema
  .omit({ categoryId: true })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "변경할 아이템 정보가 필요합니다.");

const syncDashboardSchema = z.object({
  categories: z.array(
    z.object({
      id: z.string().min(1),
      title: z.string().min(1).max(40),
      color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
      gridX: z.number().int().min(0),
      gridY: z.number().int().min(0),
      sortOrder: z.number().int().min(0),
      items: z.array(
        z.object({
          id: z.string().min(1),
          categoryId: z.string().min(1),
          displayName: z.string().min(1).max(60),
          url: z.string(),
          sortOrder: z.number().int().min(0)
        })
      )
    })
  )
});

const importIdSchema = z.string().trim().optional().transform((value) => value || undefined);

const dashboardTransferSchema = z.object({
  version: z.number().int().optional(),
  exportedAt: z.string().optional(),
  settings: settingsSchema,
  categories: z.array(
    z.object({
      id: importIdSchema,
      title: z.string().min(1).max(40),
      color: z.string().regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/),
      gridX: z.number().int().min(0),
      gridY: z.number().int().min(0),
      sortOrder: z.number().int().min(0).optional(),
      items: z.array(
        z.object({
          id: importIdSchema,
          categoryId: importIdSchema,
          displayName: z.string().min(1).max(60),
          url: z.string().default(""),
          sortOrder: z.number().int().min(0).optional()
        })
      )
    })
  )
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

type DbClient = any;

const getDashboardPayload = async () => {
  const settings =
    (await prisma.dashboardSetting.findFirst({
      orderBy: { createdAt: "asc" }
    })) ||
    (await prisma.dashboardSetting.create({
      data: {
        id: "singleton-dashboard-setting",
        title: "main",
        columnCount: 6,
        language: "ko"
      }
    }));

  const categories = await prisma.category.findMany({
    include: {
      items: {
        orderBy: { sortOrder: "asc" }
      }
    },
    orderBy: [{ gridY: "asc" }, { gridX: "asc" }, { sortOrder: "asc" }]
  });

  return { settings, categories };
};

async function getDashboardColumnCount(tx: DbClient) {
  const settings = await tx.dashboardSetting.findFirst({
    orderBy: { createdAt: "asc" }
  });

  return settings?.columnCount ?? 6;
}

async function reindexCategories(tx: DbClient) {
  const categories = await tx.category.findMany({
    orderBy: [{ gridY: "asc" }, { gridX: "asc" }, { sortOrder: "asc" }]
  });

  await Promise.all(
    categories.map((category: { id: string }, index: number) =>
      tx.category.update({
        where: { id: category.id },
        data: { sortOrder: index }
      })
    )
  );
}

function assertCategoriesWithinColumnCount(
  categories: Array<{ gridX: number }>,
  columnCount: number
) {
  if (categories.some((category) => category.gridX >= columnCount)) {
    throw new AppError("가져온 JSON의 카테고리 열 위치가 현재 column 수 범위를 벗어났습니다.", 400);
  }
}

async function replaceDashboardCategories(
  tx: DbClient,
  categories: z.infer<typeof syncDashboardSchema>["categories"]
) {
  const nextCategoryIds = categories.map((category) => category.id);
  const nextItems = categories.flatMap((category) =>
    category.items.map((item, itemIndex) => ({
      ...item,
      categoryId: category.id,
      url: item.url.trim() ? normalizeUrl(item.url) : "",
      sortOrder: item.sortOrder ?? itemIndex
    }))
  );
  const nextItemIds = nextItems.map((item) => item.id);

  await Promise.all(
    categories.map((category, categoryIndex) =>
      tx.category.upsert({
        where: { id: category.id },
        update: {
          title: category.title,
          color: category.color,
          gridX: category.gridX,
          gridY: category.gridY,
          sortOrder: category.sortOrder ?? categoryIndex
        },
        create: {
          id: category.id,
          title: category.title,
          color: category.color,
          gridX: category.gridX,
          gridY: category.gridY,
          sortOrder: category.sortOrder ?? categoryIndex
        }
      })
    )
  );

  await Promise.all(
    nextItems.map((item) =>
      tx.item.upsert({
        where: { id: item.id },
        update: {
          categoryId: item.categoryId,
          displayName: item.displayName,
          url: item.url,
          sortOrder: item.sortOrder
        },
        create: {
          id: item.id,
          categoryId: item.categoryId,
          displayName: item.displayName,
          url: item.url,
          sortOrder: item.sortOrder
        }
      })
    )
  );

  await tx.item.deleteMany({
    where: nextItemIds.length ? { id: { notIn: nextItemIds } } : {}
  });

  await tx.category.deleteMany({
    where: nextCategoryIds.length ? { id: { notIn: nextCategoryIds } } : {}
  });

  await reindexCategories(tx);
}

function normalizeImportedDashboard(payload: z.infer<typeof dashboardTransferSchema>) {
  const usedCategoryIds = new Set<string>();
  const usedItemIds = new Set<string>();

  const categories: z.infer<typeof syncDashboardSchema>["categories"] = payload.categories.map(
    (category, categoryIndex) => {
      let categoryId = category.id ?? randomUUID();

      while (usedCategoryIds.has(categoryId)) {
        categoryId = randomUUID();
      }

      usedCategoryIds.add(categoryId);

      const items = category.items.map((item, itemIndex) => {
        let itemId = item.id ?? randomUUID();

        while (usedItemIds.has(itemId)) {
          itemId = randomUUID();
        }

        usedItemIds.add(itemId);

        return {
          id: itemId,
          categoryId,
          displayName: item.displayName,
          url: item.url,
          sortOrder: item.sortOrder ?? itemIndex
        };
      });

      return {
        id: categoryId,
        title: category.title,
        color: category.color,
        gridX: category.gridX,
        gridY: category.gridY,
        sortOrder: category.sortOrder ?? categoryIndex,
        items
      };
    }
  );

  return {
    settings: payload.settings,
    categories
  };
}

async function findNextCategoryCell(tx: DbClient) {
  const columnCount = await getDashboardColumnCount(tx);
  const categories = await tx.category.findMany({
    orderBy: [{ gridY: "asc" }, { gridX: "asc" }, { sortOrder: "asc" }]
  });

  if (!categories.length) {
    return { gridX: 0, gridY: 0 };
  }

  const maxLinearIndex = categories.reduce(
    (max: number, category: { gridY: number; gridX: number }) =>
      Math.max(max, category.gridY * columnCount + category.gridX),
    -1
  );
  const nextIndex = maxLinearIndex + 1;

  return {
    gridX: nextIndex % columnCount,
    gridY: Math.floor(nextIndex / columnCount)
  };
}

async function moveCategoryOnServer(categoryId: string, targetX: number, targetY: number) {
  return prisma.$transaction(async (tx) => {
    const activeCategory = await tx.category.findUnique({
      where: { id: categoryId }
    });

    if (!activeCategory) {
      throw new AppError("이동할 카테고리를 찾을 수 없습니다.", 404);
    }

    if (activeCategory.gridX === targetX && activeCategory.gridY === targetY) {
      return;
    }

    const swapCategory = await tx.category.findFirst({
      where: {
        gridX: targetX,
        gridY: targetY
      }
    });

    await tx.category.update({
      where: { id: activeCategory.id },
      data: {
        gridX: targetX,
        gridY: targetY
      }
    });

    if (swapCategory && swapCategory.id !== activeCategory.id) {
      await tx.category.update({
        where: { id: swapCategory.id },
        data: {
          gridX: activeCategory.gridX,
          gridY: activeCategory.gridY
        }
      });
    }

    await reindexCategories(tx);
  });
}

async function moveItemOnServer(itemId: string, targetCategoryId: string, targetIndex: number) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.item.findUnique({
      where: { id: itemId }
    });

    if (!existing) {
      throw new AppError("이동할 아이템을 찾을 수 없습니다.", 404);
    }

    const targetCategory = await tx.category.findUnique({
      where: { id: targetCategoryId }
    });

    if (!targetCategory) {
      throw new AppError("대상 카테고리를 찾을 수 없습니다.", 404);
    }

    const sourceItems = await tx.item.findMany({
      where: { categoryId: existing.categoryId },
      orderBy: { sortOrder: "asc" }
    });

    const targetItems =
      existing.categoryId === targetCategoryId
        ? sourceItems
        : await tx.item.findMany({
            where: { categoryId: targetCategoryId },
            orderBy: { sortOrder: "asc" }
          });

    const movingItem = sourceItems.find((item) => item.id === itemId);

    if (!movingItem) {
      throw new AppError("이동할 아이템을 찾을 수 없습니다.", 404);
    }

    const nextSourceItems = sourceItems.filter((item) => item.id !== itemId);
    const insertionIndex =
      existing.categoryId === targetCategoryId
        ? Math.max(0, Math.min(targetIndex, nextSourceItems.length))
        : Math.max(0, Math.min(targetIndex, targetItems.length));

    if (existing.categoryId === targetCategoryId) {
      nextSourceItems.splice(insertionIndex, 0, movingItem);
      await Promise.all(
        nextSourceItems.map((item, index) =>
          tx.item.update({
            where: { id: item.id },
            data: {
              categoryId: targetCategoryId,
              sortOrder: index
            }
          })
        )
      );
    } else {
      const nextTargetItems = [...targetItems];
      nextTargetItems.splice(insertionIndex, 0, { ...movingItem, categoryId: targetCategoryId });

      await Promise.all([
        ...nextSourceItems.map((item, index) =>
          tx.item.update({
            where: { id: item.id },
            data: { sortOrder: index }
          })
        ),
        ...nextTargetItems.map((item, index) =>
          tx.item.update({
            where: { id: item.id },
            data: {
              categoryId: item.id === movingItem.id ? targetCategoryId : item.categoryId,
              sortOrder: index
            }
          })
        )
      ]);
    }
  });
}

export const apiRouter = Router();

apiRouter.get(
  "/auth/me",
  optionalAuthenticate,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    if (!request.user) {
      throw new AppError("인증이 필요합니다.", 401);
    }

    const user = await prisma.user.findUnique({
      where: { id: request.user.id }
    });

    if (!user) {
      throw new AppError("사용자를 찾을 수 없습니다.", 404);
    }

    response.json({
      user: sanitizeUser(user),
      token: signToken({
        sub: user.id,
        username: user.username,
        role: coerceRole(user.role)
      })
    });
  })
);

apiRouter.post(
  "/auth/login",
  asyncHandler(async (request, response) => {
    const payload = parseBody(loginSchema, request.body);
    const user = await prisma.user.findUnique({
      where: { username: payload.username }
    });

    if (!user || !user.isActive) {
      throw new AppError("사용자명 또는 비밀번호가 올바르지 않습니다.", 401);
    }

    const passwordMatched = await comparePassword(payload.password, user.passwordHash);

    if (!passwordMatched) {
      throw new AppError("사용자명 또는 비밀번호가 올바르지 않습니다.", 401);
    }

    attachAuthCookie(
      response,
      signToken({
        sub: user.id,
        username: user.username,
        role: coerceRole(user.role)
      })
    );

    response.json({
      user: sanitizeUser(user),
      token: signToken({
        sub: user.id,
        username: user.username,
        role: coerceRole(user.role)
      })
    });
  })
);

apiRouter.post(
  "/auth/logout",
  asyncHandler(async (_request, response) => {
    clearAuthCookie(response);
    response.status(204).send();
  })
);

apiRouter.post(
  "/auth/change-password",
  authenticate,
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const payload = parseBody(changePasswordSchema, request.body);
    const user = await prisma.user.findUnique({
      where: { id: request.user!.id }
    });

    if (!user) {
      throw new AppError("사용자를 찾을 수 없습니다.", 404);
    }

    const passwordMatched = await comparePassword(payload.currentPassword, user.passwordHash);

    if (!passwordMatched) {
      throw new AppError("현재 비밀번호가 올바르지 않습니다.", 400);
    }

    await prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(payload.newPassword)
      }
    });

    response.json({ ok: true });
  })
);

apiRouter.get(
  "/dashboard",
  authenticate,
  asyncHandler(async (_request, response) => {
    response.json(await getDashboardPayload());
  })
);

apiRouter.put(
  "/dashboard/state",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(syncDashboardSchema, request.body);
    const columnCount = await getDashboardColumnCount(prisma);
    assertCategoriesWithinColumnCount(payload.categories, columnCount);

    await prisma.$transaction(async (tx) => {
      await replaceDashboardCategories(tx, payload.categories);
    });

    response.json(await getDashboardPayload());
  })
);

apiRouter.get(
  "/admin/dashboard-export",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (_request, response) => {
    const payload = await getDashboardPayload();
    response.json({
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: {
        title: payload.settings.title,
        columnCount: payload.settings.columnCount,
        language: payload.settings.language ?? "ko"
      },
      categories: payload.categories
    });
  })
);

apiRouter.post(
  "/admin/dashboard-import",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(dashboardTransferSchema, request.body);
    const normalizedImport = normalizeImportedDashboard(payload);
    assertCategoriesWithinColumnCount(normalizedImport.categories, normalizedImport.settings.columnCount);

    await prisma.$transaction(async (tx) => {
      const current =
        (await tx.dashboardSetting.findFirst({
          orderBy: { createdAt: "asc" }
        })) ||
        (await tx.dashboardSetting.create({
          data: { id: "singleton-dashboard-setting", title: "main", columnCount: 6, language: "ko" }
        }));

      await tx.dashboardSetting.update({
        where: { id: current.id },
        data: {
          title: normalizedImport.settings.title,
          columnCount: normalizedImport.settings.columnCount,
          language: normalizedImport.settings.language ?? "ko"
        }
      });

      await replaceDashboardCategories(tx, normalizedImport.categories);
    });

    response.json(await getDashboardPayload());
  })
);

apiRouter.get(
  "/settings",
  authenticate,
  asyncHandler(async (_request, response) => {
    const settings = (await getDashboardPayload()).settings;
    response.json(settings);
  })
);

apiRouter.patch(
  "/settings",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(settingsSchema, request.body);
    const current =
      (await prisma.dashboardSetting.findFirst()) ||
      (await prisma.dashboardSetting.create({
        data: { id: "singleton-dashboard-setting", title: "main", columnCount: 6, language: "ko" }
      }));

    const settings = await prisma.dashboardSetting.update({
      where: { id: current.id },
      data: payload
    });

    response.json(settings);
  })
);

apiRouter.get(
  "/categories",
  authenticate,
  asyncHandler(async (_request, response) => {
    const categories = await prisma.category.findMany({
      include: {
        items: {
          orderBy: { sortOrder: "asc" }
        }
      },
      orderBy: [{ gridY: "asc" }, { gridX: "asc" }, { sortOrder: "asc" }]
    });

    response.json(categories);
  })
);

apiRouter.post(
  "/categories",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(categorySchema, request.body);
    const category = await prisma.$transaction(async (tx) => {
      const nextCell = await findNextCategoryCell(tx);
      const maxSort = await tx.category.aggregate({
        _max: { sortOrder: true }
      });

      return tx.category.create({
        data: {
          title: payload.title,
          color: payload.color,
          gridX: nextCell.gridX,
          gridY: nextCell.gridY,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1
        },
        include: {
          items: {
            orderBy: { sortOrder: "asc" }
          }
        }
      });
    });

    response.status(201).json(category);
  })
);

apiRouter.patch(
  "/categories/:id",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(categoryPatchSchema, request.body);
    const category = await prisma.category.update({
      where: { id: request.params.id },
      data: payload,
      include: {
        items: {
          orderBy: { sortOrder: "asc" }
        }
      }
    });

    response.json(category);
  })
);

apiRouter.delete(
  "/categories/:id",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    await prisma.category.delete({
      where: { id: request.params.id }
    });

    response.status(204).send();
  })
);

apiRouter.post(
  "/categories/move",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(categoryMoveSchema, request.body);
    await moveCategoryOnServer(payload.categoryId, payload.targetX, payload.targetY);
    response.json({ ok: true });
  })
);

apiRouter.post(
  "/categories/reorder",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(categoryReorderSchema, request.body);
    const columnCount = await getDashboardColumnCount(prisma);

    await prisma.$transaction(
      payload.orderedIds.map((id, index) =>
        prisma.category.update({
          where: { id },
          data: {
            gridX: index % columnCount,
            gridY: Math.floor(index / columnCount),
            sortOrder: index
          }
        })
      )
    );

    response.json({ ok: true });
  })
);

apiRouter.get(
  "/items",
  authenticate,
  asyncHandler(async (_request, response) => {
    const items = await prisma.item.findMany({
      orderBy: [{ categoryId: "asc" }, { sortOrder: "asc" }]
    });
    response.json(items);
  })
);

apiRouter.post(
  "/items",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(itemSchema, request.body);
    const category = await prisma.category.findUnique({
      where: { id: payload.categoryId }
    });

    if (!category) {
      throw new AppError("카테고리를 찾을 수 없습니다.", 404);
    }

    const maxSort = await prisma.item.aggregate({
      where: { categoryId: payload.categoryId },
      _max: { sortOrder: true }
    });

    const item = await prisma.item.create({
      data: {
        categoryId: payload.categoryId,
        displayName: payload.displayName,
        url: normalizeUrl(payload.url),
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1
      }
    });

    response.status(201).json(item);
  })
);

apiRouter.patch(
  "/items/:id",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(itemPatchSchema, request.body);
    const item = await prisma.item.update({
      where: { id: request.params.id },
      data: {
        ...(payload.displayName ? { displayName: payload.displayName } : {}),
        ...(payload.url ? { url: normalizeUrl(payload.url) } : {})
      }
    });

    response.json(item);
  })
);

apiRouter.delete(
  "/items/:id",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const item = await prisma.item.findUnique({
      where: { id: request.params.id }
    });

    if (!item) {
      throw new AppError("아이템을 찾을 수 없습니다.", 404);
    }

    await prisma.$transaction(async (tx) => {
      await tx.item.delete({
        where: { id: request.params.id }
      });

      const remaining = await tx.item.findMany({
        where: { categoryId: item.categoryId },
        orderBy: { sortOrder: "asc" }
      });

      await Promise.all(
        remaining.map((entry, index) =>
          tx.item.update({
            where: { id: entry.id },
            data: { sortOrder: index }
          })
        )
      );
    });

    response.status(204).send();
  })
);

apiRouter.post(
  "/items/reorder",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(itemReorderSchema, request.body);
    await prisma.$transaction(
      payload.orderedIds.map((id, index) =>
        prisma.item.update({
          where: { id },
          data: {
            categoryId: payload.categoryId,
            sortOrder: index
          }
        })
      )
    );

    response.json({ ok: true });
  })
);

apiRouter.post(
  "/items/move",
  authenticate,
  requireRole("manager"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(itemMoveSchema, request.body);
    await moveItemOnServer(payload.itemId, payload.targetCategoryId, payload.targetIndex);
    response.json({ ok: true });
  })
);

apiRouter.get(
  "/admin/users",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (_request, response) => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: "asc" }
    });

    response.json(users.map(sanitizeUser));
  })
);

apiRouter.post(
  "/admin/users",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const payload = parseBody(createUserSchema, request.body);
    const tempPassword = generateTemporaryPassword();

    const user = await prisma.user.create({
      data: {
        username: payload.username,
        role: payload.role,
        isActive: true,
        passwordHash: await hashPassword(tempPassword)
      }
    });

    response.status(201).json({
      user: sanitizeUser(user),
      temporaryPassword: tempPassword
    });
  })
);

apiRouter.patch(
  "/admin/users/:id",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (request: AuthenticatedRequest, response) => {
    const payload = parseBody(patchUserSchema, request.body);

    if (request.user!.id === request.params.id && payload.isActive === false) {
      throw new AppError("현재 로그인한 관리자 계정은 비활성화할 수 없습니다.", 400);
    }

    if (request.user!.id === request.params.id && payload.role && payload.role !== "admin") {
      throw new AppError("현재 로그인한 관리자 계정은 admin 권한을 유지해야 합니다.", 400);
    }

    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: payload
    });

    response.json({
      user: sanitizeUser(user),
      token: signToken({
        sub: user.id,
        username: user.username,
        role: coerceRole(user.role)
      })
    });
  })
);

apiRouter.post(
  "/admin/users/:id/reset-password",
  authenticate,
  requireRole("admin"),
  asyncHandler(async (request, response) => {
    const tempPassword = generateTemporaryPassword();
    const user = await prisma.user.update({
      where: { id: request.params.id },
      data: {
        passwordHash: await hashPassword(tempPassword)
      }
    });

    response.json({
      user: sanitizeUser(user),
      temporaryPassword: tempPassword
    });
  })
);

export function registerErrorHandler(router: Router) {
  router.use(
    (
      error: unknown,
      _request: Request,
      response: Response,
      _next: NextFunction
    ) => {
      if (error instanceof AppError) {
        response.status(error.statusCode).json({ message: error.message });
        return;
      }

      if (
        error &&
        typeof error === "object" &&
        "code" in error &&
        typeof (error as { code?: unknown }).code === "string"
      ) {
        const code = (error as { code: string }).code;

        if (code === "P2002") {
          response.status(409).json({ message: "중복된 값이 존재합니다." });
          return;
        }

        if (code === "P2025") {
          response.status(404).json({ message: "대상을 찾을 수 없습니다." });
          return;
        }
      }

      if (error instanceof z.ZodError) {
        response.status(400).json({ message: normalizeZodError(error) });
        return;
      }

      console.error(error);
      response.status(500).json({ message: "서버 오류가 발생했습니다." });
    }
  );
}

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";

const prisma = new PrismaClient();

const generatePassword = () =>
  crypto
    .randomBytes(12)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 14);

async function main() {
  await prisma.dashboardSetting.upsert({
    where: { id: "singleton-dashboard-setting" },
    update: {},
    create: {
      id: "singleton-dashboard-setting",
      title: "main",
      columnCount: 6
    }
  });

  const username = process.env.INITIAL_ADMIN_USERNAME?.trim() || "admin";
  const rawPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim() || generatePassword();
  const existingAdmin = await prisma.user.findUnique({
    where: { username }
  });

  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        username,
        passwordHash: await bcrypt.hash(rawPassword, 10),
        role: "admin",
        isActive: true
      }
    });

    console.log(`Initial admin created -> username: ${username}, password: ${rawPassword}`);
  } else {
    console.log(`Initial admin already exists -> username: ${username}`);
  }

  if (process.env.SEED_SAMPLE_DATA === "true") {
    const categoryCount = await prisma.category.count();

    if (categoryCount === 0) {
      await prisma.category.createMany({
        data: [
          { id: "seed-category-1", title: "Core Tools", color: "#d97706", gridX: 0, gridY: 0, sortOrder: 0 },
          { id: "seed-category-2", title: "Monitoring", color: "#0f766e", gridX: 1, gridY: 0, sortOrder: 1 },
          { id: "seed-category-3", title: "Reference", color: "#1d4ed8", gridX: 2, gridY: 0, sortOrder: 2 }
        ]
      });

      await prisma.item.createMany({
        data: [
          {
            categoryId: "seed-category-1",
            displayName: "GitHub",
            url: "https://github.com",
            sortOrder: 0
          },
          {
            categoryId: "seed-category-1",
            displayName: "Notion",
            url: "https://www.notion.so",
            sortOrder: 1
          },
          {
            categoryId: "seed-category-2",
            displayName: "Grafana",
            url: "https://grafana.com",
            sortOrder: 0
          },
          {
            categoryId: "seed-category-2",
            displayName: "Sentry",
            url: "https://sentry.io",
            sortOrder: 1
          },
          {
            categoryId: "seed-category-3",
            displayName: "Company Wiki",
            url: "https://example.com/wiki",
            sortOrder: 0
          }
        ]
      });

      console.log("Sample categories and items inserted.");
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

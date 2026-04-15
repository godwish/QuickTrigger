ALTER TABLE "Category" ADD COLUMN "gridX" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Category" ADD COLUMN "gridY" INTEGER NOT NULL DEFAULT 0;

WITH "settings" AS (
  SELECT COALESCE(
    (SELECT "columnCount" FROM "DashboardSetting" ORDER BY "createdAt" ASC LIMIT 1),
    6
  ) AS "columnCount"
)
UPDATE "Category"
SET
  "gridX" = "sortOrder" % (SELECT "columnCount" FROM "settings"),
  "gridY" = CAST("sortOrder" / (SELECT "columnCount" FROM "settings") AS INTEGER);

CREATE INDEX "Category_gridY_gridX_idx" ON "Category"("gridY", "gridX");

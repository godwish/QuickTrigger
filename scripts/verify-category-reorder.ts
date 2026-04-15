import {
  getBoardRowCount,
  moveCategoryToCell,
  moveItemSnapshot,
  sortCategoriesByPosition,
  type DashboardCategory
} from "../apps/web/src/lib.ts";

function makeCategory(
  id: string,
  gridX: number,
  gridY: number,
  itemSuffixes: string[] = ["1"]
): DashboardCategory {
  return {
    id,
    title: id,
    color: "#d97706",
    gridX,
    gridY,
    sortOrder: 0,
    createdAt: "",
    updatedAt: "",
    items: itemSuffixes.map((itemSuffix, index) => ({
      id: `${id}-item-${itemSuffix}`,
      categoryId: id,
      displayName: `${id}-item-${itemSuffix}`,
      url: "https://example.com",
      sortOrder: index,
      createdAt: "",
      updatedAt: ""
    }))
  };
}

const test1 = moveCategoryToCell(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 3, 0)],
  "A",
  1,
  1,
  6
);
const movedDown = test1.find((category) => category.id === "A");
if (!movedDown || movedDown.gridX !== 1 || movedDown.gridY !== 1) {
  throw new Error("test-1 failed");
}
console.log(`test-1: ok -> A moved to (${movedDown.gridX},${movedDown.gridY})`);

const test2 = moveCategoryToCell(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 0, 1)],
  "B",
  3,
  0,
  6
);
const movedToEmpty = test2.find((category) => category.id === "B");
if (!movedToEmpty || movedToEmpty.gridX !== 3 || movedToEmpty.gridY !== 0) {
  throw new Error("test-2 failed");
}
console.log(`test-2: ok -> B moved to empty (${movedToEmpty.gridX},${movedToEmpty.gridY})`);

const test3 = moveCategoryToCell(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 0, 1)],
  "A",
  0,
  2,
  6
);
const insertedA = test3.find((category) => category.id === "A");
const shiftedD = test3.find((category) => category.id === "D");
if (
  !insertedA ||
  !shiftedD ||
  insertedA.gridX !== 0 ||
  insertedA.gridY !== 1 ||
  shiftedD.gridX !== 0 ||
  shiftedD.gridY !== 0
) {
  throw new Error("test-3 failed");
}
console.log(`test-3: ok -> insert A(${insertedA.gridX},${insertedA.gridY}) D(${shiftedD.gridX},${shiftedD.gridY})`);

const test4 = moveCategoryToCell(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 3, 0)],
  "C",
  1,
  1,
  6
);
const movedBelow = test4.find((category) => category.id === "C");
if (!movedBelow || movedBelow.gridX !== 1 || movedBelow.gridY !== 1) {
  throw new Error("test-4 failed");
}
console.log(`test-4: ok -> C moved to lower row (${movedBelow.gridX},${movedBelow.gridY})`);

const reloaded = sortCategoriesByPosition(
  test4.map((category, index) => ({
    ...category,
    sortOrder: index
  }))
);
const reloadedC = reloaded.find((category) => category.id === "C");
if (!reloadedC || reloadedC.gridX !== 1 || reloadedC.gridY !== 1) {
  throw new Error("test-5-reload failed");
}
console.log(`test-5-reload: ok -> C stayed at (${reloadedC.gridX},${reloadedC.gridY})`);

const afterCategoryMove = moveCategoryToCell(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 0, 1)],
  "C",
  2,
  0,
  6
);
const categoryAfterMove = afterCategoryMove.find((category) => category.id === "C");
if (!categoryAfterMove || categoryAfterMove.gridX !== 2 || categoryAfterMove.gridY !== 0) {
  throw new Error("test-6-category failed");
}
console.log(`test-6-category: ok -> C moved to (${categoryAfterMove.gridX},${categoryAfterMove.gridY})`);

const insertedItems = moveItemSnapshot(
  [makeCategory("A", 0, 0, ["1", "2", "3"])],
  {
    mode: "insert",
    itemId: "A-item-1",
    targetItemId: "A-item-3",
    placement: "after"
  }
);
const insertCategory = insertedItems.find((category) => category.id === "A");
if (!insertCategory || insertCategory.items.map((item) => item.id).join(",") !== "A-item-2,A-item-3,A-item-1") {
  throw new Error("test-7-item-insert failed");
}
console.log(`test-7-item-insert: ok -> ${insertCategory.items.map((item) => item.id).join(" ")}`);

const beforeInsertItems = moveItemSnapshot(
  [makeCategory("A", 0, 0, ["1", "2", "3"])],
  {
    mode: "insert",
    itemId: "A-item-3",
    targetItemId: "A-item-2",
    placement: "before"
  }
);
const beforeInsertCategory = beforeInsertItems.find((category) => category.id === "A");
if (
  !beforeInsertCategory ||
  beforeInsertCategory.items.map((item) => item.id).join(",") !== "A-item-1,A-item-3,A-item-2"
) {
  throw new Error("test-8-item-before failed");
}
console.log(`test-8-item-before: ok -> ${beforeInsertCategory.items.map((item) => item.id).join(" ")}`);

const endMoveItems = moveItemSnapshot(
  [makeCategory("A", 0, 0, ["1", "2", "3"])],
  {
    mode: "end",
    itemId: "A-item-1",
    targetCategoryId: "A"
  }
);
const endMoveCategory = endMoveItems.find((category) => category.id === "A");
if (
  !endMoveCategory ||
  endMoveCategory.items.map((item) => item.id).join(",") !== "A-item-2,A-item-3,A-item-1"
) {
  throw new Error("test-9-item-end failed");
}
console.log(`test-9-item-end: ok -> ${endMoveCategory.items.map((item) => item.id).join(" ")}`);

const crossInsertItems = moveItemSnapshot(
  [makeCategory("A", 0, 0, ["1", "2"]), makeCategory("B", 1, 0, ["1", "2"])],
  {
    mode: "insert",
    itemId: "A-item-1",
    targetItemId: "B-item-1",
    placement: "before"
  }
);
const crossSwapA = crossInsertItems.find((category) => category.id === "A");
const crossSwapB = crossInsertItems.find((category) => category.id === "B");
if (
  !crossSwapA ||
  !crossSwapB ||
  crossSwapA.items.map((item) => item.id).join(",") !== "A-item-2" ||
  crossSwapB.items.map((item) => item.id).join(",") !== "A-item-1,B-item-1,B-item-2"
) {
  throw new Error("test-10-cross-insert failed");
}
console.log(
  `test-10-cross-insert: ok -> A=${crossSwapA.items.map((item) => item.id).join(" ")} / B=${crossSwapB.items
    .map((item) => item.id)
    .join(" ")}`
);

const viewRows = getBoardRowCount(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 3, 0)],
  6,
  false
);
const editRows = getBoardRowCount(
  [makeCategory("A", 0, 0), makeCategory("B", 1, 0), makeCategory("C", 2, 0), makeCategory("D", 3, 0)],
  6,
  true
);
if (viewRows !== 1 || editRows !== 2) {
  throw new Error(`test-11-board-rows failed\nviewRows=${viewRows}\neditRows=${editRows}`);
}
console.log(`test-11-board-rows: ok -> view=${viewRows}, edit=${editRows}`);

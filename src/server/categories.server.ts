import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "#/db";
import { reconcileBudgets } from "#/server/budget-alerts.server";

export async function deleteCategoryForUser(
  userId: string,
  data: { id: string; reassignToCategoryId?: string | null },
) {
  try {
    const [ownedCategory] = await db
      .select({ id: schema.categories.id })
      .from(schema.categories)
      .where(and(eq(schema.categories.id, data.id), eq(schema.categories.user_id, userId)))
      .limit(1);
    if (!ownedCategory) return { error: "Category not found" };

    // Collect all descendant category IDs (children, grandchildren, etc.)
    const allDescendantIds: string[] = [];

    async function collectChildren(parentId: string): Promise<void> {
      const children = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(eq(schema.categories.parent_id, parentId), eq(schema.categories.user_id, userId)),
        );
      for (const child of children) {
        allDescendantIds.push(child.id);
        await collectChildren(child.id);
      }
    }

    await collectChildren(data.id);

    // All category IDs that will be deleted (descendants + target)
    const allIdsToDelete = [...allDescendantIds, data.id];

    if (allIdsToDelete.length === 0) {
      return { error: "Category not found" };
    }

    if (data.reassignToCategoryId) {
      if (allIdsToDelete.includes(data.reassignToCategoryId)) {
        return {
          error: "Cannot reassign transactions to the category being deleted",
        };
      }
      const target = await db
        .select({ id: schema.categories.id })
        .from(schema.categories)
        .where(
          and(
            eq(schema.categories.id, data.reassignToCategoryId),
            eq(schema.categories.user_id, userId),
          ),
        )
        .limit(1);
      if (target.length === 0) {
        return { error: "Reassignment target category does not exist" };
      }

      // Reassign transactions from deleted categories to the target
      await db
        .update(schema.transactions)
        .set({ category_id: data.reassignToCategoryId })
        .where(
          and(
            inArray(schema.transactions.category_id, allIdsToDelete),
            eq(schema.transactions.user_id, userId),
          ),
        );
    } else {
      // Reset category_id on transactions that reference any of these categories
      await db
        .update(schema.transactions)
        .set({ category_id: null })
        .where(
          and(
            inArray(schema.transactions.category_id, allIdsToDelete),
            eq(schema.transactions.user_id, userId),
          ),
        );
    }

    // Reset category_id on receipt_items that reference any of these categories
    await db
      .update(schema.receipt_items)
      .set({ category_id: null })
      .where(inArray(schema.receipt_items.category_id, allIdsToDelete));

    // Delete categorization_rules that reference any of these categories
    await db
      .delete(schema.categorization_rules)
      .where(inArray(schema.categorization_rules.category_id, allIdsToDelete));

    // Delete all descendant categories first, then the target
    await db
      .delete(schema.categories)
      .where(
        and(inArray(schema.categories.id, allIdsToDelete), eq(schema.categories.user_id, userId)),
      );

    return { success: true };
  } finally {
    await reconcileBudgets(userId);
  }
}

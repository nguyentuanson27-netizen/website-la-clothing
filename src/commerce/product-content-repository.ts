import type { PrismaClient } from "../generated/prisma/client.ts";
import type { ProductContentSnapshot } from "./product-content-admin.ts";

const MAX_ADMIN_PRODUCTS = 100;

function parseAdminListLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_ADMIN_PRODUCTS) {
    throw new RangeError(`Admin product list limit must be between 1 and ${MAX_ADMIN_PRODUCTS}`);
  }
  return limit;
}

export function createProductContentRepository(client: PrismaClient) {
  async function productExists(productId: string): Promise<boolean> {
    return (
      (await client.productMirror.findUnique({
        where: { id: productId },
        select: { id: true },
      })) !== null
    );
  }

  async function saveContent(content: ProductContentSnapshot): Promise<ProductContentSnapshot> {
    const { productId, ...fields } = content;
    return client.productContent.upsert({
      where: { productId },
      create: { productId, ...fields },
      update: fields,
      select: {
        productId: true,
        editorialDescription: true,
        careInstructions: true,
        sizeGuide: true,
        seoTitle: true,
        seoDescription: true,
        collectionSlugs: true,
      },
    });
  }

  async function findForEditor(productId: string) {
    return client.productMirror.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        content: {
          select: {
            editorialDescription: true,
            careInstructions: true,
            sizeGuide: true,
            seoTitle: true,
            seoDescription: true,
            collectionSlugs: true,
            updatedAt: true,
          },
        },
      },
    });
  }

  async function listForAdmin(limit: number) {
    return client.productMirror.findMany({
      take: parseAdminListLimit(limit),
      orderBy: [{ name: "asc" }, { id: "asc" }],
      select: {
        id: true,
        name: true,
        slug: true,
        isActive: true,
        syncedAt: true,
        content: {
          select: {
            updatedAt: true,
          },
        },
      },
    });
  }

  return { productExists, saveContent, findForEditor, listForAdmin };
}

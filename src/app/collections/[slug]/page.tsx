import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CollectionDefinitionError } from "@/commerce/collection-definition";
import { createCollectionDefinitionRepository } from "@/commerce/collection-definition-repository";
import { listConfiguredStorefrontDiscoveryPage } from "@/commerce/storefront-catalog-runtime";
import { parseStorefrontDiscoverySearchParams } from "@/commerce/storefront-discovery";
import { StorefrontProductCard } from "@/components/commerce/storefront-product-card";
import { prisma } from "@/db/prisma";

export const metadata: Metadata = {
  title: "Collection",
};

const PAGE_SIZE = 24;
const tones = ["stone", "olive", "ink", "sand"] as const;
const repository = createCollectionDefinitionRepository(prisma);

type CollectionPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
};

function collectionPageHref(slug: string, page: number): string {
  return page === 1 ? `/collections/${slug}` : `/collections/${slug}?page=${page}`;
}

export default async function CollectionPage({ params, searchParams }: CollectionPageProps) {
  await connection();
  const { slug } = await params;

  let collection: Awaited<ReturnType<typeof repository.findPublishedBySlug>>;
  try {
    collection = await repository.findPublishedBySlug(slug);
  } catch (error) {
    if (error instanceof CollectionDefinitionError) notFound();
    throw error;
  }

  if (!collection || !collection.description?.trim()) notFound();

  let catalogPage: Awaited<ReturnType<typeof listConfiguredStorefrontDiscoveryPage>>;
  try {
    const query = await searchParams;
    const discovery = parseStorefrontDiscoverySearchParams({
      collection: collection.slug,
      page: query.page,
    });
    catalogPage = await listConfiguredStorefrontDiscoveryPage({
      discovery,
      pageSize: PAGE_SIZE,
    });
  } catch (error) {
    if (error instanceof RangeError) notFound();
    throw error;
  }

  const { page, products, totalCount, totalPages } = catalogPage;
  if (page > Math.max(totalPages, 1)) notFound();

  return (
    <main className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <Link
        className="text-xs font-semibold uppercase tracking-[0.14em] text-black/60 underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
        href="/shop"
      >
        ← Shop
      </Link>
      <p className="eyebrow mt-10">LA Clothing / Collection</p>
      <h1 className="mt-4 max-w-6xl text-[clamp(3.2rem,9vw,8rem)] font-semibold leading-[0.88] tracking-[-0.05em]">
        {collection.title}
      </h1>
      <div className="mt-10 grid gap-8 border-t border-black/20 pt-8 md:grid-cols-2">
        <p className="max-w-2xl font-serif text-2xl leading-snug md:text-3xl">
          {collection.description}
        </p>
        <p className="max-w-lg text-sm leading-6 text-black/65 md:justify-self-end">
          Membership của collection này do website quản lý. Giá, tồn kho và trạng thái bán vẫn được xác nhận từ catalog mirror hiện tại.
        </p>
      </div>

      {totalCount === 0 ? (
        <section className="mt-16 border-t border-black/20 py-16" aria-labelledby="collection-empty-title">
          <p className="eyebrow">Current collection</p>
          <h2 id="collection-empty-title" className="mt-4 max-w-2xl font-serif text-3xl leading-tight md:text-5xl">
            Collection này chưa có sản phẩm.
          </h2>
          <p className="mt-5 max-w-xl text-sm leading-6 text-black/65">
            Đây là trạng thái trống có chủ đích. Sản phẩm sẽ xuất hiện khi chủ shop gán membership cho collection này.
          </p>
        </section>
      ) : (
        <section className="mt-16" aria-labelledby="collection-products-title">
          <div className="section-heading-row border-t border-black/20 pt-5">
            <h2 id="collection-products-title">Sản phẩm</h2>
            <p className="eyebrow">
              {totalCount} sản phẩm · Trang {page}/{totalPages}
            </p>
          </div>
          <div className="product-grid">
            {products.map((product, index) => (
              <StorefrontProductCard
                key={product.id}
                slug={product.slug}
                name={product.name}
                editorialDescription={product.editorialDescription}
                variants={product.variants}
                tone={tones[((page - 1) * PAGE_SIZE + index) % tones.length]!}
              />
            ))}
          </div>

          {totalPages > 1 ? (
            <nav
              className="mt-12 flex items-center justify-between gap-4 border-t border-black/20 pt-6"
              aria-label="Phân trang collection"
            >
              {catalogPage.hasPrevious ? (
                <Link
                  className="inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                  href={collectionPageHref(collection.slug, page - 1)}
                  rel="prev"
                >
                  ← Trang trước
                </Link>
              ) : (
                <span aria-hidden="true" />
              )}
              {catalogPage.hasNext ? (
                <Link
                  className="inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
                  href={collectionPageHref(collection.slug, page + 1)}
                  rel="next"
                >
                  Trang sau →
                </Link>
              ) : null}
            </nav>
          ) : null}
        </section>
      )}
    </main>
  );
}

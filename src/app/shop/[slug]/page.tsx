import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { getConfiguredStorefrontProductBySlug } from "@/commerce/storefront-catalog-runtime";
import {
  buildStorefrontVariantOptions,
  toStorefrontSelectableOptions,
} from "@/commerce/storefront-product";
import { ProductPurchasePanel } from "@/components/commerce/product-purchase-panel";

type ProductPageProps = {
  params: Promise<{ slug: string }>;
};

export default async function ProductPage({ params }: ProductPageProps) {
  await connection();
  const { slug } = await params;

  let product: Awaited<ReturnType<typeof getConfiguredStorefrontProductBySlug>>;
  try {
    product = await getConfiguredStorefrontProductBySlug(slug);
  } catch (error) {
    if (error instanceof RangeError) notFound();
    throw error;
  }

  if (!product) notFound();

  const options = toStorefrontSelectableOptions(buildStorefrontVariantOptions(product.variants));

  return (
    <main className="mx-auto max-w-[1600px] px-6 py-10 md:py-16">
      <Link
        href="/shop"
        className="inline-flex min-h-11 items-center text-xs font-semibold uppercase tracking-[0.14em] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-black"
      >
        ← Quay lại Shop
      </Link>

      <div className="mt-7 grid gap-10 border-t border-black/20 pt-8 lg:grid-cols-[minmax(0,1.2fr)_minmax(22rem,0.8fr)] lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <div className="product-visual product-visual--stone min-h-[32rem] md:min-h-[44rem]" aria-hidden="true">
            <span className="garment-silhouette" />
          </div>
          <p className="mt-3 text-xs uppercase tracking-[0.12em] text-black/50">
            Hình ảnh sản phẩm đang được chuẩn hóa cho storefront.
          </p>
        </div>

        <article className="pb-10 lg:pt-4">
          <p className="eyebrow">LA Clothing / Product</p>
          <h1 className="mt-5 text-[clamp(2.8rem,6vw,6.5rem)] font-semibold leading-[0.9] tracking-[-0.045em]">
            {product.name}
          </h1>
          {product.editorialDescription ? (
            <p className="mt-7 max-w-2xl font-serif text-2xl leading-snug text-black/80 md:text-3xl">
              {product.editorialDescription}
            </p>
          ) : (
            <p className="mt-7 max-w-xl text-sm leading-6 text-black/60">
              Thông tin biên tập cho sản phẩm này đang được cập nhật.
            </p>
          )}

          <div className="mt-10">
            <ProductPurchasePanel slug={product.slug} options={options} />
          </div>

          {(product.sizeGuide || product.careInstructions) && (
            <section className="mt-12 border-t border-black/20" aria-labelledby="product-notes-title">
              <h2 id="product-notes-title" className="sr-only">
                Thông tin sản phẩm
              </h2>
              {product.sizeGuide ? (
                <div className="grid gap-3 border-b border-black/15 py-6 sm:grid-cols-[8rem_1fr]">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em]">Size guide</h3>
                  <p className="max-w-xl text-sm leading-6 text-black/70">{product.sizeGuide}</p>
                </div>
              ) : null}
              {product.careInstructions ? (
                <div className="grid gap-3 border-b border-black/15 py-6 sm:grid-cols-[8rem_1fr]">
                  <h3 className="text-xs font-semibold uppercase tracking-[0.14em]">Care</h3>
                  <p className="max-w-xl text-sm leading-6 text-black/70">{product.careInstructions}</p>
                </div>
              ) : null}
            </section>
          )}

          <p className="mt-8 max-w-xl text-xs leading-5 text-black/50">
            Tình trạng mua được được kiểm tra lại phía máy chủ khi Add to Bag. Dữ liệu tồn kho được dùng để quyết định khả dụng nhưng không gửi số lượng tồn chính xác xuống client.
          </p>
        </article>
      </div>
    </main>
  );
}

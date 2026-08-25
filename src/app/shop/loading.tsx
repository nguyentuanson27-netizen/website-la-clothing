export default function ShopLoading() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24" aria-busy="true" aria-live="polite">
      <p className="eyebrow">LA Clothing / Cửa hàng</p>
      <p className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em] text-black/15" aria-hidden="true">
        CỬA HÀNG
      </p>
      <p className="sr-only">Đang tải cửa hàng.</p>

      <div className="mt-12 grid gap-8 border-t border-black/20 pt-8 md:grid-cols-2" aria-hidden="true">
        <div className="h-24 max-w-xl animate-pulse bg-black/5" />
        <div className="h-20 max-w-lg animate-pulse bg-black/5 md:justify-self-end md:w-full" />
      </div>

      <div className="mt-16 grid gap-x-5 gap-y-14 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index}>
            <div className="aspect-[4/5] animate-pulse bg-black/5" />
            <div className="mt-4 h-4 w-2/3 animate-pulse bg-black/5" />
            <div className="mt-2 h-3 w-1/3 animate-pulse bg-black/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

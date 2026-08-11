export default function CartLoading() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24" aria-busy="true">
      <p className="eyebrow">Shopping / Bag</p>
      <div className="mt-4 h-24 w-3/5 max-w-3xl animate-pulse bg-black/10 md:h-36" />
      <div className="mt-12 grid gap-8 border-t border-black/20 pt-8">
        {[0, 1].map((item) => (
          <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-6" key={item}>
            <div className="aspect-[4/5] animate-pulse bg-black/10" />
            <div className="space-y-3 py-2">
              <div className="h-5 w-1/2 animate-pulse bg-black/10" />
              <div className="h-4 w-1/3 animate-pulse bg-black/10" />
              <div className="h-11 w-40 animate-pulse bg-black/10" />
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Đang tải túi hàng.</span>
    </div>
  );
}

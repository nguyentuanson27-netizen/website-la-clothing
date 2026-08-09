import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account | LA Clothing",
  description: "LA Clothing customer account.",
};

export default function AccountPage() {
  return (
    <div className="mx-auto min-h-[65vh] max-w-[1600px] px-6 py-16 md:py-24">
      <p className="eyebrow">Customer / Account</p>
      <h1 className="mt-4 text-[clamp(3.5rem,10vw,9rem)] font-semibold leading-[0.86] tracking-[-0.05em]">
        ACCOUNT
      </h1>
      <div className="mt-12 grid gap-8 border-t border-black/20 pt-8 md:grid-cols-2">
        <p className="max-w-xl font-serif text-2xl leading-snug md:text-3xl">
          An account will be optional — checkout remains available without registration.
        </p>
        <p className="max-w-lg text-sm leading-6 text-black/70 md:justify-self-end">
          Sign-in, saved delivery information and order history will appear here when customer accounts are enabled.
        </p>
      </div>
    </div>
  );
}

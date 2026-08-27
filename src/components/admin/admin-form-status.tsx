"use client";

import { useEffect, useRef, useState } from "react";

type AdminFormStatusProps = {
  kind: "success" | "error" | null;
  successMessage?: string;
  errorMessage?: string;
};

export function AdminFormStatus({
  kind,
  successMessage = "Đã lưu nội dung biên tập.",
  errorMessage = "Không thể lưu. Kiểm tra độ dài và định dạng các trường rồi thử lại.",
}: AdminFormStatusProps) {
  const statusRef = useRef<HTMLDivElement>(null);
  const [renderedKind, setRenderedKind] = useState<AdminFormStatusProps["kind"]>(null);
  const visibleKind = renderedKind === kind ? renderedKind : null;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setRenderedKind(kind));
    return () => cancelAnimationFrame(frame);
  }, [kind]);

  useEffect(() => {
    if (!visibleKind) return;

    const frame = requestAnimationFrame(() => statusRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [visibleKind]);

  return (
    <div
      ref={statusRef}
      className="mt-8 min-h-6 focus-visible:outline-2 focus-visible:outline-offset-4"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      tabIndex={visibleKind ? -1 : undefined}
    >
      {visibleKind === "success" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          {successMessage}
        </p>
      ) : null}
      {visibleKind === "error" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}
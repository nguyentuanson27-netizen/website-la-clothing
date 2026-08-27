"use client";

import { useEffect, useRef } from "react";

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

  useEffect(() => {
    if (kind) {
      statusRef.current?.focus();
    }
  }, [kind]);

  return (
    <div
      ref={statusRef}
      className="mt-8 min-h-6 focus-visible:outline-2 focus-visible:outline-offset-4"
      role={kind === "error" ? "alert" : "status"}
      aria-live={kind === "error" ? "assertive" : "polite"}
      aria-atomic="true"
      tabIndex={kind ? -1 : undefined}
    >
      {kind === "success" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          {successMessage}
        </p>
      ) : null}
      {kind === "error" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

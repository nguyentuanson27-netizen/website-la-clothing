"use client";

import { useEffect, useRef } from "react";

type AdminFormStatusProps = {
  kind: "success" | "error" | null;
};

export function AdminFormStatus({ kind }: AdminFormStatusProps) {
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
      aria-atomic="true"
      tabIndex={kind ? -1 : undefined}
    >
      {kind === "success" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          Đã lưu nội dung biên tập.
        </p>
      ) : null}
      {kind === "error" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          Không thể lưu. Kiểm tra độ dài và định dạng các trường rồi thử lại.
        </p>
      ) : null}
    </div>
  );
}

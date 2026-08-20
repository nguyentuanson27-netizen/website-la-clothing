"use client";

import { useEffect, useRef } from "react";

type CollectionAdminStatusProps = {
  kind: "success" | "error" | null;
};

export function CollectionAdminStatus({ kind }: CollectionAdminStatusProps) {
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
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">Đã lưu collection.</p>
      ) : null}
      {kind === "error" ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">
          Không thể lưu collection. Kiểm tra dữ liệu rồi thử lại.
        </p>
      ) : null}
    </div>
  );
}

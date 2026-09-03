"use client";

import { useEffect, useRef } from "react";

type PromotionAdminStatusProps = {
  kind: "success" | "error" | null;
  message: string | null;
};

/**
 * Moves focus to the outcome after a mutation, so a keyboard or screen-reader operator is told what
 * happened instead of being left where the button used to be. Errors are `alert` (assertive)
 * because the operator must not carry on believing the write landed; successes are `status`.
 */
export function PromotionAdminStatus({ kind, message }: PromotionAdminStatusProps) {
  const statusRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (kind) statusRef.current?.focus();
  }, [kind, message]);

  return (
    <div
      ref={statusRef}
      // A stable id so the outcome region can be addressed unambiguously; the framework mounts its
      // own empty route announcer with role="alert" on every navigation.
      id="promotion-admin-status"
      className="mt-6 min-h-6 focus-visible:outline-2 focus-visible:outline-offset-4"
      role={kind === "error" ? "alert" : "status"}
      aria-atomic="true"
      tabIndex={kind ? -1 : undefined}
    >
      {kind && message ? (
        <p className="border-l-2 border-black pl-4 text-sm font-semibold">{message}</p>
      ) : null}
    </div>
  );
}

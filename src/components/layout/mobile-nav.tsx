"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

type PrimaryNavItem = {
  href: string;
  label: string;
};

type MobileNavProps = {
  primaryNav: readonly PrimaryNavItem[];
};

export function MobileNav({ primaryNav }: MobileNavProps) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();

  const closeMenu = () => {
    if (detailsRef.current) {
      detailsRef.current.open = false;
      setIsOpen(false);
    }
  };

  // Close when route changes
  useEffect(() => {
    closeMenu();
  }, [pathname]);

  // Close on click outside or Escape key
  useEffect(() => {
    if (!isOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const details = detailsRef.current;
      if (!details || !details.open) return;
      const summary = details.querySelector("summary");
      const menu = details.querySelector(".mobile-menu");
      if (
        event.target instanceof Node &&
        !summary?.contains(event.target) &&
        !menu?.contains(event.target)
      ) {
        closeMenu();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && detailsRef.current?.open) {
        closeMenu();
        detailsRef.current?.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div className="mobile-nav">
      <details
        ref={detailsRef}
        onToggle={(e) => setIsOpen(e.currentTarget.open)}
      >
        <summary className="relative z-40">Menu</summary>
        {isOpen && (
          <div
            className="fixed inset-0 top-0 left-0 z-30 bg-black/20 md:hidden"
            aria-hidden="true"
            onClick={closeMenu}
          />
        )}
        <nav className="mobile-menu" aria-label="Điều hướng chính trên di động">
          {primaryNav.map((item) => (
            <Link key={item.href} href={item.href} onClick={closeMenu}>
              {item.label}
            </Link>
          ))}
          <Link href="/search" onClick={closeMenu}>
            Tìm kiếm
          </Link>
          <Link href="/account" onClick={closeMenu}>
            Tài khoản
          </Link>
        </nav>
      </details>
    </div>
  );
}

"use client";
import Link from "next/link";
import type { ComponentProps } from "react";

/**
 * A link inside Work. A plain click switches pages in the browser with no server round trip;
 * ⌘/Ctrl/middle-click still open the real URL in a new tab.
 */
export function WorkLink({ onGo, ...rest }: { onGo: () => void } & Omit<ComponentProps<typeof Link>, "onClick" | "prefetch">) {
  return (
    <Link
      {...rest}
      prefetch={false}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        onGo();
      }}
    />
  );
}

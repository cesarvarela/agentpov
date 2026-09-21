import * as React from "react";

import { cn } from "../../lib/utils";

/**
 * Minimal scroll container with a thin, dark, unobtrusive scrollbar.
 * Dependency-free on purpose: no Radix scroll-area needed for this app.
 */
function ScrollArea({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="scroll-area"
      className={cn(
        "min-h-0 overflow-y-auto overflow-x-hidden",
        "[scrollbar-width:thin] [scrollbar-color:var(--om-border)_transparent]",
        "[&::-webkit-scrollbar]:w-2 [&::-webkit-scrollbar-track]:bg-transparent",
        "[&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-[var(--om-border)]",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export { ScrollArea };

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../../lib/utils";

/**
 * Small pill used for layers (USER, PROJECT, ...), permission decisions and
 * inline annotations. Colors follow design/README.md.
 */
const badgeVariants = cva(
  "inline-flex items-center justify-center gap-1 rounded-[4px] border text-[10px] leading-4 tracking-[0.04em] uppercase whitespace-nowrap px-1.5",
  {
    variants: {
      variant: {
        default: "border-om-border bg-om-bg text-om-muted",
        amber: "border-om-amber-border bg-om-amber-bg text-om-amber",
        teal: "border-om-teal-border bg-om-teal-bg text-om-teal",
        orange: "border-om-orange-border bg-om-orange-bg text-om-orange",
        violet: "border-om-violet-border bg-om-violet-bg text-om-violet",
        // Decisions are a different family from layers: a round pill says what
        // happens, a square-ish pill says where a setting is defined. "Ask" is
        // the common default, so it stays colourless.
        allow: "rounded-full border-om-allow-border bg-om-allow-bg text-om-allow",
        ask: "rounded-full border-om-border bg-om-bg text-om-muted",
        deny: "rounded-full border-om-deny-border bg-om-deny-bg text-om-deny",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

function Badge({
  className,
  variant,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span";

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  );
}

export { Badge, badgeVariants };

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
        amber: "border-[#4a3d22] bg-[#2a2418] text-om-amber",
        teal: "border-[#2a4a48] bg-[#15292a] text-om-teal",
        allow: "border-[#2c4a35] bg-[#1a2a20] text-om-allow",
        ask: "border-om-border bg-om-bg text-om-muted",
        deny: "border-[#4a2c2c] bg-[#2a1a1a] text-om-deny",
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

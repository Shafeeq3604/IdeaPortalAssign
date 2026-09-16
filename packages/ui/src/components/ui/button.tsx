import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  /*
   * `transition-all` alone (the previous value) only ever animated a background-colour
   * darken — correct, but the only feedback a click produced anywhere in the app was a
   * flat colour swap. `--dur-fast`/`--ease-out-quint` are the same tokens the score ring
   * and card hovers use, so a press feels like it belongs to the same system rather than
   * inventing its own timing; `active:scale` is the tactile "this registered" cue a colour
   * change alone doesn't give, and `hover:shadow-e2` lifts a button off the page the same
   * way a Card now does, instead of being the one interactive surface with no elevation.
   */
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-all duration-[var(--dur-fast)] ease-[var(--ease-out-quint)] outline-none hover:shadow-e2 active:scale-[0.97] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 disabled:active:scale-100 disabled:hover:translate-y-0 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // `hover:-translate-y-px` + `hover:shadow-e3` (heavier than the base `shadow-e2`
        // every other variant gets): the one filled purple CTA per screen should feel
        // more responsive under a cursor than a secondary/ghost action beside it, not an
        // identical hover — restrained (a hairline lift, no sheen/glow), not decorative.
        default: "bg-primary text-primary-foreground hover:-translate-y-px hover:bg-primary/90 hover:shadow-e3",
        destructive:
          "bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        // The default variant is the one filled CTA per screen and gets the heavier lift
        // above; these three are what most buttons on any given screen actually are, and
        // a background-tint hover alone reads as inert next to it. A quieter version of
        // the same shadow-only cue (no lift, so it stays visibly secondary) keeps every
        // clickable surface in the tactile system instead of the CTA being the sole
        // "alive" thing on the page.
        outline:
          "border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground hover:shadow-e2 dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 hover:shadow-e1",
        ghost:
          "hover:bg-accent hover:text-accent-foreground hover:shadow-e1 dark:hover:bg-accent/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }

"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div
      data-slot="table-container"
      /*
       * `overflow-x-auto` already let a wide table scroll — the container itself was
       * never the bug. What was missing is any SIGNAL that it can: the thin, permanently-
       * visible scrollbar (the `[scrollbar-width]`/`[&::-webkit-scrollbar]` rules below)
       * fixes that in principle, but it sits at the BOTTOM edge of the scroll container —
       * and a table tall enough to need one at all (Review queue, People & access both
       * clip their rightmost column on a phone) puts that edge below the fold on first
       * view. Found live, at phone width: the container really was scrollable
       * (`scrollWidth` 646 vs `clientWidth` 311), but nothing on screen said so until you
       * scrolled all the way to the table's own bottom.
       *
       * The four `background-image` layers below are the standard CSS-only "scroll
       * shadow": two gradients attached `local` (they scroll WITH the content and match
       * `--card`, the surface every table in this product sits on) mask a shadow that is
       * otherwise always painted at both edges, so the shadow only shows where there is
       * still something to reveal — gone at rest on the left because there is nothing
       * behind it, visible on the right the instant a table overflows, and swapping ends
       * as you scroll. Visible immediately, in the table's own header row, not something
       * you have to scroll the whole page to discover.
       */
      className="relative w-full overflow-x-auto bg-[linear-gradient(to_right,var(--card)_30%,transparent),linear-gradient(to_left,var(--card)_30%,transparent),linear-gradient(to_right,rgb(0_0_0/12%),transparent_12px),linear-gradient(to_left,rgb(0_0_0/12%),transparent_12px)] bg-[length:24px_100%,24px_100%,12px_100%,12px_100%] bg-[position:left,right,left,right] bg-no-repeat [background-attachment:local,local,scroll,scroll] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-2 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "border-b transition-colors hover:bg-muted/50 has-aria-expanded:bg-muted/50 data-[state=selected]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "h-10 px-2 text-left align-middle font-medium whitespace-nowrap text-foreground [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}

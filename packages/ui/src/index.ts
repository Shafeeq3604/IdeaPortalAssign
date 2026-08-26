/**
 * @iep/ui — THE component layer (ADR-019, SPEC §7.6).
 *
 * shadcn/ui is the baseline. Components are installed HERE, once, and imported by every
 * app — not copied per app or per feature. That single-location rule is what keeps
 * D-09's original intent alive after the library swap: per-feature one-offs stay banned.
 *
 * Adding a custom component requires naming the shadcn component that fails to cover it.
 * "It was easier to write from scratch" is not a reason.
 */

export { cn } from "./lib/utils.js";

// ── shadcn/ui baseline — used as-is, restyled only through tokens ──
export * from "./components/ui/accordion.js";
export * from "./components/ui/alert.js";
export * from "./components/ui/avatar.js";
export * from "./components/ui/badge.js";
export * from "./components/ui/breadcrumb.js";
export * from "./components/ui/button.js";
export * from "./components/ui/card.js";
export * from "./components/ui/checkbox.js";
export * from "./components/ui/command.js";
export * from "./components/ui/dialog.js";
export * from "./components/ui/dropdown-menu.js";
export * from "./components/ui/form.js";
export * from "./components/ui/input.js";
export * from "./components/ui/label.js";
export * from "./components/ui/pagination.js";
export * from "./components/ui/popover.js";
export * from "./components/ui/radio-group.js";
export * from "./components/ui/scroll-area.js";
export * from "./components/ui/select.js";
export * from "./components/ui/separator.js";
export * from "./components/ui/sheet.js";
export * from "./components/ui/skeleton.js";
export * from "./components/ui/switch.js";
export * from "./components/ui/table.js";
export * from "./components/ui/tabs.js";
export * from "./components/ui/textarea.js";
export * from "./components/ui/tooltip.js";
export { Toaster } from "./components/ui/sonner.js";

// ── IEP custom — signatures frozen at P0, implementations in P1 (SPEC §7.6) ──
export * from "./components/iep/types.js";

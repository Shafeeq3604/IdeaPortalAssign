import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge only knows Tailwind's DEFAULT scales. Ours replace two of them in
 * theme.css — the type scale (`text-100` … `text-800`) and elevation (`shadow-e1` …) — and
 * a value it does not recognise is filed under COLOUR. So `text-100 text-muted-foreground`
 * read as two colours and the first one was dropped: 34 places in this package alone
 * silently lost their size (table headers rendered at 14px instead of --fs-100), and any
 * `text-100` passed to a component could not replace its built-in `text-sm`.
 *
 * Declaring the scales puts them back in the right groups. Keep this list in step with
 * `--text-*` and `--shadow-*` in theme.css.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["100", "200", "300", "400", "500", "600", "700", "800"],
      shadow: ["e1", "e2", "e3", "e4", "e4-lit"],
    },
  },
});

/** Merge class names, with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

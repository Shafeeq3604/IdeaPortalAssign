import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { useFlip } from "./motion";

/**
 * settle-rank (P20): jsdom has no layout, so each row's position is stubbed from its
 * index — what matters is that a row that moved is animated from where it WAS, and one
 * that did not move is left alone.
 */

function Board({ order }: { order: string[] }) {
  const ref = React.useRef<HTMLOListElement>(null);
  useFlip(ref, order.join(","));
  return (
    <ol ref={ref}>
      {order.map((id) => (
        <li key={id} data-flip-key={id}>{id}</li>
      ))}
    </ol>
  );
}

describe("useFlip", () => {
  const animate = vi.fn();

  afterEach(() => {
    vi.restoreAllMocks();
    animate.mockReset();
  });

  it("glides moved rows from their old place, and leaves unmoved ones alone", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      const top = this.dataset.flipKey ? index * 50 : 0;
      return { top, left: 0, width: 100, height: 40, right: 100, bottom: top + 40, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
    });
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: false } as MediaQueryList);

    const { rerender } = render(<Board order={["a", "b", "c"]} />);
    expect(animate).not.toHaveBeenCalled();

    rerender(<Board order={["c", "b", "a"]} />);
    const moved = animate.mock.contexts.map((el) => (el as HTMLElement).dataset.flipKey);
    expect(moved.sort()).toEqual(["a", "c"]);
    // "c" went from 100 to 0, so it starts 100 below where it now sits.
    const cIndex = animate.mock.contexts.findIndex((el) => (el as HTMLElement).dataset.flipKey === "c");
    expect(animate.mock.calls[cIndex]?.[0]).toEqual([{ transform: "translate(0px, 100px)" }, { transform: "none" }]);
  });

  it("does nothing under reduced motion", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
      return { top: index * 50, left: 0 } as DOMRect;
    });
    HTMLElement.prototype.animate = animate as unknown as HTMLElement["animate"];
    vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);

    const { rerender } = render(<Board order={["a", "b"]} />);
    rerender(<Board order={["b", "a"]} />);
    expect(animate).not.toHaveBeenCalled();
  });
});

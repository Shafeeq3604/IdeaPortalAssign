import { describe, expect, it } from "vitest";
import { maskAddress } from "./email.js";

describe("log transport address masking", () => {
  it("keeps the first character and the domain only", () => {
    expect(maskAddress("erin@example.invalid")).toBe("e***@example.invalid");
    expect(maskAddress("not-an-address")).toBe("***");
  });
});

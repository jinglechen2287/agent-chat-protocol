import { afterEach, describe, expect, it } from "vitest";

describe("loading the package without a global TextEncoder", () => {
  const original = globalThis.TextEncoder;
  afterEach(() => {
    globalThis.TextEncoder = original;
  });

  it("imports both entries and runs exports that never measure bytes", async () => {
    // @ts-expect-error: simulating a runtime that lacks the global
    delete globalThis.TextEncoder;
    const root = await import("../src/index");
    const server = await import("../src/server/index");
    expect(root.fallbackChatTitle("Fix the login\nmore")).toBe("Fix the login");
    expect(server.createTaskStore().create("t").id).toBe("t");
  });
});

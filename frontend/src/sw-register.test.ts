import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_MIN_MS, watchForUpdates } from "./sw-register";

describe("watchForUpdates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("fragt im festen Abstand und beim Zurückkehren nach, aber nicht zu oft", () => {
    const update = vi.fn(() => Promise.resolve());
    watchForUpdates({ update });
    expect(update).not.toHaveBeenCalled();

    // Kurz nach dem Laden hat der Browser gerade erst geprüft.
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).not.toHaveBeenCalled();

    vi.advanceTimersByTime(UPDATE_CHECK_MIN_MS + 1000);
    document.dispatchEvent(new Event("visibilitychange"));
    expect(update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("online"));
    expect(update).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("verkraftet eine fehlgeschlagene Anfrage", async () => {
    const update = vi.fn(() => Promise.reject(new Error("offline")));
    watchForUpdates({ update });
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS);
    expect(update).toHaveBeenCalledTimes(1);
    await Promise.resolve();
  });
});

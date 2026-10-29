import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Countdown from "./Countdown.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Countdown", () => {
  it("shows days, hours, minutes and seconds", () => {
    vi.setSystemTime(new Date("2026-10-28T10:00:00Z"));

    render(<Countdown />);

    expect(screen.getByRole("timer")).toHaveTextContent("80Days15Hours30Minutes00Seconds");
  });

  it("ticks down every second", () => {
    vi.setSystemTime(new Date("2027-01-17T01:29:50Z"));
    render(<Countdown />);
    expect(screen.getByRole("timer")).toHaveTextContent("10Seconds");

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByRole("timer")).toHaveTextContent("09Seconds");
  });

  it("says it is race day once the start time has passed", () => {
    vi.setSystemTime(new Date("2027-01-17T01:30:00Z"));

    render(<Countdown />);

    expect(screen.getByText("Race day is here")).toBeInTheDocument();
    expect(screen.queryByRole("timer")).toBeNull();
  });

  it("stops its timer when the page is left", () => {
    const clear = vi.spyOn(globalThis, "clearInterval");
    const { unmount } = render(<Countdown />);

    unmount();

    expect(clear).toHaveBeenCalled();
  });
});

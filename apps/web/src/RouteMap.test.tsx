import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RouteMap from "./RouteMap.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RouteMap", () => {
  it("describes the route for screen readers and marks every kilometre", () => {
    const { container } = render(<RouteMap />);

    expect(screen.getByRole("img", { name: /5 km loop/i })).toBeInTheDocument();
    expect(container.querySelectorAll(".route-km")).toHaveLength(4);
  });

  it("shows the finished map at once where the browser cannot watch scrolling", () => {
    render(<RouteMap />);

    expect(screen.getByRole("img")).toHaveAttribute("data-seen", "true");
  });

  it("waits until the map is on screen before starting the animation", () => {
    type Callback = (entries: { isIntersecting: boolean }[]) => void;
    let notify: Callback = () => {};
    class FakeObserver {
      constructor(callback: Callback) {
        notify = callback;
      }
      observe() {}
      disconnect() {}
    }
    vi.stubGlobal("IntersectionObserver", FakeObserver);

    render(<RouteMap />);
    const map = screen.getByRole("img");
    expect(map).toHaveAttribute("data-seen", "false");

    act(() => notify([{ isIntersecting: false }]));
    expect(map).toHaveAttribute("data-seen", "false");

    act(() => notify([{ isIntersecting: true }]));
    expect(map).toHaveAttribute("data-seen", "true");
  });
});

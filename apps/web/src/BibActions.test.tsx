import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import BibActions from "./BibActions.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function stubClipboard(writeText: () => Promise<void>) {
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("BibActions", () => {
  it("opens the print dialog", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(<BibActions />);

    fireEvent.click(screen.getByRole("button", { name: /save or print/i }));

    expect(print).toHaveBeenCalledOnce();
  });

  it("copies the page link and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    render(<BibActions />);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    expect(await screen.findByText("Link copied")).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(window.location.href);
  });

  it("does not claim the link was copied when copying fails", async () => {
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    stubClipboard(writeText);
    render(<BibActions />);

    fireEvent.click(screen.getByRole("button", { name: /copy link/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(screen.queryByText("Link copied")).toBeNull();
  });
});

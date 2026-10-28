import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SiteHeader from "./SiteHeader.js";

describe("SiteHeader", () => {
  it("opens and closes the menu on small screens", () => {
    render(<SiteHeader />);
    const button = screen.getByRole("button", { name: /menu/i });
    expect(button).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("always offers a register link", () => {
    render(<SiteHeader />);

    expect(screen.getByRole("link", { name: /^register$/i })).toHaveAttribute("href", "#register");
  });

  it("does not show a phone number in the header", () => {
    const { container } = render(<SiteHeader />);

    expect(container).not.toHaveTextContent(/9033049847/);
  });

  it("leads back to the home page when used on another page", () => {
    render(<SiteHeader basePath="/" />);

    expect(screen.getByRole("link", { name: /^register$/i })).toHaveAttribute("href", "/#register");
    expect(screen.getByRole("link", { name: "PAWANKHIND" })).toHaveAttribute("href", "/");
  });
});

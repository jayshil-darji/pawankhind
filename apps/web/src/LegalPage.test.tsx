import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import LegalPage from "./LegalPage.js";

const renderPage = (page: "terms" | "privacy" | "refunds") =>
  render(
    <MemoryRouter>
      <LegalPage page={page} />
    </MemoryRouter>,
  );

describe("LegalPage", () => {
  it("states that registrations are non-refundable", () => {
    renderPage("refunds");

    expect(screen.getByRole("heading", { name: /refund/i })).toBeInTheDocument();
    expect(screen.getByText(/non-refundable/i)).toBeInTheDocument();
  });

  it("says who processes payments and how to reach us", () => {
    renderPage("privacy");

    expect(screen.getByText(/razorpay/i)).toBeInTheDocument();
    expect(screen.getByText(/9033049847/)).toBeInTheDocument();
  });

  it("has the same header and footer as the rest of the site", () => {
    renderPage("terms");

    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toBeInTheDocument();
  });
});

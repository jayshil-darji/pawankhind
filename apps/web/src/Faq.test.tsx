import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Faq from "./Faq.js";

describe("Faq", () => {
  it("lists the questions as expandable items", () => {
    const { container } = render(<Faq />);

    expect(container.querySelectorAll("details").length).toBeGreaterThanOrEqual(6);
    expect(screen.getByText("Can I register on the day?")).toBeInTheDocument();
  });

  it("states the rules that were decided, and no age limit", () => {
    const { container } = render(<Faq />);

    expect(screen.getByText(/non-refundable/i)).toBeInTheDocument();
    expect(screen.getByText(/no on-spot registration/i)).toBeInTheDocument();
    expect(screen.getByText(/no timing chip/i)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/age limit|minimum age/i);
  });
});

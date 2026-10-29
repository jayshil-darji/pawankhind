import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import Partners from "./Partners.js";

describe("Partners", () => {
  it("shows each tier that has partners, with their logos", () => {
    render(
      <Partners
        tiers={[
          { title: "Title Partner", partners: [{ name: "Acme Sports", logo: "/acme.png" }] },
          { title: "Health Partner", partners: [] },
        ]}
      />,
    );

    expect(screen.getByRole("heading", { name: "Our Partners" })).toBeInTheDocument();
    expect(screen.getByText("Title Partner")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Acme Sports" })).toHaveAttribute("src", "/acme.png");
    expect(screen.queryByText("Health Partner")).toBeNull();
  });

  it("renders nothing while there are no partners", () => {
    const { container } = render(<Partners tiers={[]} />);

    expect(container).toBeEmptyDOMElement();
  });
});

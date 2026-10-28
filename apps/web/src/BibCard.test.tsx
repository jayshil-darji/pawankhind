import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import BibCard from "./BibCard.js";

describe("BibCard", () => {
  it("shows the BIB number, the kit reminder and the reference", () => {
    render(<BibCard bib={1234} reference="reg-1" />);

    expect(screen.getByText("1234")).toBeInTheDocument();
    expect(screen.getByText("Friday, 15 January: 4 pm to 8 pm")).toBeInTheDocument();
    expect(screen.getByText("Saturday, 16 January: 10 am to 8 pm")).toBeInTheDocument();
    expect(screen.getByText(/photo id/i)).toBeInTheDocument();
    expect(screen.getByText("reg-1")).toBeInTheDocument();
  });
});

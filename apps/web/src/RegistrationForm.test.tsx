import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RegistrationForm } from "./RegistrationForm.js";

function fillValidDetails() {
  fireEvent.change(screen.getByLabelText("Full name"), { target: { value: "Asha Patel" } });
  fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "1995-05-10" } });
  fireEvent.change(screen.getByLabelText("Gender"), { target: { value: "female" } });
  fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "9876543210" } });
  fireEvent.change(screen.getByLabelText("T-shirt size"), { target: { value: "M" } });
  fireEvent.change(screen.getByLabelText("City"), { target: { value: "Visnagar" } });
  fireEvent.change(screen.getByLabelText("Emergency contact name"), {
    target: { value: "Ravi Patel" },
  });
  fireEvent.change(screen.getByLabelText("Emergency contact mobile"), {
    target: { value: "9123456780" },
  });
  fireEvent.click(screen.getByLabelText(/medically fit/i));
  fireEvent.click(screen.getByLabelText(/agree to the Terms of Use/i));
}

const submitButton = () => screen.getByRole("button", { name: /register and pay/i });

describe("RegistrationForm", () => {
  it("does not submit an empty form and marks the fields that need attention", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RegistrationForm onSubmit={onSubmit} />);

    fireEvent.click(submitButton());

    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(screen.getByLabelText("Full name")).toHaveAttribute("aria-invalid", "true");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits valid details", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RegistrationForm onSubmit={onSubmit} />);

    fillValidDetails();
    fireEvent.click(submitButton());

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: "Asha Patel", mobile: "9876543210" }),
    );
  });

  it("shows a problem reported by the server next to its field", async () => {
    const onSubmit = vi
      .fn()
      .mockResolvedValue([{ field: "mobile", message: "This mobile number is not allowed" }]);
    render(<RegistrationForm onSubmit={onSubmit} />);

    fillValidDetails();
    fireEvent.click(submitButton());

    expect(await screen.findByText("This mobile number is not allowed")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
  });

  it("links to the terms, privacy and refund policies", () => {
    render(<RegistrationForm onSubmit={vi.fn()} />);

    expect(screen.getByRole("link", { name: "Terms of Use" })).toHaveAttribute("href", "/terms");
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute(
      "href",
      "/privacy",
    );
    expect(screen.getByRole("link", { name: "Refund Policy" })).toHaveAttribute("href", "/refunds");
  });

  it("explains each problem in plain language", async () => {
    const { container } = render(<RegistrationForm onSubmit={vi.fn()} />);

    fireEvent.click(submitButton());

    expect(await screen.findByText("Enter your full name")).toBeInTheDocument();
    expect(screen.getByText("Select your date of birth")).toBeInTheDocument();
    expect(screen.getByText("Select your gender")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid 10-digit mobile number")).toBeInTheDocument();
    expect(screen.getByText("Select your T-shirt size")).toBeInTheDocument();
    expect(screen.getByText("Enter your city")).toBeInTheDocument();
    expect(screen.getByText("Enter your emergency contact's name")).toBeInTheDocument();
    expect(
      screen.getByText("Enter a valid 10-digit mobile number for your emergency contact"),
    ).toBeInTheDocument();
    expect(screen.getByText(/confirm the health declaration/i)).toBeInTheDocument();
    expect(screen.getByText(/accept the Terms, Privacy and Refund/i)).toBeInTheDocument();
    expect(container).not.toHaveTextContent(/expected|invalid option|too small/i);
  });

  it("does not submit until both declarations are ticked", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(<RegistrationForm onSubmit={onSubmit} />);

    fillValidDetails();
    fireEvent.click(screen.getByLabelText(/medically fit/i)); // untick the health declaration
    fireEvent.click(submitButton());

    expect(await screen.findByText(/confirm the health declaration/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

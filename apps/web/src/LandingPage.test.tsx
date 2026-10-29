import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LandingPage from "./LandingPage.js";

vi.mock("./RegisterPage.js", () => ({ default: () => "REGISTRATION FORM" }));

function renderAt(iso: string) {
  vi.setSystemTime(new Date(iso));
  return render(
    <MemoryRouter>
      <LandingPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("landing page", () => {
  it("states the kit collection times and that kits are not given on race day", () => {
    renderAt("2026-12-01T10:00:00Z");

    expect(screen.getByText("Friday, 15 January: 4 pm to 8 pm")).toBeInTheDocument();
    expect(screen.getByText("Saturday, 16 January: 10 am to 8 pm")).toBeInTheDocument();
    expect(screen.getByText(/not given on race day/i)).toBeInTheDocument();
  });

  it("hides the form and says when registration opens, before 15 November", () => {
    renderAt("2026-10-28T10:00:00Z");

    expect(screen.getByText(/registration opens on 15 november 2026/i)).toBeInTheDocument();
    expect(screen.queryByText("REGISTRATION FORM")).toBeNull();
  });

  it("shows the form while registration is open", () => {
    renderAt("2026-12-01T10:00:00Z");

    expect(screen.getByText("REGISTRATION FORM")).toBeInTheDocument();
  });

  it("hides the form once registration has closed", () => {
    renderAt("2027-01-09T10:00:00Z");

    expect(screen.getByText(/registration is closed/i)).toBeInTheDocument();
    expect(screen.queryByText("REGISTRATION FORM")).toBeNull();
  });

  it("shows the event name and links to the contact number", () => {
    renderAt("2026-12-01T10:00:00Z");

    expect(screen.getByRole("heading", { level: 1, name: "Pawankhind" })).toBeInTheDocument();
    const links = screen.getAllByRole("link", { name: /9033049847/ });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(link).toHaveAttribute("href", "tel:+919033049847");
  });

  it("shows the live countdown to race day", () => {
    renderAt("2026-10-28T10:00:00Z");

    expect(screen.getByRole("timer")).toHaveTextContent("80Days");
  });

  it("never mentions an age limit", () => {
    renderAt("2026-12-01T10:00:00Z");

    expect(document.body).not.toHaveTextContent(/age limit|minimum age/i);
  });
});

// Vitest runs with DEV=true; these stub the values a production build would inline.
describe("?phase override in a production build", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
    window.history.replaceState(null, "", "/?phase=open");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, "", "/");
  });

  it("is ignored without VITE_ALLOW_PHASE_OVERRIDE", () => {
    renderAt("2026-10-28T10:00:00Z");

    expect(screen.getByText(/registration opens on 15 november 2026/i)).toBeInTheDocument();
    expect(screen.queryByText("REGISTRATION FORM")).toBeNull();
  });

  it("shows the form with VITE_ALLOW_PHASE_OVERRIDE=true", () => {
    vi.stubEnv("VITE_ALLOW_PHASE_OVERRIDE", "true");

    renderAt("2026-10-28T10:00:00Z");

    expect(screen.getByText("REGISTRATION FORM")).toBeInTheDocument();
  });
});

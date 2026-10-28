import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, getStatus } from "./api.js";
import ResultPage from "./ResultPage.js";

vi.mock("./api.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api.js")>()),
  getStatus: vi.fn(),
}));

const getStatusMock = vi.mocked(getStatus);

function renderAt(id = "reg-1") {
  return render(
    <MemoryRouter initialEntries={[`/registration/${id}`]}>
      <Routes>
        <Route path="/registration/:id" element={<ResultPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

/** Move the fake clock forward and let pending promises finish. */
async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  getStatusMock.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("result page", () => {
  it("shows the BIB straight after a reload, with no form state", async () => {
    getStatusMock.mockResolvedValue({ status: "confirmed", bib: 1234 });

    renderAt("reg-1");
    await tick(0);

    expect(screen.getByText("1234")).toBeInTheDocument();
    expect(getStatusMock).toHaveBeenCalledWith("reg-1");
  });

  it("keeps polling while payment is pending, then shows the BIB", async () => {
    getStatusMock
      .mockResolvedValueOnce({ status: "held" })
      .mockResolvedValueOnce({ status: "held" })
      .mockResolvedValue({ status: "confirmed", bib: 1010 });

    renderAt();
    await tick(0);
    expect(screen.getByText(/waiting for payment confirmation/i)).toBeInTheDocument();

    await tick(6000);

    expect(screen.getByText("1010")).toBeInTheDocument();
    expect(getStatusMock).toHaveBeenCalledTimes(3);
  });

  it("stops polling once confirmed", async () => {
    getStatusMock.mockResolvedValue({ status: "confirmed", bib: 1234 });

    renderAt();
    await tick(30_000);

    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it("stops polling when the page is left", async () => {
    getStatusMock.mockResolvedValue({ status: "held" });

    const { unmount } = renderAt();
    await tick(0);
    unmount();
    await tick(30_000);

    expect(getStatusMock).toHaveBeenCalledTimes(1);
  });

  it("never shows a BIB unless the server says confirmed", async () => {
    getStatusMock.mockResolvedValue({ status: "held", bib: 9999 });

    renderAt();
    await tick(0);

    expect(screen.queryByText("9999")).toBeNull();
  });

  it("keeps trying after a temporary error", async () => {
    getStatusMock
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValue({ status: "confirmed", bib: 1500 });

    renderAt();
    await tick(3000);

    expect(screen.getByText("1500")).toBeInTheDocument();
  });

  it("says so when the registration does not exist", async () => {
    getStatusMock.mockRejectedValue(new ApiError(404, "unknown_registration"));

    renderAt("nope");
    await tick(0);

    expect(screen.getByText(/could not find this registration/i)).toBeInTheDocument();
  });

  it("explains an expired registration", async () => {
    getStatusMock.mockResolvedValue({ status: "expired" });

    renderAt();
    await tick(0);

    expect(screen.getByText(/has expired/i)).toBeInTheDocument();
  });

  it("gives up after the time limit and offers to check again", async () => {
    getStatusMock.mockResolvedValue({ status: "held" });

    renderAt();
    await tick(180_000);
    expect(screen.getByText(/have not received confirmation yet/i)).toBeInTheDocument();
    const callsBefore = getStatusMock.mock.calls.length;

    fireEvent.click(screen.getByRole("button", { name: /check again/i }));
    await tick(0);

    expect(getStatusMock.mock.calls.length).toBe(callsBefore + 1);
    expect(screen.getByText(/waiting for payment confirmation/i)).toBeInTheDocument();
  });
});

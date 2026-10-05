import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { LoginScreen } from "@/web/routes/login";

describe("login screen", () => {
  it("offers Google sign-in and explains a rejected account", () => {
    render(
      <MemoryRouter initialEntries={["/login?error=member_not_provisioned"]}>
        <LoginScreen />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Hourlark" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Continue with Google" })).toHaveAttribute(
      "href",
      "/api/v1/auth/google",
    );
    expect(screen.getByRole("alert")).toHaveTextContent("not a member of the workspace");
  });
});

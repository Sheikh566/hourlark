import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button, EmptyState } from "@/web/components/ui";

describe("shared UI primitives", () => {
  it("exposes accessible actions and empty-state guidance", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No time recorded"
        description="Start a timer or add time manually."
        action={<Button onClick={onClick}>Add time</Button>}
      />,
    );

    expect(screen.getByRole("heading", { name: "No time recorded" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add time" }));
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Add time" }).className).toContain("bg-[#f59e0b]");
    expect(screen.getByRole("button", { name: "Add time" }).className).toContain("text-[#18181b]");
    expect(screen.getByRole("button", { name: "Add time" }).className).not.toContain("#cd7fc2");
  });
});

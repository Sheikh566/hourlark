import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReportFilterBar,
  type ReportFilterBarProps,
  type ReportFilters,
} from "@/web/features/reports/report-filter-bar";

const clients: ReportFilterBarProps["clients"] = [
  { id: "c1", name: "Acme", status: "active" },
  { id: "c2", name: "Beta", status: "active" },
  { id: "c3", name: "Past", status: "archived" },
];
const projects: ReportFilterBarProps["projects"] = [
  {
    id: "p1",
    name: "Website",
    color: "#f00",
    client_id: "c1",
    client_name: "Acme",
    status: "active",
    billable_default: true,
  },
  {
    id: "p2",
    name: "Brand",
    color: "#00f",
    client_id: "c2",
    client_name: "Beta",
    status: "active",
    billable_default: false,
  },
];
const tags: ReportFilterBarProps["tags"] = [
  { id: "t1", name: "Design", color: "#fff", status: "active" },
  { id: "t2", name: "Meeting", color: "#fff", status: "active" },
];
const members: ReportFilterBarProps["members"] = [
  {
    id: "m1",
    display_name: "Abdullah",
    email: "test@example.com",
    role: "admin",
    status: "active",
    timezone: "UTC",
    weekly_target_minutes: null,
    last_seen_at: null,
    version: 1,
    running_entry_id: null,
    week_tracked_ms: 0,
    project_ids_json: "[]",
  },
];
function Harness({
  initial = {},
  canViewTeam = true,
  onChange = vi.fn(),
}: {
  initial?: ReportFilters;
  canViewTeam?: boolean;
  onChange?: (filters: ReportFilters) => void;
}) {
  const [filters, setFilters] = useState(initial);
  return (
    <>
      <button type="button">Outside</button>
      <ReportFilterBar
        filters={filters}
        onChange={(next) => {
          setFilters(next);
          onChange(next);
        }}
        dateControl={<button type="button">This week</button>}
        members={members}
        clients={clients}
        projects={projects}
        tags={tags}
        canViewTeam={canViewTeam}
        currentMemberName="Abdullah"
      />
    </>
  );
}

async function selectCondition(user: ReturnType<typeof userEvent.setup>, condition: string) {
  await user.click(screen.getByRole("button", { name: "Condition" }));
  await user.click(screen.getByRole("option", { name: condition }));
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("report filter bar", () => {
  it("discards drafts on dismissal, applies only on Add, and restores focus on Escape", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const trigger = screen.getByRole("button", { name: "Client" });
    await user.click(trigger);
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.click(screen.getByRole("checkbox", { name: "Acme" }));
    expect(screen.getByRole("button", { name: "Client: is Acme" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Remove Client filter" })).toBeVisible();
    expect(onChange).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(trigger).toHaveFocus();
    await user.click(trigger);
    expect(screen.getByRole("checkbox", { name: "Acme" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "Acme" }));
    await user.click(screen.getByRole("button", { name: "Outside" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await user.click(trigger);
    await user.click(screen.getByRole("checkbox", { name: "Acme" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({ client: { condition: "is", values: ["c1"] } });
    await user.click(screen.getByRole("button", { name: "Client: is Acme" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeEnabled();
    expect(screen.getByRole("checkbox", { name: "Acme" })).toBeChecked();
  });

  it("selects and clears only the visible search/status subset, retaining other selected IDs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Client" }));
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.type(screen.getByRole("textbox", { name: "Filter entities" }), "Acme");
    await user.click(screen.getByRole("button", { name: "None" }));
    await user.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getAllByRole("checkbox")[0]).toHaveAccessibleName("Beta");
    expect(screen.getByRole("button", { name: "Client: is Beta" })).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Beta" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Acme" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "Show" }));
    await user.click(screen.getByRole("option", { name: "Archived" }));
    expect(screen.queryByRole("checkbox", { name: "Beta" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({
      client: { condition: "is", values: ["c2", "c3"] },
    });
  });

  it("navigates nested choices by keyboard and closes the choice before the filter", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Project" }));
    const condition = screen.getByRole("button", { name: "Condition" });
    condition.focus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("option", { name: "is" })).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    expect(condition).toHaveTextContent("is empty");
    await user.click(condition);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Project filter" })).toBeVisible();
    expect(condition).toHaveFocus();
    await user.click(condition);
    await user.click(screen.getByRole("button", { name: "Back to filters" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "Project" }));
    await selectCondition(user, "is empty");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({ project: { condition: "is_empty", values: [] } });
  });

  it("clears project on a client change/removal and narrows projects to selected clients", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Harness initial={{ project: { condition: "is", values: ["p2"] } }} onChange={onChange} />,
    );
    await user.click(screen.getByRole("button", { name: "Client" }));
    await user.click(screen.getByRole("checkbox", { name: "Acme" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({ client: { condition: "is", values: ["c1"] } });
    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(screen.getByRole("checkbox", { name: /Website.*Acme/ })).toBeVisible();
    expect(screen.queryByRole("checkbox", { name: /Brand.*Beta/ })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /Website.*Acme/ }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Remove Client filter" }));
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("locks members to the current member and collapses the whole filter bar with a count including the locked member", async () => {
    const user = userEvent.setup();
    render(<Harness canViewTeam={false} initial={{ tag: { condition: "is", values: ["t1"] } }} />);
    expect(screen.getByTitle("Members can view their own time entries")).toHaveTextContent(
      "Member is Abdullah",
    );
    expect(screen.queryByRole("button", { name: "Member" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(screen.queryByRole("button", { name: "Client" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Tag: is Design" })).not.toBeInTheDocument();
    expect(screen.queryByTitle("Members can view their own time entries")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add filter" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show 2 filters" }));
    expect(screen.getByRole("button", { name: "Client" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    expect(screen.queryByRole("menuitem", { name: "Member" })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Remove Tag filter" }));
    expect(screen.queryByRole("button", { name: "Tag: is Design" })).not.toBeInTheDocument();
  });

  it("applies description criteria and empty descriptions without selecting IDs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Description" }));
    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "Match criteria" }), "planning");
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({
      description: { condition: "contains", values: [], text: "planning" },
    });
    await user.click(screen.getByRole("button", { name: "Description: contains planning" }));
    await selectCondition(user, "is empty");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({
      description: { condition: "is_empty", values: [] },
    });
  });

  it("applies member and tag selections and status conditions without IDs", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Member" }));
    await user.click(screen.getByRole("checkbox", { name: "Abdullah" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Tag" }));
    expect(screen.queryByRole("button", { name: "Show" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "All" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Client" }));
    await selectCondition(user, "is archived");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({
      member: { condition: "is", values: ["m1"] },
      tag: { condition: "is", values: ["t1", "t2"] },
      client: { condition: "is_archived", values: [] },
    });
  });

  it("anchors to reordered draft chips and follows scroll/resize, including filters opened from Add", async () => {
    const user = userEvent.setup();
    vi.stubGlobal("innerWidth", 1280);
    let activeLeft = 580;
    let activeTop = 50;
    vi.spyOn(HTMLButtonElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLButtonElement,
    ) {
      const project = this.getAttribute("aria-label")?.startsWith("Project");
      const active = this.getAttribute("aria-expanded") === "true";
      return new DOMRect(project ? (active ? activeLeft : 788) : 950, activeTop, 130, 36);
    });
    render(<Harness />);
    await user.click(screen.getByRole("button", { name: "Project" }));
    const popup = screen.getByRole("dialog", { name: "Project filter" });
    expect(popup).toHaveStyle({ left: "580px", top: "91px" });
    expect(popup).toHaveClass("dark-surface");
    activeLeft = 1200;
    fireEvent(window, new Event("resize"));
    expect(popup).toHaveStyle({ left: "932px" });
    activeLeft = 40;
    activeTop = 100;
    fireEvent(window, new Event("scroll"));
    expect(popup).toHaveStyle({ left: "40px", top: "141px" });
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByRole("menuitem", { name: "Project" }));
    expect(screen.getByRole("dialog", { name: "Project filter" })).toHaveStyle({
      left: "40px",
      top: "141px",
    });
  });

  it("shows Hide only after applying an explicit filter, even with a locked member", async () => {
    const user = userEvent.setup();
    render(<Harness canViewTeam={false} />);
    expect(screen.queryByRole("button", { name: "Hide filters" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Tag" }));
    expect(screen.queryByRole("button", { name: "Hide filters" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: "Design" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(screen.getByRole("button", { name: "Hide filters" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Hide filters" }));
    expect(screen.getByRole("button", { name: "Show 2 filters" })).toBeVisible();
  });

  it("searches Add filter and applies billable and entry status values", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.type(screen.getByRole("textbox", { name: "Find filter..." }), "bill");
    const menu = screen.getByRole("menu", { name: "Available filters" });
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(1);
    await user.click(screen.getByRole("menuitem", { name: "Billable" }));
    await user.click(screen.getByRole("button", { name: "Match criteria" }));
    await user.click(screen.getByRole("option", { name: "Non-billable" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({ billable: { condition: "is", values: ["false"] } });
    await user.click(screen.getByRole("button", { name: "Add filter" }));
    await user.click(screen.getByRole("menuitem", { name: "Entry status" }));
    await user.click(screen.getByRole("button", { name: "Match criteria" }));
    await user.click(screen.getByRole("option", { name: "Running" }));
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onChange).toHaveBeenLastCalledWith({
      billable: { condition: "is", values: ["false"] },
      running: { condition: "is", values: ["true"] },
    });
  });
});

import { env } from "cloudflare:workers";
import { beforeEach, expect, it } from "vitest";
import { apiRequest, clientId, projectId, seedApiFixture, workspaceId } from "./api-fixture";

beforeEach(seedApiFixture);
const body = {
  version: 1,
  client_id: clientId,
  name: "Updated name",
  color: "#123456",
  billable_default: false,
  currency: "USD",
  visibility: "all",
  member_ids: [],
};
it("can edit a project's metadata while retaining its archived client", async () => {
  await env.DB.prepare("UPDATE clients SET status = 'archived' WHERE id = ?").bind(clientId).run();
  const result = await apiRequest(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  expect(result.status).toBe(200);
  expect(
    await env.DB.prepare("SELECT name, client_id FROM projects WHERE id = ?")
      .bind(projectId)
      .first(),
  ).toMatchObject({ name: "Updated name", client_id: clientId });
});
it("still rejects a new association to an archived client", async () => {
  const archivedId = "00000000-0000-4000-8000-000000000299";
  await env.DB.prepare(
    "INSERT INTO clients (id,workspace_id,name,status,currency,created_at,updated_at) VALUES (?,?,'Archived','archived','USD',0,0)",
  )
    .bind(archivedId, workspaceId)
    .run();
  const result = await apiRequest(`/projects/${projectId}`, {
    method: "PATCH",
    body: JSON.stringify({ ...body, client_id: archivedId }),
  });
  expect(result.status).toBe(422);
  expect(
    await env.DB.prepare("SELECT client_id FROM projects WHERE id = ?").bind(projectId).first(),
  ).toMatchObject({ client_id: clientId });
});

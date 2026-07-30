import { Navigate } from "react-router";

import { useMe } from "@/web/app/context";
import { PageHeader } from "@/web/components/ui";
import { TagSettings } from "@/web/routes/administration";

export function TagsPage() {
  const me = useMe();
  if (!me.permissions.manage_workspace) return <Navigate to="/time" replace />;

  return (
    <>
      <PageHeader
        title="Tags"
        description="Create and maintain reusable labels for classifying time."
      />
      <TagSettings />
    </>
  );
}

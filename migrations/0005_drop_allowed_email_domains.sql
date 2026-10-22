-- Membership is gated by admin provisioning and the Cloudflare Access policy,
-- so a separate allowed-domain list only blocked legitimate invites.
ALTER TABLE workspaces DROP COLUMN allowed_email_domains_json;

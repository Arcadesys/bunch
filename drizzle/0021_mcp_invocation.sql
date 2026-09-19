-- Per-call MCP tool invocation log, used only by the operator-only usage-stats
-- admin tool. Unlike activity_event (mutations only), this logs every tool
-- call, reads included, so invocation counts reflect real usage.
create table mcp_invocation (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null references app_user(id) on delete cascade,
  tool_name text not null,
  is_error boolean not null default false,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);
create index mcp_invocation_tool_created_idx on mcp_invocation(tool_name, created_at);
create index mcp_invocation_owner_created_idx on mcp_invocation(owner_id, created_at);

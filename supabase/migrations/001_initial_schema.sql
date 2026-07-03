-- Enable UUID extension
create extension if not exists "pgcrypto";

-- RFPs table
create table if not exists rfps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references auth.users on delete cascade,
  source      text not null check (source in ('paste', 'email', 'url')),
  raw_text    text not null,
  extracted_keywords jsonb default '[]',
  technologies       jsonb default '[]',
  deadline    text,
  budget_signal text,
  category    text,
  score       numeric(4,3) default 0.5,
  created_at  timestamptz default now()
);

-- Proposals table
create table if not exists proposals (
  id                 uuid primary key default gen_random_uuid(),
  rfp_id             uuid references rfps on delete set null,
  user_id            uuid references auth.users on delete cascade,
  status             text default 'New' check (status in ('New','Drafted','Submitted','Won','Lost')),
  title              text,
  executive_summary  text,
  scope_of_work      text,
  timeline           text,
  budget             jsonb default '[]',
  cover_letter       text,
  follow_up_email    text,
  tone               text default 'professional',
  drive_doc_url      text,
  client_name        text,
  organization       text,
  hourly_rate        numeric(10,2) default 100.00,
  created_at         timestamptz default now(),
  updated_at         timestamptz default now()
);

-- Templates table
create table if not exists templates (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid references auth.users on delete cascade,
  name            text not null,
  tone            text default 'professional',
  prompt_variables jsonb default '{}',
  body            text,
  created_at      timestamptz default now()
);

-- Auto-update updated_at
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger proposals_updated_at
  before update on proposals
  for each row execute function update_updated_at();

-- Row-level security
alter table rfps enable row level security;
alter table proposals enable row level security;
alter table templates enable row level security;

create policy "Users manage own rfps" on rfps
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own proposals" on proposals
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own templates" on templates
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

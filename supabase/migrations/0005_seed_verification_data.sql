-- Scaffold-verification data only -- NOT real canon. These rows exist to
-- prove the Next.js -> Supabase -> RLS chain actually renders something
-- real. Delete once real content starts entering through the Knowledge
-- Core / extraction pipeline (a later implementation pass, out of scope here).

insert into public.characters (slug, name, aliases, dossier_cover, hook_line, classification_status)
values
  ('placeholder-one', 'Placeholder Character One', '{}', 'Dossier cover text goes here once real content is entered.', 'A one-line hook goes here.', 'active'),
  ('placeholder-two', 'Placeholder Character Two', '{}', 'Dossier cover text goes here once real content is entered.', 'A one-line hook goes here.', 'pending');

insert into public.demand_scores (character_id, score, trend_7d, trend_30d)
select id, 0, 0, 0 from public.characters;

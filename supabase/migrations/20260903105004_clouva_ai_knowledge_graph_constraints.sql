-- Global/system procedures use NULL owner/studio by design. Treat those NULLs
-- as equal so a procedure_key has one canonical platform record.
alter table public.ai_knowledge_procedures
  drop constraint if exists ai_knowledge_procedures_procedure_key_owner_user_id_studio_id_key;
alter table public.ai_knowledge_procedures
  add constraint ai_knowledge_procedures_identity_key
  unique nulls not distinct (procedure_key, owner_user_id, studio_id);

-- Complete existing product -> Spot graph edges without touching canonical rows.
insert into public.ai_knowledge_relations (
  source_entity_id, relation_type, target_entity_id, owner_user_id, studio_id,
  source, scope, visibility, status, is_inferred, confidence
)
select product_entity.id, 'belongs_to', spot_entity.id,
       coalesce(cp.owner_user_id, cp.created_by), cp.studio_id,
       'database',
       case when cp.studio_id is null then 'private' else 'studio' end,
       case when cp.studio_id is null then 'private' else 'studio' end,
       'active', false, 1.0
from public.commerce_products cp
join public.ai_knowledge_entities product_entity
  on product_entity.canonical_source_table='commerce_products'
 and product_entity.canonical_source_id=cp.id::text
join public.ai_knowledge_entities spot_entity
  on spot_entity.canonical_source_table='commerce_spots'
 and spot_entity.canonical_source_id=cp.spot_id::text
where cp.spot_id is not null
on conflict (source_entity_id, relation_type, target_entity_id, source)
do update set status='active', updated_at=now();

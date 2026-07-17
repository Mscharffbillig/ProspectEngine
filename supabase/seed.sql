-- Seed: qualification rules (editable in-place later; no schema change needed)
insert into qualification_rules (rule_key, label, points, definition) values
  ('identifiable_decision_maker', 'Identifiable owner or operations manager', 10, '{"signal": "identifiable_decision_maker"}'),
  ('multiple_crews',              'Multiple employees or crews',               15, '{"signal": "multiple_crews"}'),
  ('multiple_service_areas',      'Multiple service areas or locations',       10, '{"signal": "multiple_service_areas"}'),
  ('commercial_or_recurring',     'Commercial or recurring work',              10, '{"signal": "commercial_or_recurring"}'),
  ('manual_forms',                'Visible manual forms or disconnected processes', 10, '{"signal": "manual_forms"}'),
  ('hiring_coordination',         'Hiring office, dispatch, or coordination staff', 10, '{"signal": "hiring_coordination"}'),
  ('public_contact',              'Public contact method found',               10, '{"signal": "public_contact"}'),
  ('independent_business',        'Independent business',                      10, '{"signal": "independent_business"}'),
  ('equipment_heavy',             'Equipment-heavy or coordination-heavy operation', 5, '{"signal": "equipment_heavy"}'),
  ('national_or_franchise',       'National company or franchise',            -25, '{"signal": "national_or_franchise"}'),
  ('solo_operator',               'Likely solo operator',                     -15, '{"signal": "solo_operator"}'),
  ('no_web_presence',             'No meaningful web presence',                -5, '{"signal": "no_web_presence"}'),
  ('sophisticated_software',      'Clearly sophisticated integrated software operation', -10, '{"signal": "sophisticated_software"}');

-- Seed: example campaign
with c as (
  insert into campaigns (
    name, description, min_company_size, max_company_size,
    include_keywords, exclude_keywords,
    preferred_characteristics, excluded_characteristics,
    workflow_problems, geography,
    max_candidates_per_run, min_qualification_score, ai_enabled, status
  ) values (
    'Minnesota Trade Businesses',
    'Independent trade and service businesses in Minnesota and western Wisconsin that likely coordinate crews, equipment, and customers with manual processes.',
    5, 50,
    array['multiple crews', 'commercial', 'service area', 'independently owned'],
    array['national', 'franchise', 'solo operator'],
    array['Multiple crews', 'Commercial work', 'Multiple service areas', 'Independently owned'],
    array['National companies', 'Franchises', 'Solo operators'],
    array['Dispatch and scheduling', 'Estimate follow-up', 'Jobsite documentation',
          'Equipment tracking', 'Employee time collection', 'Customer communication',
          'Repetitive data entry'],
    'Minnesota and western Wisconsin',
    50, 30, false, 'active'
  ) returning id
)
insert into campaign_industries (campaign_id, industry)
select id, unnest(array['Excavation', 'HVAC', 'Plumbing', 'Landscaping',
  'Restoration', 'Commercial cleaning', 'Equipment repair', 'Small manufacturing'])
from c;

insert into campaign_locations (campaign_id, location)
select id, unnest(array['Minnesota', 'Western Wisconsin'])
from campaigns where name = 'Minnesota Trade Businesses';

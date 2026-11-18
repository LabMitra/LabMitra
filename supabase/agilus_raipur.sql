-- =====================================================================================
-- Agilus Diagnostics: 26 popular tests (Raipur prices from agilusdiagnostics.com/health-checkup/raipur, 18 Nov 2026).
-- Run once in Supabase > SQL Editor, AFTER labs_v2.sql.  Safe to re-run (already-added tests are skipped).
-- LabMitra price rule: website price ending in 0 -> minus Rs 1 (350 -> 349); anything else stays the same (1999 -> 1999).
-- 23 tests are matched to the same test already on the site, so patients get a Hypatho / Agilus choice.
-- 3 tests are new (Vitamin D + B12, CBC with PS & ESR, Fever Panel Comprehensive).
-- =====================================================================================

-- New tests only Agilus offers (for now).
insert into tests(name,category,sample,price,mrp,turnaround,instructions,active,trending,import_key) values
 ('Vitamin D + B12 (Vitamin Plus)','Vitamins & Minerals','Blood',1819,null,'24 hours',null,true,false,'agilus:vitamin-plus'),
 ('CBC with Peripheral Smear & ESR','Blood count & Clotting','Blood',419,null,'24 hours',null,true,false,'agilus:cbc-ps-esr'),
 ('Fever Panel Comprehensive','Fever (Dengue, Malaria, Typhoid)','Blood',1999,null,'24 hours',null,true,false,'agilus:fever-panel')
on conflict (import_key) do nothing;

create temp table if not exists _ag(test_key text primary key,lab_name text,web int);
truncate _ag;
insert into _ag values
 ('hypatho:196','CBC (Complete Blood Count)',350),
 ('hypatho:281','HbA1c (Glycosylated Hemoglobin)',440),
 ('hypatho:367','KFT (Kidney Function Test)',850),
 ('hypatho:143','C-Reactive Protein (CRP) Quantitative',440),
 ('hypatho:521','Thyroid Profile Total (T3, T4, TSH)',550),
 ('hypatho:5','Vitamin D (25 Hydroxy)',1550),
 ('hypatho:210','Dengue NS1 Antigen Test',600),
 ('agilus:vitamin-plus','Vitamin Plus (Vitamin D + B12)',1820),
 ('hypatho:169','Creatinine',150),
 ('hypatho:482','Electrolytes (Na/K/Cl)',400),
 ('hypatho:571','Routine Urine Examination/Urinalysis',120),
 ('hypatho:380','LFT (Liver Function Test)',800),
 ('hypatho:567','Urine C/S (Urine Culture Test)',850),
 ('hypatho:551','TSH Ultrasensitive Test',350),
 ('hypatho:254','Free Thyroid Panel (FT3, FT4, TSH)',900),
 ('agilus:cbc-ps-esr','CBC with PS and ESR',420),
 ('hypatho:312','Hb Variant Analysis',1040),
 ('hypatho:43','ANA (Antinuclear Antibodies), IFA Method',900),
 ('hypatho:389','Lipid Profile Test',1000),
 ('hypatho:89','Anti-CCP Antibody (Rheumatoid Arthritis)',1900),
 ('hypatho:93','Anti-Mullerian Hormone (AMH)',2150),
 ('hypatho:537','Total IgE',900),
 ('hypatho:425','Non Invasive Prenatal Screening',16500),
 ('agilus:fever-panel','Fever Panel Comprehensive',1999),
 ('hypatho:222','Double Marker FMF Certified',2750),
 ('hypatho:467','Quadruple Marker (Second Trimester Screening) FMF Certified',3600);

insert into lab_tests(lab_id,test_id,lab_name,website_price,price,turnaround)
  select l.id,t.id,a.lab_name,a.web,case when a.web%10=0 and a.web>0 then a.web-1 else a.web end,null  -- report time: fill in Admin > Labs
  from _ag a join tests t on t.import_key=a.test_key cross join (select id from labs where name='Agilus Diagnostics') l
on conflict (lab_id,test_id) do nothing;
drop table _ag;

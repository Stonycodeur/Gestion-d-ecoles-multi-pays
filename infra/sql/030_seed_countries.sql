-- Reference data only: no national rule lives in code. Adding a country = inserting rows.
-- Gabon = pilot (spec 1.1). CI and XL are examples proving config-only onboarding. To be validated in phase 0 with ministries.
INSERT INTO countries (code,name_fr,name_en,languages,default_locale,currency,timezone,payment_providers,legal_framework,document_templates,ministry_connectors,is_sample) VALUES
('GA','Gabon','Gabon','{fr,en}','fr','XAF','Africa/Libreville',
 '[{"code":"airtel_money","label":"Airtel Money","kind":"mobile_money"},{"code":"moov_money","label":"Moov Money","kind":"mobile_money"},{"code":"stripe","label":"Carte (Stripe)","kind":"card"},{"code":"bank_transfer","kind":"transfer"},{"code":"cash","kind":"cash"},{"code":"cheque","kind":"cheque"}]',
 '{"data_protection_law":"Loi n°001/2011 modifiée par la loi n°025/2023","authority":"APDPVP","gps_retention_days":30,"minor_age":18,"reference":"RGPD"}',
 '{"report_card":"ga_bulletin_v1","transcript":"ga_releve_v1","certificate":"ga_attestation_v1"}',
 '[{"code":"men","label_fr":"Ministère de l''Éducation nationale","mode":"file","formats":["csv","json"],"datasets":["effectifs","resultats_CEP","resultats_BEPC","resultats_BAC","statistiques_rentree"],"sandbox":true},
   {"code":"mesr","label_fr":"Ministère de l''Enseignement supérieur","mode":"file","formats":["csv","xml"],"datasets":["effectifs","statistiques_rentree"],"sandbox":true}]',
 FALSE),
('CI','Côte d''Ivoire (exemple)','Côte d''Ivoire (sample)','{fr}','fr','XOF','Africa/Abidjan',
 '[{"code":"orange_money","label":"Orange Money","kind":"mobile_money"},{"code":"mtn_momo","label":"MTN MoMo","kind":"mobile_money"},{"code":"wave","label":"Wave","kind":"mobile_money"},{"code":"stripe","kind":"card"}]',
 '{"data_protection_law":"À valider (loi nationale)","authority":"À valider","gps_retention_days":30,"minor_age":18,"reference":"RGPD"}',
 '{}','[]',TRUE),
('XL','Pays exemple (lettres)','Sample country (letters)','{en,fr}','en','USD','UTC',
 '[{"code":"stripe","kind":"card"},{"code":"bank_transfer","kind":"transfer"}]',
 '{"data_protection_law":"Exemple","authority":"Exemple","gps_retention_days":30,"minor_age":18,"reference":"RGPD"}',
 '{}','[]',TRUE);

-- Scales. Bands are on the normalized 0-100 base; colors follow the default 81/61/41/21 rule.
INSERT INTO grading_scales (country_code,code,type,min_value,max_value,step,decimals,pass_mark,rounding,bands,display_format) VALUES
('GA','num10',   'numeric',0,10,0.5, 1,5, 'tenth','[{"label":"Insuffisant","min":0,"max":49,"color":"orange","mention":"Insuffisant"},{"label":"Passable","min":50,"max":64,"color":"yellow","mention":"Passable"},{"label":"Bien","min":65,"max":79,"color":"blue","mention":"Bien"},{"label":"Très bien","min":80,"max":100,"color":"green","mention":"Très bien"}]','{value}/{max}'),
('GA','num20',   'numeric',0,20,0.25,1,10,'tenth','[{"label":"Insuffisant","min":0,"max":49,"color":"orange"},{"label":"Passable","min":50,"max":64,"color":"yellow"},{"label":"Assez bien","min":65,"max":74,"color":"blue"},{"label":"Bien","min":75,"max":84,"color":"blue"},{"label":"Très bien","min":85,"max":100,"color":"green"}]','{value}/{max}'),
('GA','num20_lmd','numeric',0,20,0.25,2,10,'none','[{"label":"Ajourné","min":0,"max":49,"color":"red","mention":"Ajourné"},{"label":"Passable","min":50,"max":59,"color":"yellow","mention":"Passable"},{"label":"Assez bien","min":60,"max":69,"color":"blue","mention":"Assez bien"},{"label":"Bien","min":70,"max":79,"color":"blue","mention":"Bien"},{"label":"Très bien","min":80,"max":100,"color":"green","mention":"Très bien"}]','{value}/{max}'),
('CI','num20',   'numeric',0,20,0.25,1,10,'tenth','[]','{value}/{max}'),
('XL','letters', 'letter', 0,100,1,0,41,'integer','[
 {"label":"A+","min":96,"max":100,"color":"green"},{"label":"A","min":86,"max":95,"color":"green"},{"label":"A-","min":81,"max":85,"color":"green"},
 {"label":"B+","min":76,"max":80,"color":"blue"},{"label":"B","min":66,"max":75,"color":"blue"},{"label":"B-","min":61,"max":65,"color":"blue"},
 {"label":"C+","min":56,"max":60,"color":"yellow"},{"label":"C","min":46,"max":55,"color":"yellow"},{"label":"C-","min":41,"max":45,"color":"yellow"},
 {"label":"D+","min":36,"max":40,"color":"orange"},{"label":"D","min":26,"max":35,"color":"orange"},{"label":"D-","min":21,"max":25,"color":"orange"},
 {"label":"E+","min":16,"max":20,"color":"red"},{"label":"E","min":6,"max":15,"color":"red"},{"label":"E-","min":1,"max":5,"color":"red"}]','{label}'),
('XL','num100', 'numeric',0,100,1,0,50,'integer','[]','{value}/{max}');

INSERT INTO education_systems (country_code,cycle,label_fr,label_en,levels,national_exam,grading_scale_code,period_type,school_type) VALUES
('GA','primary','Primaire','Primary','["CP1","CP2","CE1","CE2","CM1","CM2"]','{"code":"CEP","label_fr":"Certificat d''études primaires","label_en":"Primary studies certificate"}','num10','trimester','primary'),
('GA','lower_secondary','Collège','Lower secondary','["6e","5e","4e","3e"]','{"code":"BEPC","label_fr":"Brevet d''études du premier cycle","label_en":"Lower secondary certificate"}','num20','trimester','college'),
('GA','upper_secondary','Lycée','Upper secondary','["2nde","1ere","Terminale"]','{"code":"BAC","label_fr":"Baccalauréat","label_en":"Baccalaureate"}','num20','trimester','lycee'),
('GA','higher','Supérieur (LMD)','Higher education (LMD)','["L1","L2","L3","M1","M2","D"]','{"code":"LMD","label_fr":"Diplômes LMD","label_en":"LMD degrees"}','num20_lmd','semester','university'),
('CI','primary','Primaire','Primary','["CP1","CP2","CE1","CE2","CM1","CM2"]','{"code":"CEPE","label_fr":"Certificat d''études primaires élémentaires (à valider)"}','num20','trimester','primary'),
('CI','lower_secondary','Collège','Lower secondary','["6e","5e","4e","3e"]','{"code":"BEPC","label_fr":"BEPC (à valider)"}','num20','trimester','college'),
('CI','upper_secondary','Lycée','Upper secondary','["2nde","1ere","Terminale"]','{"code":"BAC","label_fr":"Baccalauréat (à valider)"}','num20','trimester','lycee'),
('XL','primary','Primary','Primary','["G1","G2","G3","G4","G5","G6"]',NULL,'letters','semester','primary'),
('XL','upper_secondary','Secondary','Secondary','["G7","G8","G9","G10","G11","G12"]',NULL,'letters','semester','lycee');

INSERT INTO academic_calendars (country_code,label,periods) VALUES
('GA','trimestres','[{"code":"T1","start_month":10,"end_month":12},{"code":"T2","start_month":1,"end_month":3},{"code":"T3","start_month":4,"end_month":6}]'),
('CI','trimestres','[{"code":"T1","start_month":9,"end_month":12},{"code":"T2","start_month":1,"end_month":3},{"code":"T3","start_month":4,"end_month":6}]'),
('XL','semestres','[{"code":"S1","start_month":9,"end_month":1},{"code":"S2","start_month":2,"end_month":6}]');

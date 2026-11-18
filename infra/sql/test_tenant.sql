\set ON_ERROR_STOP on
INSERT INTO tenants(id,slug,name,school_type,country_code,schema_name) VALUES
 ('cccccccc-0000-0000-0000-00000000000a','ped_a','A','lycee','GA','tenant_ped_a'),
 ('cccccccc-0000-0000-0000-00000000000b','ped_b','B','lycee','GA','tenant_ped_b');
SELECT provision_tenant_schema('ped_a') \gset
SELECT provision_tenant_schema('ped_b') \gset
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA tenant_ped_a, tenant_ped_b TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA tenant_ped_a, tenant_ped_b TO app_user;
SET ROLE app_user;
SET app.tenant_id = 'cccccccc-0000-0000-0000-00000000000a';
-- tenant_id is filled automatically from the session
INSERT INTO tenant_ped_a.classes(name, level_code, school_year) VALUES ('2nde A','2nde','2026-2027');
INSERT INTO tenant_ped_a.subjects(code,name,coefficient) VALUES ('MATH','Mathématiques',4);
INSERT INTO tenant_ped_a.teachers(first_name,last_name) VALUES ('Jean','Mba');
INSERT INTO tenant_ped_a.rooms(name) VALUES ('S1');
INSERT INTO tenant_ped_a.schedules(school_year) VALUES ('2026-2027');
INSERT INTO tenant_ped_a.schedule_slots(schedule_id,class_id,subject_id,teacher_id,room_id,weekday,period_index)
 SELECT sc.id, c.id, su.id, t.id, r.id, 1, 0 FROM tenant_ped_a.schedules sc, tenant_ped_a.classes c, tenant_ped_a.subjects su, tenant_ped_a.teachers t, tenant_ped_a.rooms r;
SELECT 'A slots (expect 1)' t, count(*) FROM tenant_ped_a.schedule_slots;
\set ON_ERROR_STOP off
\echo '== must be refused - teacher double booking (unique index) =='
INSERT INTO tenant_ped_a.classes(name, level_code, school_year) VALUES ('2nde B','2nde','2026-2027');
INSERT INTO tenant_ped_a.schedule_slots(schedule_id,class_id,subject_id,teacher_id,room_id,weekday,period_index)
 SELECT sc.id, (SELECT id FROM tenant_ped_a.classes WHERE name='2nde B'), su.id, t.id, NULL, 1, 0 FROM tenant_ped_a.schedules sc, tenant_ped_a.subjects su, tenant_ped_a.teachers t;
\echo '== must be refused - grade outside 0-100 =='
INSERT INTO tenant_ped_a.students(first_name,last_name) VALUES ('Ada','Obiang');
INSERT INTO tenant_ped_a.evaluations(class_id,subject_id,period_code,title,scale_snapshot)
 SELECT c.id, su.id, 'T1', 'DS1', '{"code":"num20"}' FROM tenant_ped_a.classes c, tenant_ped_a.subjects su WHERE c.name='2nde A';
INSERT INTO tenant_ped_a.grades(evaluation_id,student_id,raw_value,normalized) SELECT e.id, s.id, '21', 105 FROM tenant_ped_a.evaluations e, tenant_ped_a.students s;
\echo '== must be refused - row for another tenant =='
INSERT INTO tenant_ped_a.students(tenant_id,first_name,last_name) VALUES ('cccccccc-0000-0000-0000-00000000000b','Evil','X');
\echo '== tenant B sees nothing of A =='
\set ON_ERROR_STOP on
SET app.tenant_id = 'cccccccc-0000-0000-0000-00000000000b';
SELECT 'B sees A students (expect 0)' t, count(*) FROM tenant_ped_a.students;
SELECT 'B sees A slots (expect 0)' t, count(*) FROM tenant_ped_a.schedule_slots;
SELECT 'B sees A grades (expect 0)' t, count(*) FROM tenant_ped_a.grades;
RESET ROLE;

\set ON_ERROR_STOP off
\echo '== immutability tests (each must ERROR) =='
INSERT INTO users (id,email,password_hash,is_root,is_immutable) VALUES ('00000000-0000-0000-0000-000000000001','root@x.test','h',TRUE,TRUE);
INSERT INTO user_roles SELECT '00000000-0000-0000-0000-000000000001', id, NULL FROM roles WHERE code='root_super_admin';
UPDATE users SET email='evil@x.test' WHERE is_root;
UPDATE users SET password_hash='evil' WHERE is_root;
UPDATE users SET is_root=FALSE WHERE is_root;
UPDATE users SET tenant_id=gen_random_uuid() WHERE is_root;
DELETE FROM users WHERE is_root;
DELETE FROM user_roles WHERE user_id='00000000-0000-0000-0000-000000000001';
INSERT INTO users (email,password_hash,is_root) VALUES ('second@x.test','h',TRUE);
INSERT INTO permissions(code) VALUES ('x:y');
INSERT INTO role_permissions SELECT r.id, p.id FROM roles r, permissions p WHERE r.code='root_super_admin';
INSERT INTO audit_logs(action) VALUES ('t');
UPDATE audit_logs SET action='x';
DELETE FROM audit_logs;
TRUNCATE audit_logs;
\echo '== must SUCCEED: updating a non-sensitive column of root =='
UPDATE users SET created_at=created_at WHERE is_root;
\echo '== tenant isolation =='
\set ON_ERROR_STOP on
INSERT INTO tenants(id,slug,name,school_type,country_code,schema_name) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','lyc_a','Lycée A','lycee','GA','tenant_lyc_a'),
 ('bbbbbbbb-0000-0000-0000-000000000002','lyc_b','Lycée B','lycee','GA','tenant_lyc_b');
SELECT provision_tenant_schema('lyc_a');
SELECT provision_tenant_schema('lyc_b');
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='app_user') THEN CREATE ROLE app_user NOLOGIN; END IF; END $$;
GRANT USAGE ON SCHEMA tenant_lyc_a, tenant_lyc_b TO app_user;
GRANT ALL ON ALL TABLES IN SCHEMA tenant_lyc_a, tenant_lyc_b TO app_user;
SET ROLE app_user;
SET app.tenant_id = 'aaaaaaaa-0000-0000-0000-000000000001';
INSERT INTO tenant_lyc_a.students(tenant_id,first_name,last_name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Ada','A');
SELECT 'A sees own rows' AS t, count(*) FROM tenant_lyc_a.students;
SET app.tenant_id = 'bbbbbbbb-0000-0000-0000-000000000002';
SELECT 'B sees A rows (expect 0)' AS t, count(*) FROM tenant_lyc_a.students;
\set ON_ERROR_STOP off
INSERT INTO tenant_lyc_a.students(tenant_id,first_name,last_name) VALUES ('aaaaaaaa-0000-0000-0000-000000000001','Evil','B');
RESET app.tenant_id;
SELECT 'no tenant set (expect 0)' AS t, count(*) FROM tenant_lyc_a.students;
SET app.root_bypass='on';
SELECT 'root bypass sees (expect 1)' AS t, count(*) FROM tenant_lyc_a.students;
RESET ROLE;
\echo '== config-only country onboarding =='
SELECT c.code, s.code AS scale, s.type FROM countries c JOIN education_systems e ON e.country_code=c.code JOIN grading_scales s ON s.country_code=e.country_code AND s.code=e.grading_scale_code ORDER BY 1,2;

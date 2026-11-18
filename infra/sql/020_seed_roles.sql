INSERT INTO roles (code, label_fr, label_en, scope) VALUES
 ('root_super_admin','Super-Admin racine','Root Super-Admin','global'),
 ('tenant_super_admin','Super-Admin d''établissement','School Super-Admin','tenant'),
 ('admin','Admin','Admin','tenant'),
 ('head','Directeur / Proviseur / Doyen','Head / Principal / Dean','tenant'),
 ('teacher','Professeur','Teacher','tenant'),
 ('education_assistant','Assistant d''éducation','Education assistant','tenant'),
 ('accountant','Comptable / Intendance','Accountant / Bursar','tenant'),
 ('student','Élève / Étudiant','Student','tenant'),
 ('guardian','Parent / Tuteur','Parent / Guardian','tenant'),
 ('visitor','Visiteur','Visitor','none');

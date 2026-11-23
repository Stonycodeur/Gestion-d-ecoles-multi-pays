# User guide by role (English)

ÉcoleManager Pro runs on the web (browser, installable as an app) and on mobile (Android and iOS). The screens you see depend on your role and on the modules your school has enabled: a disabled module has no screen.

## Getting started (all roles)
1. **Sign in**: open the app, enter your school code if asked, then sign in on the school's authentication page (two-factor authentication may be required).
2. **Language and theme**: French, English or Arabic (right-to-left supported); light or dark theme.
3. **Notifications**: allow them to receive absences, grades, timetable changes, messages and payments. You can decline and read the list in the Notifications screen.
4. **Offline**: timetable, grades, lesson log, absences, messages and resources stay readable without a network. What you enter is queued and sent when you are back online. Only online payments need a connection.
5. **Delete my account**: Account screen, "Delete my account" (required by the stores). The root super-admin account cannot be deleted.

## Student
- **Timetable**: day, week and month views. Teacher substitutions appear with a notification.
- **Grades and report cards**: shown in your school's scale (out of 10, 20, 100 or letters), with colour and mention. Older grades keep their original scale.
- **Lesson log**: homework, lessons, documents; interactive homework (quizzes) to submit online.
- **Absences**: see your absences and late arrivals; justify them online (the head or an education assistant validates).
- **OAA**: your overall score on four axes (academic, physical, adaptability, social contribution) and its history. Warnings appear below 50% of the scale maximum.
- **Games and challenges**: XP, levels (Novice, Learner, Expert, Master), badges, challenges, teams, gamified exams.
- **Learning assistant**: tutoring adapted to your age; your data is pseudonymised before it reaches the model.
- **Location (GPS)**: only if you and your parent consent; you can revoke consent and set a time window.
- **Guidance, internships, resources, forums, news, digital locker, 3D/AR visit.**

## Parent / Guardian
- You only see **your children**: timetable, lesson log, grades, absences, OAA, locker.
- **Justify an absence** online, with an attachment.
- **Pay tuition**: Mobile Money (Airtel Money, Moov Money), card, bank transfer; instalments, PDF receipt. On mobile this is a real service payment (not an in-app purchase).
- **GPS tracking**: give or withdraw consent; live map, geofences, history, arrival, departure and out-of-zone alerts. Positions are purged after 30 days (configurable by the school); every access is logged.
- **Messaging**: you can write to your children's teachers and to the administration (the "who can write to whom" rules apply).

## Teacher
- **Timetable**: your classes and substitutions.
- **Lesson log**: rich content, homework, progress, tests, attachments, quizzes; the head adds a visa.
- **Grades**: create an evaluation (the active scale is frozen at creation), enter grades within the scale's min, max, step and format (for example 0 to 20 by 0.25, or a letter); configurable coefficients. Offline, your grade entries take priority when syncing.
- **Absences**: roll call per session.
- **OAA and predictive AI**: your own classes only; the AI is decision support, never an automatic decision, and uses no payment data.
- **Generative AI**: course summaries, quizzes, exercises, FR/EN translation, marking help. Nothing is saved without your validation.
- **Educational games and gamified exams**: build quizzes, challenges and tests.
- **Resources, forums, 3D/AR content** attached to your lessons.

## Head of school (Director, Principal, Dean)
- **Timetable**: validate then publish the proposed version; room, teacher and class conflicts are detected.
- **Lesson log**: add the visa; create **time-limited inspector access**.
- **Report cards**: PDF with the school's logo and header, archiving.
- **Absences**: validate justifications; statistics and threshold alerts.
- **OAA, predictive AI**: dashboards, explanatory factors, support suggestions; ranking can be switched off.
- **Ministries**: validate transmissions prepared by the administration (enrolment, results), follow the exchange log and resend.
- **Messaging**: access to all threads according to the rules.

## School administrator (school Super-Admin, Admin)
See also the administration manual (`docs/ADMIN_MANUAL.md`).
- **Students and staff**: enrolment, class assignment, statuses; contracts, workload and overload alerts.
- **Timetable**: automatic constraint-based generation, drag and drop (web), **teacher substitution** (the substitute must be free; families and teachers are notified).
- **Grading scales**: choose among the country's scales, colours, effective date; a change only affects new evaluations.
- **Modules**: enable or disable per school; install marketplace modules after reading the permissions they ask for.
- **Payments**: fee plans, invoices, discounts, reminders, reconciliation, collection statistics.
- **Visitor area**: showcase site, online enrolment requests, public news, 360° virtual visit.
- **Public API**: OAuth2 clients, quotas, signed webhooks.
- **Audit log**: review the school's actions.

## Accountant / Bursar
- Invoicing, instalments, collections (cash with QR, cheque, transfer, Mobile Money, card), receipts, reminders, reconciliation, collection statistics. No access to grades or teaching data.

## Education assistant
- Absence roll call, validation of justifications, timetable and lesson log, messaging according to the rules.

## Visitor (no sign-in)
- School website, public news, contact, public statistics, 360° virtual visit, online enrolment.

## Help
For sign-in or access problems, contact your school's administration. For privacy and your data rights (Gabonese law no. 001/2011 as amended by law no. 025/2023), see the "Privacy policy" page of the public area.

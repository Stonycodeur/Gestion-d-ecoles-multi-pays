import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/session.dart';
import '../core/timetable.dart';
import 'pedagogy_screens.dart';

Future<dynamic> _get(WidgetRef ref, String path) async {
  final s = ref.read(sessionProvider);
  final r = await ref.read(apiProvider).getJson(s.school!, s.token!, path, ref.read(cacheProvider));
  return r.data;
}

const _staffWide = {'admin', 'head', 'tenant_super_admin', 'education_assistant', 'root_super_admin'};

/// Who is signed in and which students / classes they can pick, resolved once per screen.
class _Who {
  final List<String> roles;
  final Map<String, dynamic> abilities;
  final List<Map<String, dynamic>> students, classes;
  _Who(this.roles, this.abilities, this.students, this.classes);
  bool get staffWide => roles.any(_staffWide.contains);
  bool get teacher => roles.contains('teacher') && !staffWide;
  String studentName(Map<String, dynamic> s) => '${s['first_name']} ${s['last_name']}';
}

Future<_Who> _loadWho(WidgetRef ref) async {
  final ab = (await _get(ref, '/me/abilities') as Map).cast<String, dynamic>();
  final students = ((await _get(ref, '/me/students')) as List).cast<Map<String, dynamic>>();
  var classes = <Map<String, dynamic>>[];
  try {
    classes = ((await _get(ref, '/classes')) as List).cast<Map<String, dynamic>>();
  } catch (_) {
    // roles without access to the class list: class ids are shown instead
  }
  return _Who((ab['roles'] as List).cast<String>(), ab, students, classes);
}

String _className(_Who w, String? id) {
  for (final c in w.classes) {
    if (c['id'] == id) return c['name'] as String;
  }
  return id == null ? '-' : id.substring(0, 8);
}

Widget _offlineBanner(bool fromCache) => fromCache ? const MaterialBanner(content: Text('Hors ligne / Offline'), actions: [SizedBox()]) : const SizedBox.shrink();

// ---------------------------------------------------------------------------------------------------------------------
class TimetableScreen extends ConsumerStatefulWidget {
  const TimetableScreen({super.key});
  @override
  ConsumerState<TimetableScreen> createState() => _TimetableState();
}

class _TimetableState extends ConsumerState<TimetableScreen> {
  late final Future<_Who> _who = _loadWho(ref);
  String? _choice; // student id or class id

  @override
  Widget build(BuildContext context) {
    final en = Localizations.localeOf(context).languageCode == 'en';
    final days = en ? const ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] : const ['', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    return Scaffold(
      appBar: AppBar(title: Text(en ? 'Timetable' : 'Emploi du temps')),
      body: FutureBuilder<_Who>(
        future: _who,
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final w = snap.data!;
          final options = w.staffWide ? w.classes.map((x) => (x['id'] as String, x['name'] as String)).toList() : w.teacher ? <(String, String)>[] : w.students.map((x) => (x['id'] as String, w.studentName(x))).toList();
          final query = w.teacher ? '/timetable?mine=1' : (_choice ?? (options.isNotEmpty ? options.first.$1 : null)) == null ? null : w.staffWide ? '/timetable?class_id=${_choice ?? options.first.$1}' : '/timetable?student_id=${_choice ?? options.first.$1}';
          return Column(children: [
            if (options.length > 1)
              Padding(
                padding: const EdgeInsets.all(8),
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: _choice ?? options.first.$1,
                  items: [for (final o in options) DropdownMenuItem(value: o.$1, child: Text(o.$2))],
                  onChanged: (v) => setState(() => _choice = v),
                ),
              ),
            Expanded(child: query == null ? Center(child: Text(en ? 'No student' : 'Aucun élève')) : _TimetableBody(key: ValueKey(query), path: query, days: days, en: en)),
          ]);
        },
      ),
    );
  }
}

class _TimetableBody extends ConsumerWidget {
  final String path;
  final List<String> days;
  final bool en;
  const _TimetableBody({super.key, required this.path, required this.days, required this.en});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return FutureBuilder(
      future: ref.read(apiProvider).getJson(s.school!, s.token!, path, ref.read(cacheProvider)),
      builder: (c, snap) {
        if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
        if (snap.hasError) return Center(child: Text('${snap.error}'));
        final data = (snap.data!.data as Map).cast<String, dynamic>();
        final slots = (data['slots'] as List?) ?? const [];
        if (data['schedule'] == null || slots.isEmpty) return Center(child: Text(en ? 'No published timetable yet' : 'Aucun emploi du temps publié'));
        final subs = nextSubstitutionBySlot((data['substitutions'] as List?) ?? const []);
        final grouped = groupByDay(slots);
        return Column(children: [
          _offlineBanner(snap.data!.fromCache),
          Expanded(
            child: ListView(children: [
              for (final e in grouped.entries) ...[
                Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text(days[e.key], style: Theme.of(context).textTheme.titleMedium)),
                for (final sl in e.value)
                  ListTile(
                    dense: true,
                    leading: Text(periodLabel((sl['period_index'] as num).toInt())),
                    title: Text('${sl['subject_name']} · ${sl['class_name']}'),
                    subtitle: Text([sl['teacher_name'], sl['room']].where((x) => x != null).join(' · ')),
                    trailing: subs[sl['id']] == null
                        ? null
                        : Tooltip(
                            message: '${subs[sl['id']]!['on_date']}',
                            child: Chip(label: Text('${en ? 'Replaced' : 'Remplacé'}: ${subs[sl['id']]!['substitute_name']}', style: const TextStyle(fontSize: 11))),
                          ),
                  ),
              ],
            ]),
          ),
        ]);
      },
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
class GradesScreen extends ConsumerStatefulWidget {
  const GradesScreen({super.key});
  @override
  ConsumerState<GradesScreen> createState() => _GradesState();
}

class _GradesState extends ConsumerState<GradesScreen> {
  late final Future<_Who> _who = _loadWho(ref);
  late final Future<List<String>> _periods = _loadPeriods();
  String? _student, _period;

  Future<List<String>> _loadPeriods() async {
    try {
      final c = (await _get(ref, '/settings/country') as Map).cast<String, dynamic>();
      return periodCodes((c['education_system'] as Map?)?['period_type'] as String?);
    } catch (_) {
      return periodCodes(null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final en = Localizations.localeOf(context).languageCode == 'en';
    return Scaffold(
      appBar: AppBar(title: Text(en ? 'Grades' : 'Notes')),
      body: FutureBuilder<List<dynamic>>(
        future: Future.wait<dynamic>([_who, _periods]),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final w = snap.data![0] as _Who;
          final periods = snap.data![1] as List<String>;
          final period = _period ?? periods.first;
          final sid = _student ?? (w.students.isNotEmpty ? w.students.first['id'] as String : null);
          return ListView(children: [
            Padding(
              padding: const EdgeInsets.all(8),
              child: Row(children: [
                Expanded(
                  child: DropdownButton<String>(
                    isExpanded: true,
                    hint: Text(en ? 'Student' : 'Élève'),
                    value: sid,
                    items: [for (final s in w.students) DropdownMenuItem(value: s['id'] as String, child: Text(w.studentName(s)))],
                    onChanged: (v) => setState(() => _student = v),
                  ),
                ),
                const SizedBox(width: 8),
                DropdownButton<String>(value: period, items: [for (final p in periods) DropdownMenuItem(value: p, child: Text(p))], onChanged: (v) => setState(() => _period = v)),
              ]),
            ),
            if (sid != null) _ReportView(key: ValueKey('$sid|$period'), studentId: sid, period: period, en: en),
            if (w.abilities['grades_write'] == true)
              Padding(
                padding: const EdgeInsets.all(8),
                child: FilledButton.icon(
                  icon: const Icon(Icons.edit),
                  label: Text(en ? 'Enter grades' : 'Saisir des notes'),
                  onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => GradeEntryScreen(period: period))),
                ),
              ),
          ]);
        },
      ),
    );
  }
}

class _ReportView extends ConsumerWidget {
  final String studentId, period;
  final bool en;
  const _ReportView({super.key, required this.studentId, required this.period, required this.en});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return FutureBuilder(
      future: ref.read(apiProvider).getJson(s.school!, s.token!, '/students/$studentId/report?period=$period&locale=${en ? 'en' : 'fr'}', ref.read(cacheProvider)),
      builder: (c, snap) {
        if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
        if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: Text('${snap.error}'));
        final d = (snap.data!.data as Map).cast<String, dynamic>();
        final lines = (d['lines'] as List).cast<Map<String, dynamic>>();
        final g = d['general'] as Map?;
        return Column(children: [
          _offlineBanner(snap.data!.fromCache),
          if (lines.isEmpty) Padding(padding: const EdgeInsets.all(16), child: Text(en ? 'No grades for this period' : 'Aucune note pour cette période')),
          for (final l in lines)
            ListTile(
              title: Text('${l['subject']}'),
              subtitle: Text('coef. ${l['coefficient']}${(l['average'] as Map)['mention'] != null ? ' · ${(l['average'] as Map)['mention']}' : ''}'),
              trailing: Text('${(l['average'] as Map)['text']}', style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
          if (g != null)
            ListTile(
              title: Text(en ? 'General average' : 'Moyenne générale', style: const TextStyle(fontWeight: FontWeight.bold)),
              subtitle: d['rank'] == null ? null : Text('${en ? 'Rank' : 'Rang'} ${d['rank']}/${d['classSize']}'),
              trailing: Text('${g['text']}', style: const TextStyle(fontWeight: FontWeight.bold)),
            ),
        ]);
      },
    );
  }
}

/// Teacher entry: create the evaluation online (the active scale is frozen then), enter grades with the scale's rules,
/// offline entries are queued with priority and replayed on reconnection.
class GradeEntryScreen extends ConsumerStatefulWidget {
  final String period;
  const GradeEntryScreen({super.key, required this.period});
  @override
  ConsumerState<GradeEntryScreen> createState() => _GradeEntryState();
}

class _GradeEntryState extends ConsumerState<GradeEntryScreen> {
  late final Future<_Who> _who = _loadWho(ref);
  late final Future<List<Map<String, dynamic>>> _subjects = _loadSubjects();
  String? _cls, _subject, _evalId;
  Map<String, dynamic>? _scale;
  final _title = TextEditingController(text: 'DS 1');
  final Map<String, TextEditingController> _values = {};
  String _msg = '';

  Future<List<Map<String, dynamic>>> _loadSubjects() async {
    try {
      return ((await _get(ref, '/subjects')) as List).cast<Map<String, dynamic>>();
    } catch (_) {
      return [];
    }
  }

  @override
  void dispose() {
    _title.dispose();
    for (final c in _values.values) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _create() async {
    final s = ref.read(sessionProvider);
    try {
      final r = await ref.read(apiProvider).postOnline(s.school!, s.token!, '/evaluations', {'class_id': _cls, 'subject_id': _subject, 'period_code': widget.period, 'title': _title.text.trim()});
      setState(() {
        _evalId = r['id'] as String;
        _scale = (r['scale_snapshot'] as Map).cast<String, dynamic>();
        _msg = '';
      });
    } catch (e) {
      setState(() => _msg = '$e');
    }
  }

  Future<void> _save(List<Map<String, dynamic>> students) async {
    final scale = _scale!;
    final letter = scale['type'] == 'letter';
    final entries = <Map<String, dynamic>>[];
    for (final st in students) {
      final raw = _values[st['id']]?.text.trim() ?? '';
      if (raw.isEmpty) continue;
      if (letter) {
        entries.add({'student_id': st['id'], 'value': raw});
      } else {
        final v = double.tryParse(raw.replaceAll(',', '.'));
        if (v == null || !validGradeInput(v, (scale['min'] as num).toDouble(), (scale['max'] as num).toDouble(), (scale['step'] as num).toDouble())) {
          setState(() => _msg = '${st['last_name']}: ${scale['min']}..${scale['max']} (pas/step ${scale['step']})');
          return;
        }
        entries.add({'student_id': st['id'], 'value': v});
      }
    }
    if (entries.isEmpty) return;
    final s = ref.read(sessionProvider);
    try {
      final queued = await ref.read(apiProvider).post(s.school!, s.token!, '/evaluations/$_evalId/grades', {'entries': entries}, ref.read(queueProvider), priority: 10);
      setState(() => _msg = queued ? 'Hors ligne : saisie mise en file / Offline: queued' : '${entries.length} OK');
    } catch (e) {
      setState(() => _msg = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Notes · ${widget.period}')),
      body: FutureBuilder<List<dynamic>>(
        future: Future.wait<dynamic>([_who, _subjects]),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final w = snap.data![0] as _Who;
          final subjects = snap.data![1] as List<Map<String, dynamic>>;
          final classIds = {for (final s in w.students) if (s['class_id'] != null) s['class_id'] as String}.toList();
          final students = w.students.where((s) => s['class_id'] == _cls).toList();
          return ListView(padding: const EdgeInsets.all(12), children: [
            DropdownButton<String>(
              isExpanded: true,
              hint: const Text('Classe / Class'),
              value: _cls,
              items: [for (final id in classIds) DropdownMenuItem(value: id, child: Text(_className(w, id)))],
              onChanged: _evalId == null ? (v) => setState(() => _cls = v) : null,
            ),
            DropdownButton<String>(
              isExpanded: true,
              hint: const Text('Matière / Subject'),
              value: _subject,
              items: [for (final s in subjects) DropdownMenuItem(value: s['id'] as String, child: Text('${s['name']}'))],
              onChanged: _evalId == null ? (v) => setState(() => _subject = v) : null,
            ),
            TextField(controller: _title, enabled: _evalId == null, decoration: const InputDecoration(labelText: 'Évaluation / Evaluation')),
            const SizedBox(height: 8),
            if (_evalId == null) FilledButton(onPressed: _cls != null && _subject != null ? _create : null, child: const Text('Créer / Create')),
            if (_evalId != null && _scale != null) ...[
              Text(_scale!['type'] == 'letter'
                  ? 'Échelle ${_scale!['code']} : ${(_scale!['bands'] as List).map((b) => (b as Map)['label']).join(', ')}'
                  : 'Échelle ${_scale!['code']} : ${_scale!['min']} à ${_scale!['max']}, pas ${_scale!['step']}'),
              for (final st in students)
                ListTile(
                  title: Text(w.studentName(st)),
                  trailing: SizedBox(
                    width: 90,
                    child: TextField(
                      controller: _values.putIfAbsent(st['id'] as String, TextEditingController.new),
                      keyboardType: _scale!['type'] == 'letter' ? TextInputType.text : const TextInputType.numberWithOptions(decimal: true),
                      textAlign: TextAlign.end,
                    ),
                  ),
                ),
              FilledButton(onPressed: () => _save(students), child: const Text('Enregistrer / Save')),
            ],
            if (_msg.isNotEmpty) Padding(padding: const EdgeInsets.only(top: 8), child: Text(_msg, semanticsLabel: _msg)),
          ]);
        },
      ),
    );
  }
}

// ---------------------------------------------------------------------------------------------------------------------
class AbsencesScreen extends ConsumerStatefulWidget {
  const AbsencesScreen({super.key});
  @override
  ConsumerState<AbsencesScreen> createState() => _AbsencesState();
}

class _AbsencesState extends ConsumerState<AbsencesScreen> {
  late final Future<_Who> _who = _loadWho(ref);
  String? _cls, _student;
  String _msg = '';

  Future<void> _record(String studentId, String kind) async {
    final s = ref.read(sessionProvider);
    final today = DateTime.now().toIso8601String().substring(0, 10);
    try {
      final queued = await ref.read(apiProvider).post(s.school!, s.token!, '/absences', {'student_id': studentId, 'on_date': today, 'kind': kind, 'period_index': 0, if (kind == 'late') 'minutes_late': 10}, ref.read(queueProvider));
      setState(() => _msg = queued ? 'Hors ligne : pointage mis en file / Offline: queued' : 'OK');
    } catch (e) {
      setState(() => _msg = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final en = Localizations.localeOf(context).languageCode == 'en';
    return Scaffold(
      appBar: AppBar(title: Text(en ? 'Absences' : 'Absences')),
      body: FutureBuilder<_Who>(
        future: _who,
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final w = snap.data!;
          if (w.abilities['absences_write'] == true) {
            final classIds = {for (final s in w.students) if (s['class_id'] != null) s['class_id'] as String}.toList();
            final list = w.students.where((s) => s['class_id'] == _cls).toList();
            return ListView(children: [
              Padding(
                padding: const EdgeInsets.all(8),
                child: DropdownButton<String>(
                  isExpanded: true,
                  hint: Text(en ? 'Class' : 'Classe'),
                  value: _cls,
                  items: [for (final id in classIds) DropdownMenuItem(value: id, child: Text(_className(w, id)))],
                  onChanged: (v) => setState(() => _cls = v),
                ),
              ),
              for (final st in list)
                ListTile(
                  title: Text(w.studentName(st)),
                  trailing: Row(mainAxisSize: MainAxisSize.min, children: [
                    TextButton(onPressed: () => _record(st['id'] as String, 'absence'), child: Text(en ? 'Absent' : 'Absent')),
                    TextButton(onPressed: () => _record(st['id'] as String, 'late'), child: Text(en ? 'Late' : 'Retard')),
                  ]),
                ),
              if (_msg.isNotEmpty) Padding(padding: const EdgeInsets.all(12), child: Text(_msg)),
            ]);
          }
          final sid = _student ?? (w.students.isNotEmpty ? w.students.first['id'] as String : null);
          return ListView(children: [
            if (w.students.length > 1)
              Padding(
                padding: const EdgeInsets.all(8),
                child: DropdownButton<String>(
                  isExpanded: true,
                  value: sid,
                  items: [for (final s in w.students) DropdownMenuItem(value: s['id'] as String, child: Text(w.studentName(s)))],
                  onChanged: (v) => setState(() => _student = v),
                ),
              ),
            if (sid == null) Center(child: Text(en ? 'No student' : 'Aucun élève')) else _AttendanceView(key: ValueKey(sid), studentId: sid),
          ]);
        },
      ),
    );
  }
}

class _AttendanceView extends ConsumerWidget {
  final String studentId;
  const _AttendanceView({super.key, required this.studentId});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return FutureBuilder(
      future: ref.read(apiProvider).getJson(s.school!, s.token!, '/students/$studentId/attendance', ref.read(cacheProvider)),
      builder: (c, snap) {
        if (snap.connectionState != ConnectionState.done) return const Padding(padding: EdgeInsets.all(24), child: Center(child: CircularProgressIndicator()));
        if (snap.hasError) return Padding(padding: const EdgeInsets.all(16), child: Text('${snap.error}'));
        final d = (snap.data!.data as Map).cast<String, dynamic>();
        return Column(children: [
          _offlineBanner(snap.data!.fromCache),
          for (final e in d.entries)
            ListTile(
              dense: true,
              title: Text(e.key),
              trailing: Text(e.value is Map || e.value is List ? jsonEncode(e.value) : '${e.value}', overflow: TextOverflow.ellipsis),
            ),
        ]);
      },
    );
  }
}

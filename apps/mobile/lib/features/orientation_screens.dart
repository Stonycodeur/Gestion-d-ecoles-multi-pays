import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

Future<dynamic> _get(WidgetRef ref, String path) async {
  final s = ref.read(sessionProvider);
  return (await ref.read(apiProvider).getJson(s.school!, s.token!, path, ref.read(cacheProvider))).data;
}

Future<dynamic> _send(WidgetRef ref, String path, Map<String, dynamic> body) {
  final s = ref.read(sessionProvider);
  return ref.read(apiProvider).postOnline(s.school!, s.token!, path, body);
}

/// Orientation paths and career sheets, internship requests and reports, exam fiche (BEPC/Brevet projection).
class OrientationScreen extends ConsumerStatefulWidget {
  const OrientationScreen({super.key});
  @override
  ConsumerState<OrientationScreen> createState() => _OrientationState();
}

class _OrientationState extends ConsumerState<OrientationScreen> {
  List<Map<String, dynamic>> paths = [], internships = [], students = [];
  String? sid;
  Map<String, dynamic>? fiche;
  String message = '';
  final organisation = TextEditingController();
  final start = TextEditingController();
  final end = TextEditingController();
  final report = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = (await _get(ref, '/orientation/paths') as List).cast<Map<String, dynamic>>();
      final i = (await _get(ref, '/orientation/internships') as List).cast<Map<String, dynamic>>();
      final st = (await _get(ref, '/me/students') as List).cast<Map<String, dynamic>>();
      setState(() {
        paths = p;
        internships = i;
        students = st;
        sid ??= st.isEmpty ? null : st.first['id'] as String;
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _do(Future<dynamic> Function() f, String ok) async {
    try {
      await f();
      setState(() => message = ok);
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _fiche() async {
    try {
      final r = await _get(ref, '/orientation/exam/fiche/$sid') as Map<String, dynamic>;
      setState(() {
        fiche = r['fiche'] as Map<String, dynamic>;
        message = '';
      });
    } catch (e) {
      setState(() {
        fiche = null;
        message = '$e';
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return DefaultTabController(
      length: 3,
      child: Scaffold(
        appBar: AppBar(title: const Text('Orientation'), bottom: const TabBar(tabs: [Tab(text: 'Parcours'), Tab(text: 'Stages'), Tab(text: 'Fiche BEPC')])),
        body: Column(children: [
          if (message.isNotEmpty) Padding(padding: const EdgeInsets.all(8), child: Semantics(liveRegion: true, child: Text(message))),
          if (students.length > 1)
            DropdownButton<String>(
              value: sid,
              items: [for (final s in students) DropdownMenuItem(value: s['id'] as String, child: Text('${s['first_name']} ${s['last_name']}'))],
              onChanged: (v) => setState(() => sid = v),
            ),
          Expanded(
            child: TabBarView(children: [
              ListView(children: [
                for (final p in paths)
                  ListTile(
                    title: Text('${p['title']}'),
                    subtitle: Text('${p['description']}${(p['steps'] as List).isEmpty ? '' : '\n${(p['steps'] as List).join(' → ')}'}'),
                    isThreeLine: (p['steps'] as List).isNotEmpty,
                  ),
              ]),
              ListView(padding: const EdgeInsets.all(8), children: [
                for (final i in internships)
                  Card(
                    child: ListTile(
                      title: Text('${i['organisation']} — ${i['status']}'),
                      subtitle: Text('${i['start_on'].toString().substring(0, 10)} → ${i['end_on'].toString().substring(0, 10)}'),
                      trailing: switch (i['status']) {
                        'approved' => TextButton(onPressed: () => _do(() => _send(ref, '/orientation/internships/${i['id']}/transition', {'to': 'in_progress'}), 'Stage démarré'), child: const Text('Démarrer')),
                        'in_progress' => TextButton(
                            onPressed: () => showDialog<void>(
                                context: context,
                                builder: (c) => AlertDialog(
                                      title: const Text('Rapport de stage'),
                                      content: TextField(controller: report, maxLines: 6),
                                      actions: [
                                        TextButton(
                                            onPressed: () {
                                              Navigator.pop(c);
                                              _do(() => _send(ref, '/orientation/internships/${i['id']}/report', {'text': report.text}), 'Rapport remis');
                                            },
                                            child: const Text('Remettre'))
                                      ],
                                    )),
                            child: const Text('Rapport')),
                        _ => null,
                      },
                    ),
                  ),
                const Divider(),
                TextField(controller: organisation, decoration: const InputDecoration(labelText: 'Organisme')),
                TextField(controller: start, decoration: const InputDecoration(labelText: 'Début (AAAA-MM-JJ)')),
                TextField(controller: end, decoration: const InputDecoration(labelText: 'Fin (AAAA-MM-JJ)')),
                FilledButton(
                    onPressed: sid == null
                        ? null
                        : () => _do(() => _send(ref, '/orientation/internships', {'student_id': sid, 'organisation': organisation.text, 'start_on': start.text, 'end_on': end.text}), 'Demande envoyée'),
                    child: const Text('Demander un stage')),
              ]),
              ListView(padding: const EdgeInsets.all(8), children: [
                FilledButton(onPressed: sid == null ? null : _fiche, child: const Text('Afficher la fiche')),
                if (fiche != null) ...[
                  const Text('Projection indicative — pas un résultat officiel', style: TextStyle(fontStyle: FontStyle.italic)),
                  Text('${fiche!['exam_code']} · contrôle continu ${fiche!['continuous_pct'] ?? '—'} % · examen ${fiche!['exam_pct'] ?? '—'} % · projection ${fiche!['projected_pct'] ?? '—'} %'),
                  for (final s in (fiche!['subjects'] as List).cast<Map<String, dynamic>>())
                    ListTile(dense: true, title: Text('${s['subject_code']} (coef. ${s['coefficient']})'), trailing: Text('${s['continuous_pct'] ?? '—'} / ${s['exam_pct'] ?? '—'} / ${s['combined_pct'] ?? '—'}')),
                ],
              ]),
            ]),
          ),
        ]),
      ),
    );
  }
}

/// Resource library (full-text search) and class forums. Forum posts are queued when offline.
class ResourcesScreen extends ConsumerStatefulWidget {
  const ResourcesScreen({super.key});
  @override
  ConsumerState<ResourcesScreen> createState() => _ResourcesState();
}

class _ResourcesState extends ConsumerState<ResourcesScreen> {
  List<Map<String, dynamic>> items = [], forums = [];
  final q = TextEditingController();
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final path = q.text.trim().isEmpty ? '/resources' : '/resources?q=${Uri.encodeQueryComponent(q.text.trim())}';
      final r = (await _get(ref, path) as List).cast<Map<String, dynamic>>();
      final f = (await _get(ref, '/forums') as List).cast<Map<String, dynamic>>();
      setState(() {
        items = r;
        forums = f;
        message = '';
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ressources et forums')),
      body: ListView(padding: const EdgeInsets.all(8), children: [
        if (message.isNotEmpty) Text(message),
        TextField(controller: q, decoration: const InputDecoration(labelText: 'Recherche', suffixIcon: Icon(Icons.search)), onSubmitted: (_) => _load()),
        for (final r in items) ListTile(title: Text('${r['title']}'), subtitle: Text('${r['kind']} · ${r['subject_code'] ?? ''} ${r['level_code'] ?? ''}\n${r['url']}'), isThreeLine: true),
        const Divider(),
        const Text('Forums', style: TextStyle(fontWeight: FontWeight.bold)),
        for (final f in forums) ListTile(title: Text('${f['title']}'), onTap: () => Navigator.push(context, MaterialPageRoute<void>(builder: (_) => ForumScreen(forumId: f['id'] as String, title: '${f['title']}')))),
      ]),
    );
  }
}

class ForumScreen extends ConsumerStatefulWidget {
  const ForumScreen({super.key, required this.forumId, required this.title});
  final String forumId, title;
  @override
  ConsumerState<ForumScreen> createState() => _ForumState();
}

class _ForumState extends ConsumerState<ForumScreen> {
  List<Map<String, dynamic>> posts = [];
  final body = TextEditingController();
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = (await _get(ref, '/forums/${widget.forumId}/posts') as List).cast<Map<String, dynamic>>();
      setState(() => posts = p);
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _post() async {
    final s = ref.read(sessionProvider);
    try {
      final queued = await ref.read(apiProvider).post(s.school!, s.token!, '/forums/${widget.forumId}/posts', {'body': body.text}, ref.read(queueProvider));
      body.clear();
      setState(() => message = queued ? 'Message en attente de connexion' : '');
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.title)),
      body: Column(children: [
        if (message.isNotEmpty) Text(message),
        Expanded(child: ListView(children: [for (final p in posts) Padding(padding: EdgeInsets.only(left: p['parent_id'] == null ? 8 : 32, top: 4, right: 8), child: Text('${p['author_name']} : ${p['body']}'))])),
        Row(children: [
          Expanded(child: Padding(padding: const EdgeInsets.all(8), child: TextField(controller: body, decoration: const InputDecoration(labelText: 'Message')))),
          IconButton(icon: const Icon(Icons.send), tooltip: 'Publier', onPressed: _post),
        ]),
      ]),
    );
  }
}

/// Staff: online enrolment requests from the public space (accept creates the student, reject needs no side effect).
class VisitorApplicationsScreen extends ConsumerStatefulWidget {
  const VisitorApplicationsScreen({super.key});
  @override
  ConsumerState<VisitorApplicationsScreen> createState() => _ApplicationsState();
}

class _ApplicationsState extends ConsumerState<VisitorApplicationsScreen> {
  List<Map<String, dynamic>> apps = [];
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final a = (await _get(ref, '/visitor/applications?status=pending') as List).cast<Map<String, dynamic>>();
      setState(() => apps = a);
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _decide(String id, bool accept) async {
    try {
      await _send(ref, '/visitor/applications/$id/decision', {'accept': accept});
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Demandes d’inscription')),
      body: ListView(children: [
        if (message.isNotEmpty) Text(message),
        for (final a in apps)
          ListTile(
            title: Text('${a['first_name']} ${a['last_name']} — ${a['level_code']}'),
            subtitle: Text('${a['guardian_name']} (${a['guardian_email'] ?? a['guardian_phone']})'),
            trailing: Row(mainAxisSize: MainAxisSize.min, children: [
              IconButton(icon: const Icon(Icons.check), tooltip: 'Accepter', onPressed: () => _decide(a['id'] as String, true)),
              IconButton(icon: const Icon(Icons.close), tooltip: 'Refuser', onPressed: () => _decide(a['id'] as String, false)),
            ]),
          ),
      ]),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

Color _hex(String? c) {
  final v = (c ?? '#607d8b').replaceFirst('#', '');
  return Color(int.parse('FF$v', radix: 16));
}

/// OAA of a student, shown in the ACTIVE scale of the student's cycle (14,6/20, 7,3/10, B ...).
class OaaScreen extends ConsumerWidget {
  final String studentId;
  const OaaScreen({super.key, required this.studentId});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('OAA')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/students/$studentId/oaa', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final d = snap.data!.data as Map<String, dynamic>;
          final disp = d['display'] as Map<String, dynamic>? ?? {};
          final axes = (d['axes'] as Map<String, dynamic>? ?? {});
          final th = d['thresholds'] as Map<String, dynamic>? ?? {};
          return ListView(padding: const EdgeInsets.all(16), children: [
            Semantics(
              label: 'Score OAA ${disp['text']}',
              child: Card(
                color: _hex(disp['color'] as String?),
                child: Padding(
                  padding: const EdgeInsets.all(24),
                  child: Text('${disp['text']}', textAlign: TextAlign.center, style: Theme.of(context).textTheme.displaySmall?.copyWith(color: Colors.white)),
                ),
              ),
            ),
            if (snap.data!.fromCache) const Text('Hors ligne / Offline'),
            Text('${disp['mention'] ?? ''}'),
            const SizedBox(height: 8),
            for (final e in axes.entries) ListTile(title: Text(e.key), trailing: Text('${(e.value as num).round()}/100'), subtitle: LinearProgressIndicator(value: (e.value as num) / 100)),
            Text('Seuils : ${(th['warning'] as Map?)?['in_scale'] ?? ''} · ${(th['penalty'] as Map?)?['in_scale'] ?? ''}'),
          ]);
        },
      ),
    );
  }
}

class LeaderboardScreen extends StatelessWidget {
  const LeaderboardScreen({super.key});
  @override
  Widget build(BuildContext context) =>
      JsonListScreen('Classement / Leaderboard', '/leaderboards?scope=class', (m) => '${m['rank']}. ${m['name']} — ${m['points']} XP');
}

class RiskDashboardScreen extends StatelessWidget {
  const RiskDashboardScreen({super.key});
  @override
  Widget build(BuildContext context) => const _RiskBody();
}

class _RiskBody extends ConsumerWidget {
  const _RiskBody();
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Risque / Risk')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/predictive/dashboard', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final d = snap.data!.data as Map<String, dynamic>;
          final counts = d['counts'] as Map<String, dynamic>? ?? {};
          final high = (d['high_risk'] as List? ?? []).cast<Map<String, dynamic>>();
          return ListView(padding: const EdgeInsets.all(16), children: [
            const Text('Aide à la décision uniquement / Decision support only', style: TextStyle(fontWeight: FontWeight.bold)),
            Text('Élevé ${counts['high'] ?? 0} · Moyen ${counts['medium'] ?? 0} · Faible ${counts['low'] ?? 0}'),
            for (final h in high) ListTile(title: Text('${h['name']}'), trailing: Text('${(((h['probability'] ?? 0) as num) * 100).round()} %')),
          ]);
        },
      ),
    );
  }
}

class QuizListScreen extends ConsumerWidget {
  const QuizListScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Jeux / Games')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/quizzes', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final rows = (snap.data!.data as List).cast<Map<String, dynamic>>();
          return ListView(children: [
            for (final q in rows)
              ListTile(
                title: Text('${q['title']}'),
                subtitle: Text('${q['mode']}'),
                trailing: const Icon(Icons.play_arrow),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => QuizPlayerScreen(quizId: q['id'] as String))),
              ),
          ]);
        },
      ),
    );
  }
}

/// Quiz player. Needs a connection (timing and anti-cheat are enforced by the server); answers use the ORIGINAL index of each choice.
class QuizPlayerScreen extends ConsumerStatefulWidget {
  final String quizId;
  const QuizPlayerScreen({super.key, required this.quizId});
  @override
  ConsumerState<QuizPlayerScreen> createState() => _QuizPlayerState();
}

class _QuizPlayerState extends ConsumerState<QuizPlayerScreen> {
  Map<String, dynamic>? attempt;
  Map<String, dynamic>? result;
  final answers = <String, int>{};
  String? error;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    final s = ref.read(sessionProvider);
    try {
      final r = await ref.read(apiProvider).postOnline(s.school!, s.token!, '/quizzes/${widget.quizId}/start', {});
      setState(() => attempt = r as Map<String, dynamic>);
    } catch (e) {
      setState(() => error = '$e');
    }
  }

  Future<void> _submit() async {
    final s = ref.read(sessionProvider);
    try {
      final r = await ref.read(apiProvider).postOnline(s.school!, s.token!, '/quiz-attempts/${attempt!['attempt_id']}/submit', {'answers': answers});
      setState(() => result = r as Map<String, dynamic>);
    } catch (e) {
      setState(() => error = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    if (error != null) return Scaffold(appBar: AppBar(), body: Center(child: Text(error!)));
    if (result != null) {
      return Scaffold(
        appBar: AppBar(title: const Text('Résultat')),
        body: Center(child: Text('Score ${result!['score100']}/100 · +${result!['xp']} XP', style: Theme.of(context).textTheme.headlineMedium)),
      );
    }
    if (attempt == null) return const Scaffold(body: Center(child: CircularProgressIndicator()));
    final qs = (attempt!['questions'] as List).cast<Map<String, dynamic>>();
    return Scaffold(
      appBar: AppBar(title: const Text('Quiz')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        for (final q in qs) ...[
          Text('${q['prompt']}', style: Theme.of(context).textTheme.titleMedium),
          for (final ch in (q['choices'] as List).cast<Map<String, dynamic>>())
            RadioListTile<int>(
              title: Text('${ch['text']}'),
              value: ch['orig'] as int,
              groupValue: answers[q['id'] as String],
              onChanged: (v) => setState(() => answers[q['id'] as String] = v!),
            ),
        ],
        FilledButton(onPressed: _submit, child: const Text('Valider / Submit')),
      ]),
    );
  }
}

/// Entry point of the OAA module on mobile: student -> own score, parent -> choose a child, teacher -> a student of own classes.
class OaaPickerScreen extends ConsumerWidget {
  const OaaPickerScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('OAA')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/me/students', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final rows = (snap.data!.data as List).cast<Map<String, dynamic>>();
          if (rows.isEmpty) return const Center(child: Text('Aucun élève / No student'));
          return ListView(children: [
            for (final st in rows)
              ListTile(
                title: Text('${st['first_name']} ${st['last_name']}'),
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => OaaScreen(studentId: st['id'] as String))),
              ),
          ]);
        },
      ),
    );
  }
}

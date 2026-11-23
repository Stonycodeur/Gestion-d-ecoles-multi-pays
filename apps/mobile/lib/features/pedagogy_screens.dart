import 'dart:io';
import 'package:flutter/material.dart';
import 'package:path_provider/path_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/json_cache.dart';
import '../core/offline_queue.dart';
import '../core/session.dart';
import 'oaa_games_screens.dart';

final queueProvider = Provider<OfflineQueue>((ref) => OfflineQueue(ref.read(tokenStoreProvider)));
final cacheProvider = Provider<JsonCache>((ref) => JsonCache(ref.read(tokenStoreProvider)));

/// Generic read-only list screen that works offline (cached answer + banner).
class JsonListScreen extends ConsumerWidget {
  final String title, path;
  final String Function(Map<String, dynamic>) line;
  final List<Widget> actions;
  const JsonListScreen(this.title, this.path, this.line, {this.actions = const []});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: Text(title), actions: actions),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, path, ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final r = snap.data!;
          final rows = (r.data as List).cast<Map<String, dynamic>>();
          return Column(children: [
            if (r.fromCache) const MaterialBanner(content: Text('Hors ligne / Offline'), actions: [SizedBox()]),
            Expanded(child: ListView(children: [for (final m in rows) ListTile(title: Text(line(m)))])),
          ]);
        },
      ),
    );
  }
}

String attachmentSize(num bytes) => bytes >= 1048576 ? '${(bytes / 1048576).toStringAsFixed(1)} Mo' : '${(bytes / 1024).ceil()} Ko';

/// Class log: homework, attachments (downloaded with the session token, offline list from cache) and the linked quiz.
class LessonsScreen extends ConsumerWidget {
  const LessonsScreen({super.key});

  Future<void> _open(BuildContext context, WidgetRef ref, String lessonId, Map<String, dynamic> att) async {
    final s = ref.read(sessionProvider);
    final messenger = ScaffoldMessenger.of(context);
    try {
      final f = await ref.read(apiProvider).getBytes(s.school!, s.token!, '/lessons/$lessonId/attachments/${att['id']}');
      if (!context.mounted) return;
      if (f.contentType.startsWith('image/')) {
        await showDialog<void>(context: context, builder: (_) => Dialog(child: InteractiveViewer(child: Image.memory(f.bytes))));
      } else {
        final dir = await getApplicationDocumentsDirectory();
        final name = (att['filename'] as String).replaceAll(RegExp(r'[^\w.\- ]'), '_');
        final file = File('${dir.path}/$name');
        await file.writeAsBytes(f.bytes, flush: true);
        messenger.showSnackBar(SnackBar(content: Text('$name (${attachmentSize(f.bytes.length)}) enregistré / saved')));
      }
    } catch (_) {
      messenger.showSnackBar(const SnackBar(content: Text('Connexion requise pour télécharger / Connection needed to download')));
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Cahier de textes')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/lessons', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final r = snap.data!;
          final rows = (r.data as List).cast<Map<String, dynamic>>();
          return Column(children: [
            if (r.fromCache) const MaterialBanner(content: Text('Hors ligne / Offline'), actions: [SizedBox()]),
            Expanded(
              child: ListView(children: [
                for (final m in rows)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(8),
                      child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                        Text('${(m['on_date'] as String).substring(0, 10)}  ${m['title']}', style: Theme.of(c).textTheme.titleSmall),
                        if (m['homework'] != null) Text('Devoirs / Homework : ${m['homework']}'),
                        for (final a in ((m['attachments'] as List?) ?? const []).cast<Map<String, dynamic>>())
                          ListTile(
                            dense: true,
                            leading: const Icon(Icons.attach_file),
                            title: Text('${a['filename']}'),
                            subtitle: Text(attachmentSize((a['size_bytes'] ?? 0) as num)),
                            onTap: () => _open(c, ref, m['id'] as String, a),
                          ),
                        if (m['quiz_id'] != null)
                          Align(
                            alignment: Alignment.centerLeft,
                            child: TextButton.icon(
                              icon: const Icon(Icons.quiz),
                              label: const Text('QCM / Quiz'),
                              onPressed: () => Navigator.of(c).push(MaterialPageRoute(builder: (_) => QuizPlayerScreen(quizId: m['quiz_id'] as String))),
                            ),
                          ),
                      ]),
                    ),
                  ),
              ]),
            ),
          ]);
        },
      ),
    );
  }
}

class ClassesScreen extends StatelessWidget {
  const ClassesScreen({super.key});
  @override
  Widget build(BuildContext context) => JsonListScreen('Classes', '/classes', (m) => '${m['name']} (${m['level_code']})');
}

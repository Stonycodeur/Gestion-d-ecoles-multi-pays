import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/json_cache.dart';
import '../core/offline_queue.dart';
import '../core/session.dart';

final queueProvider = Provider<OfflineQueue>((ref) => OfflineQueue(ref.read(tokenStoreProvider)));
final cacheProvider = Provider<JsonCache>((ref) => JsonCache(ref.read(tokenStoreProvider)));

/// Generic read-only list screen that works offline (cached answer + banner).
class JsonListScreen extends ConsumerWidget {
  final String title, path;
  final String Function(Map<String, dynamic>) line;
  const JsonListScreen(this.title, this.path, this.line);

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: Text(title)),
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

class LessonsScreen extends StatelessWidget {
  const LessonsScreen({super.key});
  @override
  Widget build(BuildContext context) => JsonListScreen('Cahier de textes', '/lessons',
      (m) => '${(m['on_date'] as String).substring(0, 10)}  ${m['title']}${m['homework'] != null ? ' - ${m['homework']}' : ''}');
}

class ClassesScreen extends StatelessWidget {
  const ClassesScreen({super.key});
  @override
  Widget build(BuildContext context) => JsonListScreen('Classes', '/classes', (m) => '${m['name']} (${m['level_code']})');
}

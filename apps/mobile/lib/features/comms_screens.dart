import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../core/api_client.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

/// Registers this device for push. Sandbox mode: a local token the API stores like a real FCM/APNs token
/// (the API then writes to push_outbox instead of calling Firebase). With a real Firebase project,
/// firebase_messaging supplies the token instead (docs/INTEGRATIONS.md).
final pushRegistrationProvider = FutureProvider<void>((ref) async {
  final s = ref.watch(sessionProvider);
  if (s.token == null || s.school == null) return;
  final platform = defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  try {
    await http.post(Uri.parse('$apiBase/devices'),
        headers: {'content-type': 'application/json', 'x-tenant': s.school!, 'authorization': 'Bearer ${s.token}'},
        body: jsonEncode({'platform': platform, 'token': 'sandbox-${s.school}-${s.token!.hashCode}'}));
  } catch (_) {/* offline: retried at next start */}
});

class NewsScreen extends StatelessWidget {
  const NewsScreen({super.key});
  @override
  Widget build(BuildContext context) => JsonListScreen('Actualités / News', '/news', (m) => '${m['title']} — ${m['body']}');
}

class NotificationsScreen extends StatelessWidget {
  const NotificationsScreen({super.key});
  @override
  Widget build(BuildContext context) => JsonListScreen('Notifications', '/notifications', (m) => '${m['title']} — ${m['body']}');
}

class ThreadsScreen extends ConsumerWidget {
  const ThreadsScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final s = ref.watch(sessionProvider);
    return Scaffold(
      appBar: AppBar(title: const Text('Messages')),
      body: FutureBuilder(
        future: ref.read(apiProvider).getJson(s.school!, s.token!, '/threads', ref.read(cacheProvider)),
        builder: (c, snap) {
          if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
          if (snap.hasError) return Center(child: Text('${snap.error}'));
          final rows = (snap.data!.data as List).cast<Map<String, dynamic>>();
          return ListView(children: [
            for (final t in rows)
              ListTile(
                title: Text('${t['subject']}'),
                trailing: (t['unread'] as int? ?? 0) > 0 ? CircleAvatar(radius: 12, child: Text('${t['unread']}')) : null,
                onTap: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => ThreadScreen(id: t['id'] as String, subject: '${t['subject']}'))),
              ),
          ]);
        },
      ),
    );
  }
}

class ThreadScreen extends ConsumerStatefulWidget {
  final String id, subject;
  const ThreadScreen({super.key, required this.id, required this.subject});
  @override
  ConsumerState<ThreadScreen> createState() => _ThreadScreenState();
}

class _ThreadScreenState extends ConsumerState<ThreadScreen> {
  final _ctl = TextEditingController();
  late Future<({dynamic data, bool fromCache})> _f;
  String? _note;
  @override
  void initState() { super.initState(); _f = _load(); }
  Future<({dynamic data, bool fromCache})> _load() {
    final s = ref.read(sessionProvider);
    return ref.read(apiProvider).getJson(s.school!, s.token!, '/threads/${widget.id}', ref.read(cacheProvider));
  }
  Future<void> _send() async {
    final s = ref.read(sessionProvider);
    final text = _ctl.text.trim();
    if (text.isEmpty) return;
    try {
      final queued = await ref.read(apiProvider).post(s.school!, s.token!, '/threads/${widget.id}/messages', {'body': text}, ref.read(queueProvider));
      _ctl.clear();
      setState(() { _note = queued ? 'Hors ligne : message mis en file / queued' : null; _f = _load(); });
    } catch (e) { setState(() => _note = '$e'); }
  }
  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: Text(widget.subject)),
        body: Column(children: [
          Expanded(child: FutureBuilder(
            future: _f,
            builder: (c, snap) {
              if (snap.connectionState != ConnectionState.done) return const Center(child: CircularProgressIndicator());
              if (snap.hasError) return Center(child: Text('${snap.error}'));
              final rows = (snap.data!.data as List).cast<Map<String, dynamic>>();
              return ListView(children: [for (final m in rows) ListTile(title: Text('${m['body']}'), subtitle: Text('${m['created_at']}'.substring(0, 16)))]);
            },
          )),
          if (_note != null) Padding(padding: const EdgeInsets.all(8), child: Text(_note!)),
          Padding(padding: const EdgeInsets.all(8), child: Row(children: [
            Expanded(child: TextField(controller: _ctl, decoration: const InputDecoration(hintText: 'Message'), onSubmitted: (_) => _send())),
            IconButton(icon: const Icon(Icons.send), tooltip: 'Envoyer / Send', onPressed: _send),
          ])),
        ]),
      );
}

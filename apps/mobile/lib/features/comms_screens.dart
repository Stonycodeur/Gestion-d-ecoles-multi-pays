import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:http/http.dart' as http;
import '../core/api_client.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';
import '../core/push_token.dart';

/// Registers this device for push. Sandbox mode: a local token the API stores like a real FCM/APNs token
/// (the API then writes to push_outbox instead of calling Firebase). With a real Firebase project,
/// firebase_messaging supplies the token instead (docs/INTEGRATIONS.md).
final pushRegistrationProvider = FutureProvider<void>((ref) async {
  final s = ref.watch(sessionProvider);
  if (s.token == null || s.school == null) return;
  final platform = defaultTargetPlatform == TargetPlatform.iOS ? 'ios' : 'android';
  Future<void> register(String token) => http.post(Uri.parse('$apiBase/devices'),
      headers: {'content-type': 'application/json', 'x-tenant': s.school!, 'authorization': 'Bearer ${s.token}'},
      body: jsonEncode({'platform': platform, 'token': token}));
  try {
    // Real FCM/APNs token when Firebase is configured for this build, otherwise a local sandbox token (same API flow).
    final real = await realPushToken();
    await register(real ?? 'sandbox-${s.school}-${s.token!.hashCode}');
    listenPushTokenRefresh((t) { register(t).catchError((_) => http.Response('', 0)); });
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
  Widget build(BuildContext context) => JsonListScreen('Notifications', '/notifications', (m) => '${m['title']} — ${m['body']}', actions: [
        IconButton(
          tooltip: 'Canaux SMS / e-mail',
          icon: const Icon(Icons.tune),
          onPressed: () => Navigator.of(context).push(MaterialPageRoute(builder: (_) => const NotificationPrefsScreen())),
        ),
      ]);
}

/// Optional channels: absences and payment reminders also go by SMS and e-mail unless switched off here (push and in-app stay on).
class NotificationPrefsScreen extends ConsumerStatefulWidget {
  const NotificationPrefsScreen({super.key});
  @override
  ConsumerState<NotificationPrefsScreen> createState() => _PrefsState();
}

class _PrefsState extends ConsumerState<NotificationPrefsScreen> {
  Map<String, dynamic>? prefs;
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = ref.read(sessionProvider);
    try {
      final p = await ref.read(apiProvider).getRaw(s.school!, s.token!, '/me/notification-preferences');
      if (mounted) setState(() => prefs = p);
    } catch (_) {
      if (mounted) setState(() => message = 'Connexion requise / Connection needed');
    }
  }

  Future<void> _set(String key, bool v) async {
    final s = ref.read(sessionProvider);
    try {
      final p = await ref.read(apiProvider).putOnline(s.school!, s.token!, '/me/notification-preferences', {key: v}) as Map<String, dynamic>;
      if (mounted) setState(() => prefs = p);
    } catch (_) {
      if (mounted) setState(() => message = 'Enregistrement impossible hors connexion / Cannot save offline');
    }
  }

  @override
  Widget build(BuildContext context) {
    final p = prefs;
    return Scaffold(
      appBar: AppBar(title: const Text('Canaux de notification')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (message.isNotEmpty) Semantics(liveRegion: true, child: Text(message)),
        const Text('Les notifications dans l’application et les push restent actives. / In-app and push notifications stay on.'),
        if (p != null) ...[
          SwitchListTile(
            title: const Text('SMS (absences, rappels de paiement)'),
            subtitle: Text(p['has_phone'] == true ? 'Numéro enregistré' : 'Aucun numéro enregistré par l’établissement'),
            value: p['sms'] == true,
            onChanged: (v) => _set('sms', v),
          ),
          SwitchListTile(
            title: const Text('E-mail (absences, factures, rappels)'),
            subtitle: Text(p['has_email'] == true ? 'Adresse enregistrée' : 'Aucune adresse enregistrée par l’établissement'),
            value: p['email'] == true,
            onChanged: (v) => _set('email', v),
          ),
        ],
      ]),
    );
  }
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

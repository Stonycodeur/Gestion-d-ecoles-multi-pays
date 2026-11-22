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

/// Ministry transmissions for the direction: review the checksum, validate, send, read the exchange log.
class MinistryScreen extends ConsumerStatefulWidget {
  const MinistryScreen({super.key});
  @override
  ConsumerState<MinistryScreen> createState() => _MinistryState();
}

class _MinistryState extends ConsumerState<MinistryScreen> {
  List<Map<String, dynamic>> items = [];
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final l = (await _get(ref, '/ministry/transmissions') as List).cast<Map<String, dynamic>>();
      setState(() {
        items = l;
        message = '';
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _act(String path, Map<String, dynamic> body, String ok) async {
    try {
      await _send(ref, path, body);
      setState(() => message = ok);
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _open(Map<String, dynamic> t) async {
    Map<String, dynamic> d = t;
    try {
      d = await _get(ref, '/ministry/transmissions/${t['id']}') as Map<String, dynamic>;
    } catch (_) {}
    if (!mounted) return;
    final logs = ((d['logs'] as List?) ?? []).cast<Map<String, dynamic>>();
    final status = '${d['status']}';
    await showDialog<void>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${d['dataset']} — $status'),
        content: SingleChildScrollView(
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
            SelectableText('SHA-256 : ${d['checksum']}'),
            const SizedBox(height: 8),
            Text('Lignes : ${d['rows_count']}'),
            const Divider(),
            for (final l in logs) Text('${l['event']}${l['detail'] == null ? '' : ' — ${l['detail']}'}'),
          ]),
        ),
        actions: [
          if (status == 'prepared')
            TextButton(
                onPressed: () {
                  Navigator.pop(c);
                  _act('/ministry/transmissions/${d['id']}/validate', {'approve': true, 'checksum': d['checksum']}, 'Transmission validée');
                },
                child: const Text('Valider')),
          if (status == 'validated' || status == 'failed')
            TextButton(
                onPressed: () {
                  Navigator.pop(c);
                  _act('/ministry/transmissions/${d['id']}/send', {}, 'Transmission envoyée');
                },
                child: const Text('Envoyer')),
          if (status == 'prepared' || status == 'validated' || status == 'failed')
            TextButton(
                onPressed: () {
                  Navigator.pop(c);
                  _act('/ministry/transmissions/${d['id']}/cancel', {}, 'Transmission annulée');
                },
                child: const Text('Annuler')),
          TextButton(onPressed: () => Navigator.pop(c), child: const Text('Fermer')),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Ministères')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (message.isNotEmpty) Padding(padding: const EdgeInsets.all(8), child: Semantics(liveRegion: true, child: Text(message))),
          for (final t in items)
            ListTile(
              title: Text('${t['dataset']} ${t['school_year']} (${t['format']})'),
              subtitle: Text('${t['rows_count']} lignes — ${t['status']}'),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => _open(t),
            ),
          if (items.isEmpty && message.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Aucune transmission. La préparation se fait depuis la version web.')),
        ]),
      ),
    );
  }
}

/// Module marketplace: permissions are listed and must be accepted before installation.
class MarketplaceScreen extends ConsumerStatefulWidget {
  const MarketplaceScreen({super.key});
  @override
  ConsumerState<MarketplaceScreen> createState() => _MarketplaceState();
}

class _MarketplaceState extends ConsumerState<MarketplaceScreen> {
  List<Map<String, dynamic>> mods = [];
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final l = (await _get(ref, '/marketplace/modules') as List).cast<Map<String, dynamic>>();
      setState(() {
        mods = l;
        message = '';
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _consent(Map<String, dynamic> m, String action) async {
    final perms = ((m['permissions'] as List?) ?? []).map((e) => '$e').toList();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: Text('${m['name']} v${m['version']}'),
        content: Column(crossAxisAlignment: CrossAxisAlignment.start, mainAxisSize: MainAxisSize.min, children: [
          Text('Risque estimé : ${m['risk']}'),
          const SizedBox(height: 8),
          const Text('Ce module demande les permissions suivantes :'),
          for (final p in perms) Text('• $p'),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Refuser')),
          FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Accepter')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await _send(ref, '/marketplace/modules/${m['name']}/$action', {'accept_permissions': perms});
      setState(() => message = action == 'install' ? 'Module installé' : 'Module mis à jour');
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _uninstall(Map<String, dynamic> m) async {
    try {
      await _send(ref, '/marketplace/modules/${m['name']}/uninstall', {});
      setState(() => message = 'Module désinstallé');
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Marketplace')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(children: [
          if (message.isNotEmpty) Padding(padding: const EdgeInsets.all(8), child: Semantics(liveRegion: true, child: Text(message))),
          for (final m in mods)
            Card(
              child: ListTile(
                title: Text('${m['name']} v${m['version']}'),
                subtitle: Text('${m['description']}\n${m['rating'] == null ? 'Pas encore d’avis' : '★ ${m['rating']} (${m['reviews']})'}'),
                isThreeLine: true,
                trailing: m['installed'] == true
                    ? Row(mainAxisSize: MainAxisSize.min, children: [
                        if (m['update_available'] == true) TextButton(onPressed: () => _consent(m, 'update'), child: const Text('Mettre à jour')),
                        TextButton(onPressed: () => _uninstall(m), child: const Text('Retirer')),
                      ])
                    : TextButton(onPressed: () => _consent(m, 'install'), child: const Text('Installer')),
              ),
            ),
          if (mods.isEmpty && message.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Aucun module publié.')),
        ]),
      ),
    );
  }
}

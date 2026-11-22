import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

/// Settings: legal pages, account deletion (required by Google Play and the App Store) and, for guardians, erasure requests for a child's account.
class AccountScreen extends ConsumerStatefulWidget {
  const AccountScreen({super.key});
  @override
  ConsumerState<AccountScreen> createState() => _AccountState();
}

class _AccountState extends ConsumerState<AccountScreen> {
  String message = '';
  List<Map<String, dynamic>> children = [];

  @override
  void initState() {
    super.initState();
    _loadChildren();
  }

  Future<void> _loadChildren() async {
    try {
      final s = ref.read(sessionProvider);
      final r = await ref.read(apiProvider).getJson(s.school!, s.token!, '/students', ref.read(cacheProvider));
      setState(() => children = (r.data as List).cast<Map<String, dynamic>>());
    } catch (_) {}
  }

  Future<void> _delete() async {
    final ctrl = TextEditingController();
    final ok = await showDialog<bool>(
      context: context,
      builder: (c) => AlertDialog(
        title: const Text('Supprimer mon compte'),
        content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
          const Text('Vos coordonnées, appareils et consentements sont effacés. Les résultats pédagogiques et la facturation sont conservés sans identité, selon les durées légales. Cette action est définitive.'),
          const SizedBox(height: 8),
          TextField(controller: ctrl, decoration: const InputDecoration(labelText: 'Tapez DELETE pour confirmer')),
        ]),
        actions: [
          TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler')),
          FilledButton(onPressed: () => Navigator.pop(c, ctrl.text == 'DELETE'), child: const Text('Supprimer définitivement')),
        ],
      ),
    );
    if (ok != true) return;
    try {
      final s = ref.read(sessionProvider);
      await ref.read(apiProvider).deleteOnline(s.school!, s.token!, '/account', {'confirm': 'DELETE'});
      await ref.read(sessionProvider.notifier).signOut();
      await ref.read(tokenStoreProvider).clear(); // deleted account: nothing of it stays on the device, including unsent writes
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _request(Map<String, dynamic> child) async {
    try {
      final s = ref.read(sessionProvider);
      await ref.read(apiProvider).postOnline(s.school!, s.token!, '/account/erasure-request/${child['id']}', {});
      setState(() => message = 'Demande transmise à l’administration de l’établissement.');
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Paramètres')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (message.isNotEmpty) Semantics(liveRegion: true, child: Text(message)),
        const ListTile(title: Text('Politique de confidentialité et conditions d’utilisation'), subtitle: Text('Sur l’espace public de l’établissement : /legal/privacy et /legal/terms')),
        const Divider(),
        for (final c in children)
          ListTile(
            title: Text('${c['first_name']} ${c['last_name']}'),
            subtitle: const Text('Demander la suppression du compte de cet élève'),
            trailing: TextButton(onPressed: () => _request(c), child: const Text('Demander')),
          ),
        const Divider(),
        FilledButton.tonal(onPressed: _delete, child: const Text('Supprimer mon compte')),
        const Padding(padding: EdgeInsets.only(top: 8), child: Text('Les comptes d’élèves sont supprimés par l’administration à la demande d’un parent.')),
      ]),
    );
  }
}

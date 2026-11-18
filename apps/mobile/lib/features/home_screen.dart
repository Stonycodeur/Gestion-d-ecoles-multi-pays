import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context)!;
    final s = ref.watch(sessionProvider);
    final screens = visibleScreens(s.modules).toList()..sort();
    return Scaffold(
      appBar: AppBar(title: Text(t.appTitle), actions: [
        IconButton(icon: const Icon(Icons.logout), tooltip: t.signOut, onPressed: () => ref.read(sessionProvider.notifier).signOut()),
      ]),
      body: screens.isEmpty
          ? Center(child: Text(t.noModules))
          : ListView(children: [for (final sc in screens) ListTile(title: Text(sc))]),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';
import 'pedagogy_screens.dart';

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
      floatingActionButton: null,
      bottomNavigationBar: NavigationBar(
        destinations: const [NavigationDestination(icon: Icon(Icons.menu_book), label: 'Cahier'), NavigationDestination(icon: Icon(Icons.class_), label: 'Classes')],
        onDestinationSelected: (i) => Navigator.of(context).push(MaterialPageRoute(builder: (_) => i == 0 ? const LessonsScreen() : const ClassesScreen())),
      ),
    );
  }
}

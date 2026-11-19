import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';
import 'pedagogy_screens.dart';
import 'comms_screens.dart';
import 'oaa_games_screens.dart';

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context)!;
    final s = ref.watch(sessionProvider);
    ref.watch(pushRegistrationProvider);
    final screens = visibleScreens(s.modules).toList()..sort();
    return Scaffold(
      appBar: AppBar(title: Text(t.appTitle), actions: [
        IconButton(icon: const Icon(Icons.logout), tooltip: t.signOut, onPressed: () => ref.read(sessionProvider.notifier).signOut()),
      ]),
      body: screens.isEmpty
          ? Center(child: Text(t.noModules))
          : ListView(children: [
              for (final sc in screens)
                ListTile(
                  title: Text(sc),
                  onTap: () {
                    // Module screens are discovered from /modules/active; only the ones with a native screen navigate.
                    final target = switch (sc) {
                      'gamification_home' || 'quiz_player' => const QuizListScreen(),
                      'leaderboard' => const LeaderboardScreen(),
                      'risk_dashboard' => const RiskDashboardScreen(),
                      _ => null,
                    };
                    if (target != null) Navigator.of(context).push(MaterialPageRoute(builder: (_) => target));
                  },
                ),
            ]),
      floatingActionButton: null,
      bottomNavigationBar: NavigationBar(
        destinations: const [
          NavigationDestination(icon: Icon(Icons.menu_book), label: 'Cahier'),
          NavigationDestination(icon: Icon(Icons.class_), label: 'Classes'),
          NavigationDestination(icon: Icon(Icons.chat), label: 'Messages'),
          NavigationDestination(icon: Icon(Icons.newspaper), label: 'News'),
          NavigationDestination(icon: Icon(Icons.notifications), label: 'Alertes'),
        ],
        onDestinationSelected: (i) => Navigator.of(context).push(MaterialPageRoute(
            builder: (_) => const [LessonsScreen(), ClassesScreen(), ThreadsScreen(), NewsScreen(), NotificationsScreen()][i])),
      ),
    );
  }
}

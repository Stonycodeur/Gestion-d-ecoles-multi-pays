import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/navigation.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';
import 'pedagogy_screens.dart';
import 'school_screens.dart';
import 'comms_screens.dart';
import 'oaa_games_screens.dart';
import 'payment_gps_screens.dart';
import 'account_screen.dart';
import 'ai_xr_screens.dart';
import 'integrations_screens.dart';
import 'orientation_screens.dart';

/// The menu of this person in this school, computed by the API from rights, enabled modules and the school level.
final navigationProvider = FutureProvider.autoDispose<SchoolNav>((ref) async {
  final s = ref.watch(sessionProvider);
  final r = await ref.read(apiProvider).getJson(s.school!, s.token!, '/me/navigation', ref.read(cacheProvider));
  return SchoolNav.fromJson((r.data as Map).cast<String, dynamic>());
});

IconData iconFor(String name) => switch (name) {
      'calendar' => Icons.calendar_month,
      'grades' => Icons.grade,
      'absence' => Icons.event_busy,
      'book' => Icons.menu_book,
      'cap' => Icons.school,
      'folder' => Icons.folder_open,
      'chat' => Icons.chat,
      'news' => Icons.newspaper,
      'bell' => Icons.notifications,
      'target' => Icons.track_changes,
      'game' => Icons.sports_esports,
      'alert' => Icons.warning_amber,
      'compass' => Icons.explore,
      'pin' => Icons.location_on,
      'card' => Icons.payments,
      'bank' => Icons.account_balance,
      'spark' => Icons.auto_awesome,
      'cube' => Icons.view_in_ar,
      'users' => Icons.groups,
      'school' => Icons.school,
      _ => Icons.chevron_right,
    };

/// The native screen behind a page of the menu; null for pages that stay on the web.
Widget? screenFor(String href, SchoolNav nav) => switch (href) {
      '/timetable' => const TimetableScreen(),
      '/grades' => const GradesScreen(),
      '/absences' => const AbsencesScreen(),
      '/lessons' => const LessonsScreen(),
      '/resources' => const ResourcesScreen(),
      '/messages' => const ThreadsScreen(),
      '/news' => const NewsScreen(),
      '/notifications' => const NotificationsScreen(),
      '/oaa' => const OaaPickerScreen(),
      '/play' => const QuizListScreen(),
      '/risk' => const RiskDashboardScreen(),
      '/orientation' => const OrientationScreen(),
      '/gps' => nav.has('gps:report') && !nav.has('gps:read') ? const GpsStudentScreen() : const GpsParentScreen(),
      '/payments' => const PaymentScreen(),
      '/ministry' => const MinistryScreen(),
      '/marketplace' => const MarketplaceScreen(),
      '/assistant' => AssistantScreen(tutor: nav.has('ai:tutor') && !nav.has('ai:use')),
      '/xr' => const XrViewerScreen(),
      '/visitor' => const VisitorApplicationsScreen(),
      '/school/classes' => const ClassesScreen(),
      _ => null,
    };

class HomeScreen extends ConsumerWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final t = AppLocalizations.of(context)!;
    final lang = Localizations.localeOf(context).languageCode == 'fr' ? 'fr' : 'en';
    final fr = lang == 'fr';
    ref.watch(sessionProvider);
    ref.watch(pushRegistrationProvider);
    final nav = ref.watch(navigationProvider);
    void open(Widget w) => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => w));
    return Scaffold(
      appBar: AppBar(title: Text(nav.valueOrNull?.schoolName.isNotEmpty == true ? nav.value!.schoolName : t.appTitle), actions: [
        IconButton(icon: const Icon(Icons.notifications_outlined), tooltip: 'Notifications', onPressed: () => open(const NotificationsScreen())),
        IconButton(icon: const Icon(Icons.settings), tooltip: fr ? 'Paramètres' : 'Settings', onPressed: () => open(const AccountScreen())),
        IconButton(icon: const Icon(Icons.logout), tooltip: t.signOut, onPressed: () => ref.read(sessionProvider.notifier).signOut()),
      ]),
      body: nav.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => ListView(padding: const EdgeInsets.all(24), children: [
          Text(fr ? 'Impossible de charger votre menu.' : 'Your menu could not be loaded.', style: Theme.of(context).textTheme.titleMedium),
          const SizedBox(height: 8),
          Text(fr ? 'Si votre compte est verrouillé ou si un nouveau mot de passe vous est demandé, contactez l’administrateur de votre établissement ou changez-le dans Paramètres.' : 'If your account is locked or a new password is required, contact your school administrator or change it in Settings.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: () => ref.invalidate(navigationProvider), child: Text(fr ? 'Réessayer' : 'Retry')),
        ]),
        data: (n) {
          final webOnly = n.items.where((i) => screenFor(i.href, n) == null).length;
          return RefreshIndicator(
            onRefresh: () async => ref.refresh(navigationProvider.future),
            child: ListView(children: [
              ListTile(title: Text(n.typeLabel(lang), style: Theme.of(context).textTheme.labelLarge), dense: true),
              for (final g in n.groups) ...[
                if (g.items.any((i) => screenFor(i.href, n) != null))
                  Padding(padding: const EdgeInsets.fromLTRB(16, 12, 16, 4), child: Text(g.title(lang), style: Theme.of(context).textTheme.titleSmall)),
                for (final i in g.items)
                  if (screenFor(i.href, n) case final w?) ListTile(leading: Icon(iconFor(i.icon)), title: Text(i.label(lang)), onTap: () => open(w)),
              ],
              if (webOnly > 0) Padding(padding: const EdgeInsets.all(16), child: Text(fr ? '$webOnly page(s) de gestion sont disponibles sur le site web.' : '$webOnly management page(s) are available on the website.', style: Theme.of(context).textTheme.bodySmall)),
            ]),
          );
        },
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'core/session.dart';
import 'features/home_screen.dart';
import 'features/login_screen.dart';
import 'features/welcome_screens.dart';
import 'l10n/app_localizations.dart';

void main() => runApp(const ProviderScope(child: EcoleApp()));

class EcoleApp extends ConsumerStatefulWidget {
  const EcoleApp({super.key});
  @override
  ConsumerState<EcoleApp> createState() => _EcoleAppState();
}

class _EcoleAppState extends ConsumerState<EcoleApp> {
  late final GoRouter _router;

  @override
  void initState() {
    super.initState();
    final auth = ValueNotifier<bool>(false);
    ref.listenManual(sessionProvider, (_, s) => auth.value = s.signedIn);
    _router = GoRouter(
      refreshListenable: auth,
      redirect: (c, st) {
        final signedIn = ref.read(sessionProvider).signedIn;
        final open = st.matchedLocation == '/login' || st.matchedLocation == '/welcome';
        if (!signedIn && !open) return '/welcome';
        if (signedIn && open) return '/';
        return null;
      },
      routes: [
        GoRoute(path: '/', builder: (c, s) => const HomeScreen()),
        GoRoute(path: '/welcome', builder: (c, s) => const WelcomeScreen()),
        GoRoute(path: '/login', builder: (c, s) => LoginScreen(school: s.uri.queryParameters['school'])),
      ],
    );
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        routerConfig: _router,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales, // fr, en, ar (RTL via Directionality)
        theme: ThemeData(colorSchemeSeed: const Color(0xFF0B5CAB), useMaterial3: true),
        darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF0B5CAB), brightness: Brightness.dark, useMaterial3: true),
      );
}

import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'l10n/app_localizations.dart';

void main() => runApp(const ProviderScope(child: EcoleApp()));

final _router = GoRouter(routes: [
  GoRoute(path: '/', builder: (c, s) => const HomeScreen()),
]);

class EcoleApp extends StatelessWidget {
  const EcoleApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp.router(
        routerConfig: _router,
        localizationsDelegates: const [
          AppLocalizations.delegate,
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: AppLocalizations.supportedLocales, // fr, en, ar (RTL handled by Directionality)
        theme: ThemeData(colorSchemeSeed: const Color(0xFF0B5CAB), useMaterial3: true),
        darkTheme: ThemeData(colorSchemeSeed: const Color(0xFF0B5CAB), brightness: Brightness.dark, useMaterial3: true),
      );
}

class HomeScreen extends StatelessWidget {
  const HomeScreen({super.key});
  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context)!;
    return Scaffold(appBar: AppBar(title: Text(t.appTitle)), body: Center(child: Text(t.welcome)));
  }
}

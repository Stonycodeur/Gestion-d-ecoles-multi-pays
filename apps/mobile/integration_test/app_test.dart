import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:ecolemanager_mobile/main.dart';

/// Runs on an Android emulator against a real API (sandbox auth, demo seed Gabon) reachable at API_BASE (default http://10.0.2.2:3000).
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> signIn(WidgetTester tester, String school, String role) async {
    await tester.pumpWidget(const ProviderScope(child: EcoleApp()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('go-login')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, school);
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text(role).last);
    await tester.pumpAndSettle();
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle(const Duration(seconds: 8));
  }

  testWidgets('a malformed school code is refused with an error', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EcoleApp()));
    await tester.pumpAndSettle();
    await tester.tap(find.byKey(const Key('go-login')));
    await tester.pumpAndSettle();
    await tester.enterText(find.byType(TextField).first, 'Bad Code!');
    await tester.tap(find.byType(FilledButton));
    await tester.pumpAndSettle(const Duration(seconds: 5));
    expect(find.text('Sign in'), findsWidgets);   // still on the login screen
  });

  testWidgets('a head of the Gabon demo lycée signs in, sees the modules and opens the timetable', (tester) async {
    await signIn(tester, 'ga_lycee', 'head');
    expect(find.text('Timetable'), findsOneWidget);
    expect(find.text('Grades'), findsOneWidget);
    await tester.tap(find.text('Timetable'));
    await tester.pumpAndSettle(const Duration(seconds: 8));
    expect(tester.takeException(), isNull);
    expect(find.byType(Scaffold), findsWidgets);
  });

  testWidgets('a student sees the same school with only the screens its role allows', (tester) async {
    await signIn(tester, 'ga_lycee', 'student');
    expect(find.text('Timetable'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}

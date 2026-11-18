import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ecolemanager_mobile/main.dart';

void main() {
  testWidgets('unauthenticated user lands on the login screen', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EcoleApp()));
    await tester.pumpAndSettle();
    expect(find.text('Code établissement'), findsOneWidget);
    expect(find.text('Se connecter'), findsOneWidget);
  });
}

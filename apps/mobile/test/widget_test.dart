import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ecolemanager_mobile/main.dart';

void main() {
  testWidgets('unauthenticated user lands on the public home, and reaches the login screen from it', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EcoleApp()));
    await tester.pumpAndSettle();
    expect(find.text('Find your school'), findsOneWidget);
    await tester.tap(find.byKey(const Key('go-login')));
    await tester.pumpAndSettle();
    expect(find.text('School code'), findsOneWidget);
    expect(find.text('Sign in'), findsOneWidget);
  });
}

import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:ecolemanager_mobile/main.dart';

void main() {
  testWidgets('app starts and shows the title', (tester) async {
    await tester.pumpWidget(const ProviderScope(child: EcoleApp()));
    await tester.pumpAndSettle();
    expect(find.text('ÉcoleManager Pro'), findsOneWidget);
  });
}

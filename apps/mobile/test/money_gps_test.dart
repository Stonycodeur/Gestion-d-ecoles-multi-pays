import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/gps_tracker.dart';
import 'package:ecolemanager_mobile/core/money.dart';

void main() {
  test('currency decimals come from the currency', () {
    expect(minorDigits('XAF'), 0);
    expect(minorDigits('EUR'), 2);
    expect(formatMoney(150000, 'XAF').replaceAll(RegExp(r'\s'), ''), contains('150000'));
    expect(formatMoney(1250, 'EUR', locale: 'en'), contains('12.50'));
  });

  test('positions are sent every 30 s at most', () {
    final t0 = DateTime(2026, 11, 19, 8, 0, 0);
    expect(shouldSend(null, t0, 30), isTrue);
    expect(shouldSend(t0, t0.add(const Duration(seconds: 10)), 30), isFalse);
    expect(shouldSend(t0, t0.add(const Duration(seconds: 30)), 30), isTrue);
  });
}

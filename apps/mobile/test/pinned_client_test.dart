import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/pinned_client.dart';

void main() {
  test('no pin configured: platform trust store (development)', () {
    expect(pinnedContext(''), isNull);
  });
  test('an unreadable pin bundle fails closed instead of falling back to system roots', () {
    expect(() => pinnedContext(base64.encode(utf8.encode('not a certificate'))), throwsFormatException);
  });
}

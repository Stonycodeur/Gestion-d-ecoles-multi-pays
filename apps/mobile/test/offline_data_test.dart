import 'dart:convert';
import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/oidc_auth.dart';
import 'package:ecolemanager_mobile/core/offline_data.dart';
import 'package:ecolemanager_mobile/core/token_store.dart';

String jwt(Map<String, dynamic> claims) {
  String enc(String s) => base64Url.encode(utf8.encode(s)).replaceAll('=', '');
  return 'h.${enc(jsonEncode(claims))}.s';
}

void main() {
  test('sign-out purges cached answers and credentials but keeps unsent writes', () async {
    final s = MemoryTokenStore();
    await s.write('cache:/grades', '[]');
    await s.write('token', 't');
    await s.write('refresh', 'r');
    await s.write('queue', '[{"id":"1"}]');
    await s.write('conflicts', '[]');
    await s.write('owner', 'ga_lycee|u1');
    await OfflineData.onSignOut(s);
    expect(await s.read('cache:/grades'), isNull);
    expect(await s.read('token'), isNull);
    expect(await s.read('refresh'), isNull);
    expect(await s.read('queue'), isNotNull);
    expect(await s.read('owner'), 'ga_lycee|u1');
  });

  test('the same user signing in again gets the queue back', () async {
    final s = MemoryTokenStore();
    await s.write('owner', 'ga_lycee|u1');
    await s.write('queue', '[{"id":"1"}]');
    await OfflineData.onSignIn(s, 'ga_lycee|u1');
    expect(await s.read('queue'), isNotNull);
  });

  test("somebody else signing in never sees or replays the previous user's data", () async {
    final s = MemoryTokenStore();
    await s.write('owner', 'ga_lycee|u1');
    await s.write('queue', '[{"id":"1"}]');
    await s.write('conflicts', '[{"x":1}]');
    await s.write('cache:/messages', '[]');
    await OfflineData.onSignIn(s, 'ga_lycee|u2');
    expect(await s.read('queue'), isNull);
    expect(await s.read('conflicts'), isNull);
    expect(await s.read('cache:/messages'), isNull);
    expect(await s.read('owner'), 'ga_lycee|u2');
  });

  test('auth config: sandbox exposes nothing, oidc exposes the public mobile client', () {
    expect(AuthConfig.fromJson({'mode': 'sandbox'}).isOidc, isFalse);
    final c = AuthConfig.fromJson({
      'mode': 'oidc', 'authorization_endpoint': 'https://sso/auth', 'token_endpoint': 'https://sso/token',
      'clients': {'web': 'w', 'mobile': 'ecolemanager-mobile'}, 'mobile_redirect_uri': 'com.ecolemanager.pro:/oauthredirect', 'scopes': 'openid email'
    });
    expect(c.isOidc, isTrue);
    expect(c.clientId, 'ecolemanager-mobile');
    expect(c.scopes, ['openid', 'email']);
  });

  test('the school comes from the token claim; refresh is scheduled 60 s before expiry', () {
    expect(tenantFromToken(jwt({'tenant': 'ga_college', 'sub': 'u'})), 'ga_college');
    expect(tenantFromToken('garbage'), isNull);
    final now = DateTime(2026, 1, 1, 10);
    expect(refreshDelay(now.add(const Duration(minutes: 5)), now), const Duration(minutes: 4));
    expect(refreshDelay(now.add(const Duration(seconds: 10)), now), Duration.zero);
    expect(refreshDelay(null, now), const Duration(minutes: 4));
  });
}

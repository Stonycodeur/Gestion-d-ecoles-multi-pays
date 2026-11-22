import 'dart:convert';
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:http/http.dart' as http;
import 'pinned_client.dart';

/// Public sign-in configuration served by the API (`GET /auth/config`). Contains no secret: the mobile client is a public PKCE client.
class AuthConfig {
  final String mode; // 'sandbox' | 'oidc'
  final String? authorizationEndpoint, tokenEndpoint, endSessionEndpoint, clientId, redirectUri;
  final List<String> scopes;
  const AuthConfig(this.mode, {this.authorizationEndpoint, this.tokenEndpoint, this.endSessionEndpoint, this.clientId, this.redirectUri, this.scopes = const ['openid', 'profile', 'email', 'offline_access']});
  bool get isOidc => mode == 'oidc';

  factory AuthConfig.fromJson(Map<String, dynamic> j) {
    if (j['mode'] != 'oidc') return const AuthConfig('sandbox');
    final clients = (j['clients'] as Map?)?.cast<String, dynamic>() ?? const {};
    return AuthConfig('oidc',
        authorizationEndpoint: j['authorization_endpoint'] as String?,
        tokenEndpoint: j['token_endpoint'] as String?,
        endSessionEndpoint: j['end_session_endpoint'] as String?,
        clientId: clients['mobile'] as String?,
        redirectUri: j['mobile_redirect_uri'] as String?,
        scopes: ((j['scopes'] as String?) ?? 'openid profile email offline_access').split(' '));
  }
}

class OidcTokens {
  final String accessToken;
  final String? refreshToken, idToken;
  final DateTime? expiresAt;
  const OidcTokens(this.accessToken, {this.refreshToken, this.idToken, this.expiresAt});
}

/// Claims of an access token for display/routing only (the API verifies the signature on every request).
Map<String, dynamic> jwtClaims(String jwt) {
  try {
    final p = jwt.split('.')[1];
    return jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(p)))) as Map<String, dynamic>;
  } catch (_) {
    return {};
  }
}

/// The school (tenant) comes from the token, never from what the user typed.
String? tenantFromToken(String jwt) => jwtClaims(jwt)['tenant'] as String?;

/// Seconds to wait before renewing: 60 s before expiry, never negative.
Duration refreshDelay(DateTime? expiresAt, DateTime now) {
  if (expiresAt == null) return const Duration(minutes: 4);
  final d = expiresAt.difference(now) - const Duration(seconds: 60);
  return d.isNegative ? Duration.zero : d;
}

class OidcAuth {
  final FlutterAppAuth _a;
  final http.Client _c;
  OidcAuth({FlutterAppAuth? appAuth, http.Client? client}) : _a = appAuth ?? const FlutterAppAuth(), _c = client ?? buildHttpClient();

  Future<AuthConfig> fetchConfig(String apiBase) async {
    final r = await _c.get(Uri.parse('$apiBase/auth/config'));
    if (r.statusCode >= 300) throw Exception('auth config unavailable (${r.statusCode})');
    return AuthConfig.fromJson(jsonDecode(r.body) as Map<String, dynamic>);
  }

  AuthorizationServiceConfiguration _svc(AuthConfig c) =>
      AuthorizationServiceConfiguration(authorizationEndpoint: c.authorizationEndpoint!, tokenEndpoint: c.tokenEndpoint!, endSessionEndpoint: c.endSessionEndpoint);

  /// Authorization code + PKCE (S256) in the system browser, through AppAuth (iOS) / AppAuth-Android.
  Future<OidcTokens?> signIn(AuthConfig c, {String? locale}) async {
    final r = await _a.authorizeAndExchangeCode(AuthorizationTokenRequest(c.clientId!, c.redirectUri!,
        serviceConfiguration: _svc(c), scopes: c.scopes, additionalParameters: {if (locale != null) 'kc_locale': locale}));
    if (r.accessToken == null) return null;
    return OidcTokens(r.accessToken!, refreshToken: r.refreshToken, idToken: r.idToken, expiresAt: r.accessTokenExpirationDateTime);
  }

  /// Silent renewal. Returns null when the refresh token is no longer accepted (the user must sign in again).
  Future<OidcTokens?> refresh(AuthConfig c, String refreshToken) async {
    try {
      final r = await _a.token(TokenRequest(c.clientId!, c.redirectUri!, serviceConfiguration: _svc(c), refreshToken: refreshToken, scopes: c.scopes));
      if (r.accessToken == null) return null;
      return OidcTokens(r.accessToken!, refreshToken: r.refreshToken ?? refreshToken, idToken: r.idToken, expiresAt: r.accessTokenExpirationDateTime);
    } catch (_) {
      return null;
    }
  }

  Future<void> signOut(AuthConfig c, String? idToken) async {
    if (c.endSessionEndpoint == null || idToken == null) return;
    try {
      await _a.endSession(EndSessionRequest(idTokenHint: idToken, postLogoutRedirectUrl: c.redirectUri, serviceConfiguration: _svc(c)));
    } catch (_) {/* user closed the browser: local sign-out still happens */}
  }
}

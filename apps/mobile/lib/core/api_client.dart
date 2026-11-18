import 'dart:convert';
import 'package:http/http.dart' as http;
import 'models.dart';

const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');

class ApiClient {
  final http.Client _c;
  ApiClient([http.Client? c]) : _c = c ?? http.Client();

  Map<String, String> _h(String school, String? token) => {
        'content-type': 'application/json',
        'x-tenant': school, // school code typed at login; the API checks it against the token
        if (token != null) 'authorization': 'Bearer $token',
      };

  /// Sandbox sign-in (real deployments: OIDC + PKCE through Keycloak, configured in Phase 1 live mode).
  Future<String> sandboxLogin(String school, String role) async {
    final r = await _c.post(Uri.parse('$apiBase/auth/sandbox/token'),
        headers: _h(school, null), body: jsonEncode({'sub': 'mobile-$role', 'role': role, 'tenant': school}));
    if (r.statusCode >= 300) throw Exception('login failed (${r.statusCode})');
    return (jsonDecode(r.body) as Map<String, dynamic>)['access_token'] as String;
  }

  Future<List<ActiveModule>> activeModules(String school, String token) async {
    final r = await _c.get(Uri.parse('$apiBase/modules/active'), headers: _h(school, token));
    if (r.statusCode >= 300) throw Exception('modules failed (${r.statusCode})');
    return (jsonDecode(r.body) as List).map((e) => ActiveModule.fromJson(e as Map<String, dynamic>)).toList();
  }
}

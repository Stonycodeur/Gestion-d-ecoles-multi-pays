import 'dart:typed_data';
import 'dart:convert';
import 'package:http/http.dart' as http;
import 'pinned_client.dart';
import 'json_cache.dart';
import 'models.dart';
import 'offline_queue.dart';

const apiBase = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');

class ApiClient {
  final http.Client _c;
  ApiClient([http.Client? c]) : _c = c ?? buildHttpClient();

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

  /// GET with offline fallback to the cache. Returns decoded JSON and whether it came from the cache.
  Future<({dynamic data, bool fromCache})> getJson(String school, String token, String path, JsonCache cache) async {
    try {
      final r = await _c.get(Uri.parse('$apiBase$path'), headers: _h(school, token));
      if (r.statusCode >= 300) throw Exception('GET $path failed (${r.statusCode})');
      await cache.put(path, r.body);
      return (data: jsonDecode(r.body), fromCache: false);
    } on http.ClientException {
      final c = await cache.get(path);
      if (c == null) rethrow;
      return (data: jsonDecode(c), fromCache: true);
    }
  }

  /// Write: sent now, or queued when offline. `priority` > 0 for teacher grade entries.
  Future<bool> post(String school, String token, String path, Map<String, dynamic> body, OfflineQueue queue, {int priority = 0}) async {
    final key = OfflineQueue.newKey();   // same Idempotency-Key for the first attempt and the queued replay
    try {
      final r = await _c.post(Uri.parse('$apiBase$path'), headers: {..._h(school, token), 'idempotency-key': key}, body: jsonEncode(body));
      if (r.statusCode >= 300) throw Exception('POST $path failed (${r.statusCode})');
      return false;
    } on http.ClientException {
      await queue.enqueue('POST', path, body, priority: priority, id: key);
      return true; // queued
    }
  }

  /// Online-only write that returns the decoded body (quizzes: never queued, the server enforces timing).
  Future<dynamic> postOnline(String school, String token, String path, Map<String, dynamic> body, {Map<String, String> extraHeaders = const {}}) async {
    final r = await _c.post(Uri.parse('$apiBase$path'), headers: {..._h(school, token), ...extraHeaders}, body: jsonEncode(body));
    if (r.statusCode >= 300) throw Exception('POST $path failed (${r.statusCode}): ${r.body}');
    return jsonDecode(r.body);
  }

  /// Online PUT returning the decoded body (settings such as notification channels): never queued.
  Future<dynamic> putOnline(String school, String token, String path, Map<String, dynamic> body) async {
    final r = await _c.put(Uri.parse('$apiBase$path'), headers: _h(school, token), body: jsonEncode(body));
    if (r.statusCode >= 300) throw Exception('PUT $path failed (${r.statusCode}): ${r.body}');
    return jsonDecode(r.body);
  }

  /// Online DELETE with a JSON body (account deletion): never queued.
  Future<dynamic> deleteOnline(String school, String token, String path, Map<String, dynamic> body) async {
    final req = http.Request('DELETE', Uri.parse('$apiBase$path'))..headers.addAll(_h(school, token))..body = jsonEncode(body);
    final r = await http.Response.fromStream(await _c.send(req));
    if (r.statusCode >= 300) throw Exception('DELETE $path failed (${r.statusCode}): ${r.body}');
    return jsonDecode(r.body);
  }

  /// Online GET returning the decoded JSON object (no cache: used for live values such as the GPS policy).
  Future<Map<String, dynamic>> getRaw(String school, String token, String path) async {
    final r = await _c.get(Uri.parse('$apiBase$path'), headers: _h(school, token));
    if (r.statusCode >= 300) throw Exception('GET $path failed (${r.statusCode})');
    return jsonDecode(r.body) as Map<String, dynamic>;
  }

  /// Online download of a binary resource (lesson attachment); the bearer token cannot be sent by a plain link.
  Future<({Uint8List bytes, String contentType})> getBytes(String school, String token, String path) async {
    final r = await _c.get(Uri.parse('$apiBase$path'), headers: _h(school, token));
    if (r.statusCode >= 300) throw Exception('GET $path failed (${r.statusCode})');
    return (bytes: r.bodyBytes, contentType: r.headers['content-type'] ?? 'application/octet-stream');
  }

  Future<int> replay(String school, String token, QueuedOp op) async {
    final r = await _c.post(Uri.parse('$apiBase${op.path}'), headers: {..._h(school, token), 'idempotency-key': op.id}, body: jsonEncode(op.body));
    return r.statusCode;
  }

  Future<List<ActiveModule>> activeModules(String school, String token) async {
    final r = await _c.get(Uri.parse('$apiBase/modules/active'), headers: _h(school, token));
    if (r.statusCode >= 300) throw Exception('modules failed (${r.statusCode})');
    return (jsonDecode(r.body) as List).map((e) => ActiveModule.fromJson(e as Map<String, dynamic>)).toList();
  }
}

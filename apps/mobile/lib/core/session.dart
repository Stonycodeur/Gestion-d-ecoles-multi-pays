import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:path_provider/path_provider.dart';
import 'encrypted_store.dart';
import 'api_client.dart';
import 'models.dart';
import 'offline_data.dart';
import 'oidc_auth.dart';
import 'token_store.dart';

/// Credentials in Keychain/Keystore, offline data (cache, write queue, conflict journal) in the AES-GCM encrypted database.
/// The directory is resolved lazily: the first operation awaits it.
final tokenStoreProvider = Provider<TokenStore>((_) => HybridTokenStore(SecureTokenStore(), _LazyEncryptedStore()));

class _LazyEncryptedStore implements TokenStore {
  EncryptedFileStore? _s;
  Future<EncryptedFileStore> _open() async => _s ??= EncryptedFileStore(await getApplicationSupportDirectory(), EncryptedFileStore.secureKey);
  @override
  Future<String?> read(String key) async => (await _open()).read(key);
  @override
  Future<void> write(String key, String value) async => (await _open()).write(key, value);
  @override
  Future<void> clear() async => (await _open()).clear();
  @override
  Future<void> deleteWhere(bool Function(String key) test) async => (await _open()).deleteWhere(test);
}
final apiProvider = Provider<ApiClient>((_) => ApiClient());
final oidcProvider = Provider<OidcAuth>((_) => OidcAuth());

class Session {
  final String? school;
  final String? token;
  final List<ActiveModule> modules;
  const Session({this.school, this.token, this.modules = const []});
  bool get signedIn => token != null && school != null;
}

class SessionNotifier extends StateNotifier<Session> {
  final Ref _ref;
  SessionNotifier(this._ref) : super(const Session());
  Timer? _timer;
  AuthConfig? _cfg;

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  Future<AuthConfig> _config() async => _cfg ??= await _ref.read(oidcProvider).fetchConfig(apiBase);

  Future<void> restore() async {
    final store = _ref.read(tokenStoreProvider);
    final school = await store.read('school');
    var token = await store.read('token');
    if (school == null || token == null) return;
    final exp = DateTime.tryParse(await store.read('exp') ?? '');
    final refresh = await store.read('refresh');
    if (exp != null && exp.isBefore(DateTime.now().add(const Duration(seconds: 30))) && refresh != null) {
      final ok = await _renew(school); // offline: keep the stale token, the app still works from its cache and queue
      if (ok) return;
    }
    state = Session(school: school, token: token);
    _schedule(exp);
  }

  Future<void> signIn(String school, String role) async {
    final api = _ref.read(apiProvider);
    final store = _ref.read(tokenStoreProvider);
    var s = school.trim().toLowerCase();
    final cfg = await _config();
    String token;
    if (cfg.isOidc) {
      final t = await _ref.read(oidcProvider).signIn(cfg);
      if (t == null) throw Exception('sign-in cancelled');
      token = t.accessToken;
      s = tenantFromToken(token) ?? s; // the school comes from the token, not from the typed code
      await OfflineData.onSignIn(store, '$s|${jwtClaims(token)['sub']}');
      await _persist(s, t);
      _schedule(t.expiresAt);
    } else {
      token = await api.sandboxLogin(s, role);
      await OfflineData.onSignIn(store, '$s|mobile-$role');
      await store.write('school', s);
      await store.write('token', token);
    }
    final mods = await api.activeModules(s, token);
    state = Session(school: s, token: token, modules: mods);
  }

  Future<void> _persist(String school, OidcTokens t) async {
    final store = _ref.read(tokenStoreProvider);
    await store.write('school', school);
    await store.write('token', t.accessToken);
    if (t.refreshToken != null) await store.write('refresh', t.refreshToken!);
    if (t.idToken != null) await store.write('id_token', t.idToken!);
    if (t.expiresAt != null) await store.write('exp', t.expiresAt!.toIso8601String());
  }

  void _schedule(DateTime? exp) {
    _timer?.cancel();
    if (_cfg?.isOidc != true) return;
    _timer = Timer(refreshDelay(exp, DateTime.now()), () async {
      final school = state.school;
      if (school != null) await _renew(school);
    });
  }

  /// Silent renewal. On refusal the session ends (the user signs in again); unsent writes and cached data stay for the same user.
  Future<bool> _renew(String school) async {
    final store = _ref.read(tokenStoreProvider);
    try {
      final cfg = await _config();
      final rt = await store.read('refresh');
      if (!cfg.isOidc || rt == null) return false;
      final t = await _ref.read(oidcProvider).refresh(cfg, rt);
      if (t == null) {
        await store.deleteWhere((k) => const {'token', 'refresh', 'exp'}.contains(k));
        state = const Session();
        return true;
      }
      await _persist(school, t);
      state = Session(school: school, token: t.accessToken, modules: state.modules);
      _schedule(t.expiresAt);
      return true;
    } catch (_) {
      return false; // offline: try again at the next call
    }
  }

  Future<void> signOut() async {
    _timer?.cancel();
    final store = _ref.read(tokenStoreProvider);
    if (_cfg?.isOidc == true) await _ref.read(oidcProvider).signOut(_cfg!, await store.read('id_token'));
    await OfflineData.onSignOut(store); // unsent writes are kept (same user, next sign-in); cached answers are purged
    state = const Session();
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, Session>((ref) => SessionNotifier(ref));

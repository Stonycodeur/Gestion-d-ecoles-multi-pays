import 'token_store.dart';

/// Offline data belongs to one user. Sign-out purges the cached answers (grades, messages…) but keeps unsent writes; signing in as somebody else
/// purges those as well, so a shared device never shows or replays another person's data.
class OfflineData {
  static bool _isCache(String k) => k.startsWith('cache:');
  static const _authKeys = {'school', 'token', 'refresh', 'id_token', 'exp'};

  static Future<void> onSignOut(TokenStore s) async {
    await s.deleteWhere((k) => _isCache(k) || _authKeys.contains(k));
  }

  static Future<void> onSignIn(TokenStore s, String owner) async {
    final prev = await s.read('owner');
    if (prev != null && prev != owner) {
      await s.deleteWhere((k) => _isCache(k) || k == 'queue' || k == 'conflicts');
    }
    await s.write('owner', owner);
  }
}

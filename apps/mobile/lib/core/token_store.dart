import 'package:flutter_secure_storage/flutter_secure_storage.dart';

abstract class TokenStore {
  Future<String?> read(String key);
  Future<void> write(String key, String value);
  Future<void> clear();
}

/// Keychain (iOS) / Keystore (Android) backed storage.
class SecureTokenStore implements TokenStore {
  final FlutterSecureStorage _s = const FlutterSecureStorage();
  @override
  Future<String?> read(String key) => _s.read(key: key);
  @override
  Future<void> write(String key, String value) => _s.write(key: key, value: value);
  @override
  Future<void> clear() => _s.deleteAll();
}

class MemoryTokenStore implements TokenStore {
  final Map<String, String> _m = {};
  @override
  Future<String?> read(String key) async => _m[key];
  @override
  Future<void> write(String key, String value) async => _m[key] = value;
  @override
  Future<void> clear() async => _m.clear();
}

import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';
import 'package:cryptography/cryptography.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'token_store.dart';

/// Encrypted local database for offline data (spec 4.2, 12.4): cached answers, the write queue and the conflict journal.
/// AES-256-GCM over one JSON document; the key lives in the Keychain/Keystore, the file in the app's private storage.
/// Writes are atomic (temp file + rename) and serialized; a corrupted or foreign file is treated as empty instead of crashing the app.
class EncryptedFileStore implements TokenStore {
  final File _file;
  final Future<List<int>> Function() _keyProvider;
  final AesGcm _aes = AesGcm.with256bits();
  Map<String, String>? _data;
  Future<void> _lock = Future.value();

  EncryptedFileStore(Directory dir, this._keyProvider, {String name = 'em_offline.bin'}) : _file = File('${dir.path}/$name');

  /// 32 random bytes generated once and kept in the platform secure storage.
  static Future<List<int>> secureKey([FlutterSecureStorage s = const FlutterSecureStorage()]) async {
    final existing = await s.read(key: 'offline_db_key');
    if (existing != null) return base64.decode(existing);
    final r = Random.secure();
    final k = List<int>.generate(32, (_) => r.nextInt(256));
    await s.write(key: 'offline_db_key', value: base64.encode(k));
    return k;
  }

  Future<Map<String, String>> _load() async {
    if (_data != null) return _data!;
    try {
      if (await _file.exists()) {
        final b = await _file.readAsBytes();
        if (b.length > 28) {
          final box = SecretBox(b.sublist(12, b.length - 16), nonce: b.sublist(0, 12), mac: Mac(b.sublist(b.length - 16)));
          final plain = await _aes.decrypt(box, secretKey: SecretKey(await _keyProvider()));
          return _data = (jsonDecode(utf8.decode(plain)) as Map).cast<String, String>();
        }
      }
    } catch (_) {/* wrong key or tampered file: start empty */}
    return _data = {};
  }

  Future<void> _save() async {
    final key = SecretKey(await _keyProvider());
    final box = await _aes.encrypt(utf8.encode(jsonEncode(_data)), secretKey: key);
    final tmp = File('${_file.path}.tmp');
    await tmp.writeAsBytes([...box.nonce, ...box.cipherText, ...box.mac.bytes], flush: true);
    await tmp.rename(_file.path);
  }

  Future<T> _sync<T>(Future<T> Function() f) {
    final run = _lock.then((_) => f());
    _lock = run.then((_) {}, onError: (_) {});
    return run;
  }

  @override
  Future<String?> read(String key) => _sync(() async => (await _load())[key]);
  @override
  Future<void> write(String key, String value) => _sync(() async { (await _load())[key] = value; await _save(); });
  @override
  Future<void> clear() => _sync(() async { _data = {}; if (await _file.exists()) await _file.delete(); });
  @override
  Future<void> deleteWhere(bool Function(String key) test) => _sync(() async { (await _load()).removeWhere((k, _) => test(k)); await _save(); });
}

/// Credentials stay in the Keychain/Keystore; bulk offline data goes to the encrypted database.
class HybridTokenStore implements TokenStore {
  final TokenStore secure, bulk;
  HybridTokenStore(this.secure, this.bulk);
  static bool isBulk(String k) => k.startsWith('cache:') || k == 'queue' || k == 'conflicts';
  TokenStore _for(String k) => isBulk(k) ? bulk : secure;
  @override
  Future<String?> read(String key) => _for(key).read(key);
  @override
  Future<void> write(String key, String value) => _for(key).write(key, value);
  @override
  Future<void> clear() async { await secure.clear(); await bulk.clear(); }
  @override
  Future<void> deleteWhere(bool Function(String key) test) async { await secure.deleteWhere(test); await bulk.deleteWhere(test); }
}

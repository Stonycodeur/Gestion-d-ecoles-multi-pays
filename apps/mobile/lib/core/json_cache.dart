import 'token_store.dart';

/// Last good answer per endpoint, shown when the device is offline.
class JsonCache {
  final TokenStore _s;
  JsonCache(this._s);
  Future<void> put(String path, String body) => _s.write('cache:$path', body);
  Future<String?> get(String path) => _s.read('cache:$path');
}

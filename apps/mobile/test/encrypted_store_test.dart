import 'dart:io';
import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/encrypted_store.dart';
import 'package:ecolemanager_mobile/core/token_store.dart';

void main() {
  late Directory dir;
  final key = List<int>.generate(32, (i) => i + 1);
  setUp(() => dir = Directory.systemTemp.createTempSync('em_store'));
  tearDown(() => dir.deleteSync(recursive: true));

  test('round trip survives a restart and nothing is readable on disk', () async {
    final a = EncryptedFileStore(dir, () async => key);
    await a.write('queue', '[{"path":"/grades","note":"secret-grade-17"}]');
    await a.write('cache:/students', 'Ada Obiang');
    final raw = File('${dir.path}/em_offline.bin').readAsBytesSync();
    final text = String.fromCharCodes(raw);
    expect(text.contains('secret-grade-17'), isFalse);
    expect(text.contains('Ada Obiang'), isFalse);
    final b = EncryptedFileStore(dir, () async => key); // new instance = app restart
    expect(await b.read('queue'), contains('secret-grade-17'));
    expect(await b.read('cache:/students'), 'Ada Obiang');
  });

  test('wrong key or tampered file never crashes: the store starts empty', () async {
    final a = EncryptedFileStore(dir, () async => key);
    await a.write('k', 'v');
    final other = EncryptedFileStore(dir, () async => List<int>.filled(32, 9));
    expect(await other.read('k'), isNull);
    final f = File('${dir.path}/em_offline.bin');
    final bytes = f.readAsBytesSync();
    bytes[bytes.length ~/ 2] ^= 0xFF;
    f.writeAsBytesSync(bytes);
    final c = EncryptedFileStore(dir, () async => key);
    expect(await c.read('k'), isNull);
    await c.write('k2', 'v2'); // and it is usable again
    expect(await c.read('k2'), 'v2');
  });

  test('concurrent writes are serialized and none is lost; deleteWhere and clear work', () async {
    final s = EncryptedFileStore(dir, () async => key);
    await Future.wait([for (var i = 0; i < 25; i++) s.write('cache:$i', 'v$i')]);
    final again = EncryptedFileStore(dir, () async => key);
    for (var i = 0; i < 25; i++) {
      expect(await again.read('cache:$i'), 'v$i');
    }
    await again.deleteWhere((k) => k.startsWith('cache:1'));
    expect(await again.read('cache:10'), isNull);
    expect(await again.read('cache:2'), 'v2');
    await again.clear();
    expect(await EncryptedFileStore(dir, () async => key).read('cache:2'), isNull);
  });

  test('hybrid store keeps credentials in the secure store and offline data in the encrypted one', () async {
    final secure = MemoryTokenStore(), bulk = MemoryTokenStore();
    final h = HybridTokenStore(secure, bulk);
    await h.write('token', 't');
    await h.write('queue', 'q');
    await h.write('cache:/x', 'c');
    await h.write('conflicts', 'j');
    expect(await secure.read('token'), 't');
    expect(await secure.read('queue'), isNull);
    expect(await bulk.read('queue'), 'q');
    expect(await bulk.read('cache:/x'), 'c');
    await h.deleteWhere((k) => k == 'queue' || k == 'token');
    expect(await bulk.read('queue'), isNull);
    expect(await secure.read('token'), isNull);
  });
}

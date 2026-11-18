import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/offline_queue.dart';
import 'package:ecolemanager_mobile/core/token_store.dart';

void main() {
  test('writes made offline are replayed in order, teacher grades first', () async {
    final q = OfflineQueue(MemoryTokenStore());
    await q.enqueue('POST', '/absences', {'a': 1});
    await q.enqueue('POST', '/evaluations/1/grades', {'g': 1}, priority: 10);
    await q.enqueue('POST', '/lessons', {'l': 1});
    final seen = <String>[];
    final r = await q.flush((op) async { seen.add(op.path); return 201; });
    expect(seen, ['/evaluations/1/grades', '/absences', '/lessons']);
    expect(r.sent, 3);
    expect(r.remaining, 0);
    expect(await q.pending(), isEmpty);
  });

  test('still offline: nothing is lost and order is kept', () async {
    final q = OfflineQueue(MemoryTokenStore());
    await q.enqueue('POST', '/a', {});
    await q.enqueue('POST', '/b', {});
    final r = await q.flush((op) async => throw Exception('offline'));
    expect(r.sent, 0);
    expect(r.remaining, 2);
    expect((await q.pending()).map((o) => o.path), ['/a', '/b']);
  });

  test('server conflicts (4xx) leave the queue and go to the conflict journal', () async {
    final q = OfflineQueue(MemoryTokenStore());
    await q.enqueue('POST', '/ok', {});
    await q.enqueue('POST', '/clash', {});
    final r = await q.flush((op) async => op.path == '/clash' ? 409 : 201);
    expect(r.sent, 1);
    expect(r.conflicts, 1);
    expect(r.remaining, 0);
    final j = await q.conflicts();
    expect(j.length, 1);
    expect(j.first['status'], 409);
  });

  test('partial progress is persisted when the connection drops midway', () async {
    final q = OfflineQueue(MemoryTokenStore());
    for (final p in ['/1', '/2', '/3']) { await q.enqueue('POST', p, {}); }
    var n = 0;
    final r = await q.flush((op) async { if (n++ == 1) throw Exception('drop'); return 201; });
    expect(r.sent, 1);
    expect((await q.pending()).map((o) => o.path), ['/2', '/3']);
  });
}

import 'dart:convert';
import 'token_store.dart';

class QueuedOp {
  final String id, method, path, at;
  final Map<String, dynamic>? body;
  /// Teacher grade entries are replayed first (spec 12.4: teacher input has priority).
  final int priority;
  const QueuedOp(this.id, this.method, this.path, this.body, this.at, {this.priority = 0});
  Map<String, dynamic> toJson() => {'id': id, 'method': method, 'path': path, 'body': body, 'at': at, 'priority': priority};
  factory QueuedOp.fromJson(Map<String, dynamic> j) => QueuedOp(j['id'] as String, j['method'] as String, j['path'] as String,
      (j['body'] as Map?)?.cast<String, dynamic>(), j['at'] as String, priority: (j['priority'] as num?)?.toInt() ?? 0);
}

class ConflictEntry {
  final QueuedOp op;
  final int status;
  final String message;
  const ConflictEntry(this.op, this.status, this.message);
}

/// Result of sending one op: HTTP status, or throws when offline.
typedef Sender = Future<int> Function(QueuedOp op);

/// Mirrors `classifyReplay` of packages/shared/src/offline.ts. Transient failures keep the write queued; only definitive refusals are conflicts.
enum ReplayVerdict { done, retry, conflict }
ReplayVerdict classifyReplay(int status) {
  if (status >= 200 && status < 300) return ReplayVerdict.done;
  if (status == 0 || status == 401 || status == 408 || status == 425 || status == 429 || status >= 500) return ReplayVerdict.retry;
  return ReplayVerdict.conflict;
}

/// Persistent write queue + conflict journal. Storage is the secure store (Keychain/Keystore); full encrypted database in phase 7.
class OfflineQueue {
  final TokenStore _store;
  OfflineQueue(this._store);
  static const _k = 'queue', _c = 'conflicts';
  static int _seq = 0;
  static String newKey() => 'm${DateTime.now().microsecondsSinceEpoch}-${_seq++}';

  Future<List<QueuedOp>> pending() async {
    final raw = await _store.read(_k);
    if (raw == null) return [];
    return (jsonDecode(raw) as List).map((e) => QueuedOp.fromJson(e as Map<String, dynamic>)).toList();
  }

  Future<List<Map<String, dynamic>>> conflicts() async {
    final raw = await _store.read(_c);
    return raw == null ? [] : (jsonDecode(raw) as List).cast<Map<String, dynamic>>();
  }

  /// The op id is also sent as `Idempotency-Key`: pass the key used for the first attempt so a lost answer cannot create a duplicate.
  Future<void> enqueue(String method, String path, Map<String, dynamic>? body, {int priority = 0, String? id}) async {
    final ops = await pending();
    ops.add(QueuedOp(id ?? newKey(), method, path, body, DateTime.now().toIso8601String(), priority: priority));
    await _store.write(_k, jsonEncode(ops.map((o) => o.toJson()).toList()));
  }

  /// Replays by priority (stable: arrival order inside a priority). Stops at the first network failure.
  /// Only definitive refusals are conflicts (journal); 5xx, 429, 401 (re-login) and silence keep the write and stop the replay.
  Future<({int sent, int conflicts, int remaining})> flush(Sender send) async {
    final ops = await pending();
    final order = [...ops]..sort((a, b) => b.priority.compareTo(a.priority));
    var sent = 0, bad = 0;
    final journal = await conflicts();
    final left = [...ops];
    for (final op in order) {
      int status;
      try { status = await send(op); } catch (_) { break; }
      final verdict = classifyReplay(status);
      if (verdict == ReplayVerdict.retry) break;
      left.removeWhere((o) => o.id == op.id);
      if (verdict == ReplayVerdict.done) {
        sent++;
      } else {
        bad++;
        journal.add({'op': op.toJson(), 'status': status, 'at': DateTime.now().toIso8601String()});
      }
    }
    await _store.write(_k, jsonEncode(left.map((o) => o.toJson()).toList()));
    await _store.write(_c, jsonEncode(journal));
    return (sent: sent, conflicts: bad, remaining: left.length);
  }
}

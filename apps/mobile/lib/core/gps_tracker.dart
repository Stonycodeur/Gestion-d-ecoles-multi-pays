import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:geolocator/geolocator.dart';
import 'api_client.dart';

/// True when a new position must be sent (school mode: every 30 s, as set by the server policy).
bool shouldSend(DateTime? lastSent, DateTime now, int intervalSec) => lastSent == null || now.difference(lastSent).inSeconds >= intervalSec;

/// Student-side tracker. Sends positions only while the SERVER policy says tracking is allowed (guardian consent + time window),
/// also in the background (Android foreground service / iOS background location).
class GpsTracker {
  final ApiClient api;
  final String school, token, studentId;
  GpsTracker(this.api, this.school, this.token, this.studentId);

  StreamSubscription<Position>? _sub;
  Timer? _policyTimer;
  DateTime? _lastSent;
  int _interval = 30;
  bool get running => _sub != null;
  final ValueNotifier<String> status = ValueNotifier('stopped');

  Future<void> _refreshPolicy() async {
    final r = await api.getRaw(school, token, '/gps/students/$studentId/policy');
    final allowed = r['allowed'] == true;
    _interval = (r['interval_sec'] as int?) ?? 30;
    if (!allowed) {
      status.value = 'paused: ${r['reason']}';
      await _sub?.cancel();
      _sub = null;
    } else if (_sub == null) {
      await _listen();
    }
  }

  Future<void> _listen() async {
    final LocationSettings settings = defaultTargetPlatform == TargetPlatform.android
        ? AndroidSettings(
            accuracy: LocationAccuracy.high,
            distanceFilter: 0,
            intervalDuration: Duration(seconds: _interval),
            foregroundNotificationConfig: const ForegroundNotificationConfig(
              notificationTitle: 'ÉcoleManager',
              notificationText: 'Partage de position avec vos parents (consentement actif)',
              enableWakeLock: true,
            ))
        : AppleSettings(
            accuracy: LocationAccuracy.high,
            activityType: ActivityType.other,
            distanceFilter: 0,
            pauseLocationUpdatesAutomatically: false,
            showBackgroundLocationIndicator: true,
            allowBackgroundLocationUpdates: true);
    _sub = Geolocator.getPositionStream(locationSettings: settings).listen((p) async {
      final now = DateTime.now();
      if (!shouldSend(_lastSent, now, _interval)) return;
      _lastSent = now;
      try {
        await api.postOnline(school, token, '/gps/students/$studentId/positions',
            {'lat': p.latitude, 'lng': p.longitude, 'accuracy_m': p.accuracy, 'recorded_at': p.timestamp.toUtc().toIso8601String()});
        status.value = 'sharing (${now.toIso8601String().substring(11, 19)})';
      } catch (_) {
        status.value = 'offline: position skipped';   // positions older than 10 min are refused by the server: no replay
      }
    });
    status.value = 'sharing';
  }

  Future<void> start() async {
    await _refreshPolicy();
    _policyTimer?.cancel();
    _policyTimer = Timer.periodic(const Duration(minutes: 5), (_) => _refreshPolicy());
  }

  Future<void> stop() async {
    _policyTimer?.cancel();
    await _sub?.cancel();
    _sub = null;
    status.value = 'stopped';
  }
}

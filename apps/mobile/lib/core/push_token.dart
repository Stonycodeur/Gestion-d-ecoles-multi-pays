import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

/// Real push token (FCM on Android; APNs through FCM on iOS). Returns null when Firebase is not configured for this build
/// (no google-services.json / GoogleService-Info.plist): the app then registers a sandbox token and the API keeps writing to its outbox.
Future<String?> realPushToken() async {
  try {
    if (Firebase.apps.isEmpty) await Firebase.initializeApp();
    final m = FirebaseMessaging.instance;
    await m.requestPermission(); // explanatory text was shown by the onboarding screen before this system prompt
    return await m.getToken();
  } catch (_) {
    return null;
  }
}

/// Calls [onToken] whenever FCM rotates the token. No-op without Firebase.
void listenPushTokenRefresh(void Function(String token) onToken) {
  try {
    if (Firebase.apps.isEmpty) return;
    FirebaseMessaging.instance.onTokenRefresh.listen(onToken);
  } catch (_) {/* not configured */}
}

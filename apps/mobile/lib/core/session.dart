import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'api_client.dart';
import 'models.dart';
import 'token_store.dart';

final tokenStoreProvider = Provider<TokenStore>((_) => SecureTokenStore());
final apiProvider = Provider<ApiClient>((_) => ApiClient());

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

  Future<void> restore() async {
    final store = _ref.read(tokenStoreProvider);
    final school = await store.read('school');
    final token = await store.read('token');
    if (school != null && token != null) state = Session(school: school, token: token);
  }

  Future<void> signIn(String school, String role) async {
    final api = _ref.read(apiProvider);
    final s = school.trim().toLowerCase();
    final token = await api.sandboxLogin(s, role);
    final mods = await api.activeModules(s, token);
    final store = _ref.read(tokenStoreProvider);
    await store.write('school', s);
    await store.write('token', token);
    state = Session(school: s, token: token, modules: mods);
  }

  Future<void> signOut() async {
    await _ref.read(tokenStoreProvider).clear();
    state = const Session();
  }
}

final sessionProvider = StateNotifierProvider<SessionNotifier, Session>((ref) => SessionNotifier(ref));

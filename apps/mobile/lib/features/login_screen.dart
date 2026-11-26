import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import '../core/models.dart';
import '../core/session.dart';
import '../l10n/app_localizations.dart';

class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});
  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final _code = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _pwd = false;
  String _role = 'student';
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    ref.read(sessionProvider.notifier).authConfig().then((c) {
      if (mounted) setState(() => _pwd = c.isPassword);
    }).catchError((_) {});
  }

  Future<void> _submit() async {
    final t = AppLocalizations.of(context)!;
    if (_pwd) {
      setState(() { _busy = true; _error = null; });
      try {
        await ref.read(sessionProvider.notifier).signInWithPassword(_email.text, _password.text);
      } catch (e) {
        setState(() => _error = e.toString().replaceFirst('Exception: ', ''));
      } finally {
        if (mounted) setState(() => _busy = false);
      }
      return;
    }
    if (!isValidSchoolCode(_code.text)) {
      setState(() => _error = t.invalidCode);
      return;
    }
    setState(() { _busy = true; _error = null; });
    try {
      await ref.read(sessionProvider.notifier).signIn(_code.text, _role);
    } catch (e) {
      setState(() => _error = e.toString());
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final t = AppLocalizations.of(context)!;
    return Scaffold(
      appBar: AppBar(title: Text(t.appTitle)),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: _pwd
            ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                TextField(controller: _email, keyboardType: TextInputType.emailAddress, autofillHints: const [AutofillHints.username], decoration: const InputDecoration(labelText: 'Email')),
                const SizedBox(height: 16),
                TextField(controller: _password, obscureText: true, autofillHints: const [AutofillHints.password], decoration: InputDecoration(labelText: 'Mot de passe / Password', errorText: _error)),
                const SizedBox(height: 24),
                FilledButton(onPressed: _busy ? null : _submit, child: Text(t.login)),
              ])
            : Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          TextField(controller: _code, decoration: InputDecoration(labelText: t.schoolCode, errorText: _error)),
          const SizedBox(height: 16),
          DropdownButtonFormField<String>(
            initialValue: _role,
            decoration: InputDecoration(labelText: t.roleLabel),
            items: const ['student', 'guardian', 'teacher', 'head']
                .map((r) => DropdownMenuItem(value: r, child: Text(r)))
                .toList(),
            onChanged: (v) => setState(() => _role = v ?? 'student'),
          ),
          const SizedBox(height: 24),
          FilledButton(onPressed: _busy ? null : _submit, child: Text(t.login)),
        ]),
      ),
    );
  }
}

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import '../core/navigation.dart';
import '../core/session.dart';

String _lang(BuildContext c) => Localizations.localeOf(c).languageCode == 'fr' ? 'fr' : 'en';
String _tr(BuildContext c, String fr, String en) => _lang(c) == 'fr' ? fr : en;

/// Public home (before sign-in): search a country or a school, or sign in. Same directory as the website.
class WelcomeScreen extends ConsumerStatefulWidget {
  const WelcomeScreen({super.key});
  @override
  ConsumerState<WelcomeScreen> createState() => _WelcomeState();
}

class _WelcomeState extends ConsumerState<WelcomeScreen> {
  final _q = TextEditingController();
  List<Country>? _countries;
  List<SchoolSummary> _schools = const [];
  bool _offline = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final r = await ref.read(apiProvider).publicGet('/directory/countries');
    if (!mounted) return;
    setState(() {
      _offline = r == null;
      _countries = r == null ? const [] : [for (final c in (r as List)) Country.fromJson((c as Map).cast<String, dynamic>())];
    });
  }

  Future<void> _search(String q) async {
    if (q.trim().length < 2) {
      setState(() => _schools = const []);
      return;
    }
    final r = await ref.read(apiProvider).publicGet('/directory/schools?q=${Uri.encodeQueryComponent(q.trim())}');
    if (!mounted) return;
    setState(() => _schools = r == null ? const [] : [for (final s in (r as List)) SchoolSummary.fromJson((s as Map).cast<String, dynamic>())]);
  }

  @override
  Widget build(BuildContext context) {
    final lang = _lang(context);
    final q = _q.text.trim().toLowerCase();
    final shown = [for (final c in _countries ?? const <Country>[]) if (q.isEmpty || c.name.toLowerCase().contains(q) || c.nameFr.toLowerCase().contains(q) || c.code.toLowerCase() == q) c];
    return Scaffold(
      appBar: AppBar(title: const Text('ÉcoleManager Pro'), actions: [
        TextButton(key: const Key('go-login'), onPressed: () => context.go('/login'), child: Text(_tr(context, 'Se connecter', 'Sign in'))),
      ]),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        Text(_tr(context, 'Trouvez votre école', 'Find your school'), style: Theme.of(context).textTheme.headlineSmall),
        const SizedBox(height: 4),
        Text(_tr(context, 'Choisissez un pays ou cherchez un établissement.', 'Pick a country or search for a school.')),
        const SizedBox(height: 12),
        TextField(
          controller: _q,
          decoration: InputDecoration(prefixIcon: const Icon(Icons.search), labelText: _tr(context, 'Pays, école ou ville', 'Country, school or city'), border: const OutlineInputBorder()),
          onChanged: (v) {
            setState(() {});
            _search(v);
          },
        ),
        const SizedBox(height: 12),
        if (_offline) Text(_tr(context, 'Annuaire indisponible hors connexion. Vous pouvez tout de même vous connecter.', 'Directory unavailable offline. You can still sign in.')),
        if (_schools.isNotEmpty) ...[
          Text(_tr(context, 'Écoles', 'Schools'), style: Theme.of(context).textTheme.titleMedium),
          for (final s in _schools) _SchoolTile(s),
          const Divider(),
        ],
        if (_countries == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
        if (_countries != null && shown.isEmpty && !_offline) Text(_tr(context, 'Aucun pays ne correspond.', 'No country matches.')),
        for (final c in shown)
          ListTile(
            leading: const Icon(Icons.public),
            title: Text(c.label(lang)),
            subtitle: Text(c.schools > 0 ? _tr(context, '${c.schools} établissement(s)', '${c.schools} school(s)') : _tr(context, 'Pas encore disponible', 'Not available yet')),
            onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CountryScreen(country: c))),
          ),
      ]),
    );
  }
}

class _SchoolTile extends StatelessWidget {
  final SchoolSummary s;
  const _SchoolTile(this.s);
  @override
  Widget build(BuildContext context) => ListTile(
        leading: const Icon(Icons.school),
        title: Text(s.name),
        subtitle: Text([s.typeLabel(_lang(context)), s.where()].where((x) => x.isNotEmpty).join(' · ')),
        onTap: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => SchoolSiteScreen(slug: s.slug, name: s.name))),
      );
}

/// Schools of one country, or a plain message when none is open there yet.
class CountryScreen extends ConsumerStatefulWidget {
  final Country country;
  const CountryScreen({super.key, required this.country});
  @override
  ConsumerState<CountryScreen> createState() => _CountryState();
}

class _CountryState extends ConsumerState<CountryScreen> {
  List<SchoolSummary>? _schools;
  @override
  void initState() {
    super.initState();
    ref.read(apiProvider).publicGet('/directory/schools?country=${widget.country.code}').then((r) {
      if (mounted) setState(() => _schools = r == null ? const [] : [for (final s in (r as List)) SchoolSummary.fromJson((s as Map).cast<String, dynamic>())]);
    });
  }

  @override
  Widget build(BuildContext context) {
    final name = widget.country.label(_lang(context));
    return Scaffold(
      appBar: AppBar(title: Text(name)),
      body: _schools == null
          ? const Center(child: CircularProgressIndicator())
          : _schools!.isEmpty
              ? Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(_tr(context, 'Aucun établissement n’est encore disponible dans ce pays ($name). Revenez bientôt ou cherchez un autre pays.', 'No school is available in this country yet ($name). Come back soon or search another country.'), textAlign: TextAlign.center)))
              : ListView(children: [for (final s in _schools!) _SchoolTile(s)]),
    );
  }
}

/// Public page of one school: what it presents, adapted to its level, and the way into the personal space.
class SchoolSiteScreen extends ConsumerStatefulWidget {
  final String slug, name;
  const SchoolSiteScreen({super.key, required this.slug, required this.name});
  @override
  ConsumerState<SchoolSiteScreen> createState() => _SiteState();
}

class _SiteState extends ConsumerState<SchoolSiteScreen> {
  SchoolSummary? _info;
  Map<String, dynamic>? _site;
  List<dynamic> _news = const [];
  bool _loaded = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final api = ref.read(apiProvider);
    final i = await api.publicGet('/directory/schools?slug=${widget.slug}');
    final info = (i is List && i.isNotEmpty) ? SchoolSummary.fromJson((i.first as Map).cast<String, dynamic>()) : null;
    Map<String, dynamic>? site;
    var news = <dynamic>[];
    if (info != null && info.siteOpen) {
      final s = await api.publicGet('/public/${widget.slug}/site');
      if (s is Map) site = s.cast<String, dynamic>();
      final n = await api.publicGet('/public/${widget.slug}/news');
      if (n is List) news = n;
    }
    if (mounted) setState(() { _info = info; _site = site; _news = news; _loaded = true; });
  }

  String? _text(String key) => ((_site?['content'] as Map?)?[key] as Map?)?['text'] as String?;

  @override
  Widget build(BuildContext context) {
    final info = _info;
    return Scaffold(
      appBar: AppBar(title: Text(widget.name)),
      body: !_loaded
          ? const Center(child: CircularProgressIndicator())
          : info == null
              ? Padding(padding: const EdgeInsets.all(24), child: Center(child: Text(_tr(context, 'Cet établissement est introuvable ou indisponible.', 'This school was not found or is unavailable.'))))
              : ListView(padding: const EdgeInsets.all(16), children: [
                  Text([info.typeLabel(_lang(context)), info.where()].where((x) => x.isNotEmpty).join(' · '), style: Theme.of(context).textTheme.labelLarge),
                  const SizedBox(height: 12),
                  FilledButton.icon(
                    icon: const Icon(Icons.login),
                    onPressed: () => context.go('/login?school=${info.slug}'),
                    label: Text(_tr(context, 'Accéder à mon espace', 'Go to my space')),
                  ),
                  const SizedBox(height: 16),
                  if (!info.siteOpen) Text(_tr(context, 'Cet établissement n’a pas encore ouvert son site public.', 'This school has not opened its public site yet.')),
                  for (final k in const ['history', 'values', 'facilities', 'faculty', 'programs'])
                    if (_text(k) case final t? when t.isNotEmpty) ...[
                      Text(_tr(context, const {'history': 'Histoire', 'values': 'Valeurs', 'facilities': 'Infrastructures', 'faculty': 'Corps enseignant', 'programs': 'Formations'}[k]!, const {'history': 'History', 'values': 'Values', 'facilities': 'Facilities', 'faculty': 'Faculty', 'programs': 'Programmes'}[k]!), style: Theme.of(context).textTheme.titleMedium),
                      Padding(padding: const EdgeInsets.only(top: 4, bottom: 12), child: Text(t)),
                    ],
                  if (_news.isNotEmpty) Text(_tr(context, 'Actualités', 'News'), style: Theme.of(context).textTheme.titleMedium),
                  for (final n in _news) ListTile(contentPadding: EdgeInsets.zero, title: Text('${(n as Map)['title']}'), subtitle: Text('${n['body']}', maxLines: 3, overflow: TextOverflow.ellipsis)),
                ]),
    );
  }
}

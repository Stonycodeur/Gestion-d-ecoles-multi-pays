/// The menu of the signed-in person, computed by the API (`GET /me/navigation`) from their rights, the modules the school
/// enabled and the school's level. The app shows exactly these pages and nothing else; the public directory models live here too.
class NavItem {
  final String href, icon, fr, en;
  const NavItem(this.href, this.icon, this.fr, this.en);
  String label(String lang) => lang == 'fr' ? fr : en;
  factory NavItem.fromJson(Map<String, dynamic> j) {
    final l = (j['label'] as Map?)?.cast<String, dynamic>() ?? const {};
    return NavItem(j['href'] as String, (j['icon'] as String?) ?? '', (l['fr'] as String?) ?? j['href'] as String, (l['en'] as String?) ?? j['href'] as String);
  }
}

class NavGroup {
  final String key, fr, en;
  final List<NavItem> items;
  const NavGroup(this.key, this.fr, this.en, this.items);
  String title(String lang) => lang == 'fr' ? fr : en;
  factory NavGroup.fromJson(Map<String, dynamic> j) {
    final t = (j['title'] as Map?)?.cast<String, dynamic>() ?? const {};
    return NavGroup((j['key'] as String?) ?? '', (t['fr'] as String?) ?? '', (t['en'] as String?) ?? '',
        [for (final i in (j['items'] as List? ?? const [])) NavItem.fromJson((i as Map).cast<String, dynamic>())]);
  }
}

class SchoolNav {
  final String schoolName, type, typeFr, typeEn;
  final List<NavGroup> groups;
  final Set<String> rights;
  final Map<String, Map<String, String>> vocabulary;
  const SchoolNav({required this.schoolName, required this.type, required this.typeFr, required this.typeEn, required this.groups, required this.rights, required this.vocabulary});

  List<NavItem> get items => [for (final g in groups) ...g.items];
  bool has(String right) => rights.contains(right);
  bool shows(String href) => items.any((i) => i.href == href);
  String typeLabel(String lang) => lang == 'fr' ? typeFr : typeEn;

  /// A word of this school's vocabulary ("Élève" or "Étudiant"…), with a fallback when the school or level does not define it.
  String term(String key, String lang, {String? fallback}) => vocabulary[key]?[lang] ?? fallback ?? key;

  factory SchoolNav.fromJson(Map<String, dynamic> j) {
    final school = (j['school'] as Map?)?.cast<String, dynamic>() ?? const {};
    final prof = (j['profile'] as Map?)?.cast<String, dynamic>() ?? const {};
    final label = (prof['label'] as Map?)?.cast<String, dynamic>() ?? const {};
    final vocab = <String, Map<String, String>>{};
    ((prof['vocabulary'] as Map?) ?? const {}).forEach((k, v) {
      final m = (v as Map).cast<String, dynamic>();
      vocab['$k'] = {'fr': '${m['fr'] ?? k}', 'en': '${m['en'] ?? k}'};
    });
    return SchoolNav(
      schoolName: (school['name'] as String?) ?? '',
      type: (school['type'] as String?) ?? '',
      typeFr: (label['fr'] as String?) ?? '',
      typeEn: (label['en'] as String?) ?? '',
      groups: [for (final g in (j['groups'] as List? ?? const [])) NavGroup.fromJson((g as Map).cast<String, dynamic>())],
      rights: {for (final r in (j['rights'] as List? ?? const [])) '$r'},
      vocabulary: vocab,
    );
  }
}

/// Web pages that have a native screen in the app. Anything else (school administration, user management, settings…) stays on the web
/// and is listed as such, so nobody looks for a page that is not there.
const nativePages = {
  '/timetable', '/grades', '/absences', '/lessons', '/resources', '/messages', '/news', '/notifications', '/oaa', '/play', '/risk',
  '/orientation', '/gps', '/payments', '/ministry', '/marketplace', '/assistant', '/xr', '/visitor', '/school/classes',
};

class Country {
  final String code, name, nameFr;
  final int schools;
  const Country(this.code, this.name, this.nameFr, this.schools);
  String label(String lang) => lang == 'fr' ? nameFr : name;
  factory Country.fromJson(Map<String, dynamic> j) => Country('${j['c']}', '${j['n']}', '${j['fr'] ?? j['n']}', (j['schools'] as num?)?.toInt() ?? 0);
}

class SchoolSummary {
  final String slug, name, type, typeFr, typeEn;
  final String? city, region;
  final List<String> sections;
  final bool siteOpen;
  const SchoolSummary(this.slug, this.name, this.type, this.typeFr, this.typeEn, this.city, this.region, this.sections, this.siteOpen);
  String typeLabel(String lang) => lang == 'fr' ? typeFr : typeEn;
  String where() => [city, region].whereType<String>().where((s) => s.isNotEmpty).join(' · ');
  factory SchoolSummary.fromJson(Map<String, dynamic> j) {
    final l = (j['type_label'] as Map?)?.cast<String, dynamic>() ?? const {};
    return SchoolSummary('${j['slug']}', '${j['name']}', '${j['type']}', '${l['fr'] ?? j['type']}', '${l['en'] ?? j['type']}', j['city'] as String?, j['region'] as String?,
        [for (final s in (j['sections'] as List? ?? const [])) '$s'], j['site_open'] == true);
  }
}

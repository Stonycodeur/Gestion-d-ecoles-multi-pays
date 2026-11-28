import 'package:ecolemanager_mobile/core/navigation.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  final json = {
    'school': {'slug': 'ga_univ', 'name': 'Université Demo', 'type': 'university'},
    'profile': {
      'label': {'fr': 'Université', 'en': 'University'},
      'vocabulary': {'students': {'fr': 'Étudiants', 'en': 'Students'}}
    },
    'groups': [
      {
        'key': 'pedagogy',
        'title': {'fr': 'Pédagogie', 'en': 'Teaching'},
        'items': [
          {'href': '/grades', 'icon': 'grades', 'label': {'fr': 'Notes', 'en': 'Grades'}},
          {'href': '/school/users', 'icon': 'lock', 'label': {'fr': 'Utilisateurs', 'en': 'Users'}}
        ]
      }
    ],
    'rights': ['grades:read', 'users:manage'],
  };

  test('the menu of the API is read as sent: pages, words, rights, school level', () {
    final n = SchoolNav.fromJson(json);
    expect(n.schoolName, 'Université Demo');
    expect(n.typeLabel('en'), 'University');
    expect(n.items.map((i) => i.href), ['/grades', '/school/users']);
    expect(n.items.first.label('fr'), 'Notes');
    expect(n.has('users:manage'), isTrue);
    expect(n.has('billing:write'), isFalse);
    expect(n.shows('/grades'), isTrue);
    expect(n.shows('/payments'), isFalse);
    expect(n.term('students', 'fr'), 'Étudiants');
    expect(n.term('guardian', 'fr', fallback: 'Parent'), 'Parent');
  });

  test('school administration pages stay on the web, learner pages have a native screen', () {
    expect(nativePages.contains('/grades'), isTrue);
    expect(nativePages.contains('/school/users'), isFalse);
    expect(nativePages.contains('/school/settings'), isFalse);
  });

  test('public directory entries are read, with the school site sections of its level', () {
    final c = Country.fromJson({'c': 'GA', 'n': 'Gabon', 'fr': 'Gabon', 'schools': 3});
    expect(c.schools, 3);
    final s = SchoolSummary.fromJson({'slug': 'ga_lycee', 'name': 'Lycée', 'type': 'lycee', 'type_label': {'fr': 'Lycée', 'en': 'Upper secondary school'}, 'city': 'Libreville', 'region': null, 'sections': ['presentation', 'news'], 'site_open': true});
    expect(s.siteOpen, isTrue);
    expect(s.where(), 'Libreville');
    expect(s.sections, ['presentation', 'news']);
    expect(s.typeLabel('en'), 'Upper secondary school');
  });
}

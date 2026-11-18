import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/models.dart';
import 'package:ecolemanager_mobile/core/token_store.dart';

void main() {
  test('school code rule matches the API tenant slug', () {
    expect(isValidSchoolCode('lycee_a'), true);
    expect(isValidSchoolCode(' Lycee_A '), true);
    expect(isValidSchoolCode('a'), false);
    expect(isValidSchoolCode('a;drop'), false);
  });

  test('screens are shown only for active modules', () {
    expect(visibleScreens(const []), isEmpty);
    final m = ActiveModule.fromJson({'name': 'module-oaa', 'version': '1.0.0', 'permissions': ['oaa:read'], 'mobile_screens': ['oaa_dashboard']});
    expect(visibleScreens([m]), {'oaa_dashboard'});
  });

  test('token store clears everything on sign-out', () async {
    final s = MemoryTokenStore();
    await s.write('token', 'x');
    expect(await s.read('token'), 'x');
    await s.clear();
    expect(await s.read('token'), isNull);
  });
}

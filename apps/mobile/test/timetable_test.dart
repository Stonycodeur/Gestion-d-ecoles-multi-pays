import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/timetable.dart';

void main() {
  test('slots are grouped by weekday and sorted by period', () {
    final g = groupByDay([
      {'weekday': 3, 'period_index': 2, 'id': 'c'},
      {'weekday': 1, 'period_index': 4, 'id': 'b'},
      {'weekday': 1, 'period_index': 0, 'id': 'a'},
    ]);
    expect(g.keys.toList(), [1, 3]);
    expect(g[1]!.map((s) => s['id']).toList(), ['a', 'b']);
  });

  test('only the first upcoming substitution of a slot is kept', () {
    final m = nextSubstitutionBySlot([
      {'slot_id': 's1', 'on_date': '2026-12-01'},
      {'slot_id': 's1', 'on_date': '2026-12-08'},
    ]);
    expect(m['s1']!['on_date'], '2026-12-01');
  });

  test('period codes follow the configured period type, labels are 1-based', () {
    expect(periodCodes('semester'), ['S1', 'S2']);
    expect(periodCodes('trimester'), ['T1', 'T2', 'T3']);
    expect(periodCodes(null), ['T1', 'T2', 'T3']);
    expect(periodLabel(0), 'P1');
  });

  test('grade entry respects min, max and step of the active scale', () {
    expect(validGradeInput(14.5, 0, 20, 0.25), true);
    expect(validGradeInput(14.6, 0, 20, 0.25), false);
    expect(validGradeInput(21, 0, 20, 0.25), false);
    expect(validGradeInput(-1, 0, 20, 0.25), false);
    expect(validGradeInput(7.5, 0, 10, 0.5), true);
    expect(validGradeInput(7.3, 0, 10, 0.5), false);
  });
}

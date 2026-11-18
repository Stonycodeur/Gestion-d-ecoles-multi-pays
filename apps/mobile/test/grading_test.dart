import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/core/grading.dart';

GradingScale num(String code, double max, double step, double pass, String rounding, int dec) =>
    GradingScale(code, 'numeric', 0, max, step, dec, pass, rounding, const []);

final s20 = num('num20', 20, 0.25, 10, 'tenth', 1);
final s10 = num('num10', 10, 0.5, 5, 'tenth', 1);
final s100 = num('num100', 100, 1, 50, 'integer', 0);
GradingScale letters() {
  const t = [
    ['A+', 96, 100, 'green'], ['A', 86, 95, 'green'], ['A-', 81, 85, 'green'], ['B+', 76, 80, 'blue'], ['B', 66, 75, 'blue'], ['B-', 61, 65, 'blue'],
    ['C+', 56, 60, 'yellow'], ['C', 46, 55, 'yellow'], ['C-', 41, 45, 'yellow'], ['D+', 36, 40, 'orange'], ['D', 26, 35, 'orange'], ['D-', 21, 25, 'orange'],
    ['E+', 16, 20, 'red'], ['E', 6, 15, 'red'], ['E-', 1, 5, 'red'],
  ];
  return GradingScale('letters', 'letter', 0, 100, 1, 0, 41, 'integer',
      [for (final r in t) Band(r[0] as String, (r[1] as int).toDouble(), (r[2] as int).toDouble(), color: r[3] as String)]);
}

void main() {
  test('OAA 73/100 is shown as 14,6/20, 7,3/10, 73/100 and B (same cases as the TypeScript tests)', () {
    expect(display(73, s20).text, '14,6/20');
    expect(display(73, s10).text, '7,3/10');
    expect(display(73, s100).text, '73/100');
    expect(display(73, letters()).text, 'B');
    expect(display(73, s20, 'en').text, '14.6/20');
  });

  test('letters: every band boundary', () {
    final l = letters();
    final cases = {100: 'A+', 96: 'A+', 95: 'A', 86: 'A', 85: 'A-', 81: 'A-', 80: 'B+', 76: 'B+', 75: 'B', 66: 'B', 65: 'B-', 61: 'B-', 60: 'C+', 56: 'C+', 55: 'C',
      46: 'C', 45: 'C-', 41: 'C-', 40: 'D+', 36: 'D+', 35: 'D', 26: 'D', 25: 'D-', 21: 'D-', 20: 'E+', 16: 'E+', 15: 'E', 6: 'E', 5: 'E-', 1: 'E-', 0: 'E-'};
    cases.forEach((score, label) => expect(display(score.toDouble(), l).text, label, reason: 'score $score'));
  });

  test('rounding, thresholds, colors', () {
    expect(roundBy(14.62, 'quarter'), 14.5);
    expect(roundBy(14.63, 'quarter'), 14.75);
    expect(thresholdInScale(50, s20), 10);
    expect(thresholdInScale(40, s10), 4);
    expect([100, 81, 80, 61, 60, 41, 40, 21, 20, 0].map((p) => colorForPct(p.toDouble())).toList(),
        ['green', 'green', 'blue', 'blue', 'yellow', 'yellow', 'orange', 'orange', 'red', 'red']);
  });

  test('input conversion and mixed-scale weighted average', () {
    expect(toNormalized(14.6, s20), closeTo(73, 1e-9));
    expect(toNormalized('B', letters()), 70.5);
    expect(() => toNormalized(21, s20), throwsRangeError);
    final avg = weightedAverage100([(toNormalized(14, s20), 3), (toNormalized(8, s10), 2), (toNormalized(60, s100), 1)])!;
    expect((avg * 100).round() / 100, 71.67);
    expect(display(avg, s20).text, '14,3/20');
    expect(weightedAverage100([]), isNull);
  });
}

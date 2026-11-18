// Dart port of packages/shared/src/grading.ts. Same rules, same test cases (test/grading_test.dart).
class Band {
  final String label;
  final double min, max;
  final String? color, mention;
  const Band(this.label, this.min, this.max, {this.color, this.mention});
  factory Band.fromJson(Map<String, dynamic> j) =>
      Band(j['label'] as String, (j['min'] as num).toDouble(), (j['max'] as num).toDouble(), color: j['color'] as String?, mention: j['mention'] as String?);
}

class GradingScale {
  final String code, type, rounding;
  final double min, max, step, passMark;
  final int decimals;
  final List<Band> bands;
  const GradingScale(this.code, this.type, this.min, this.max, this.step, this.decimals, this.passMark, this.rounding, this.bands);
  factory GradingScale.fromJson(Map<String, dynamic> j) => GradingScale(
        j['code'] as String, j['type'] as String, (j['min'] as num).toDouble(), (j['max'] as num).toDouble(), (j['step'] as num).toDouble(),
        (j['decimals'] as num).toInt(), (j['passMark'] as num).toDouble(), j['rounding'] as String,
        ((j['bands'] as List?) ?? const []).map((b) => Band.fromJson(b as Map<String, dynamic>)).toList(),
      );
}

class Displayed {
  final double? value;
  final String? label;
  final String text, color;
  final bool passed;
  const Displayed(this.text, this.color, this.passed, {this.value, this.label});
}

double roundBy(double v, String rule, [int decimals = 2]) {
  switch (rule) {
    case 'integer': return v.roundToDouble();
    case 'tenth': return (v * 10).roundToDouble() / 10;
    case 'quarter': return (v * 4).roundToDouble() / 4;
    case 'half': return (v * 2).roundToDouble() / 2;
    default:
      final f = _pow10(decimals);
      return (v * f).roundToDouble() / f;
  }
}

double _pow10(int n) { var r = 1.0; for (var i = 0; i < n; i++) { r *= 10; } return r; }

/// Default colors (spec 3 bis): green >= 81 %, blue 61-80, yellow 41-60, orange 21-40, red <= 20.
String colorForPct(double pct) => pct >= 81 ? 'green' : pct >= 61 ? 'blue' : pct >= 41 ? 'yellow' : pct >= 21 ? 'orange' : 'red';

Band? findBand(double score100, GradingScale s) {
  if (s.bands.isEmpty) return null;
  final x = score100.roundToDouble();
  for (final b in s.bands) { if (x >= b.min && x <= b.max) return b; }
  final sorted = [...s.bands]..sort((a, b) => a.min.compareTo(b.min));
  return x < sorted.first.min ? sorted.first : sorted.last;
}

double toNormalized(Object input, GradingScale s) {
  if (input is String) {
    final b = s.bands.where((b) => b.label == input);
    if (b.isEmpty) throw ArgumentError('Unknown grade label "$input" for scale ${s.code}');
    return (b.first.min + b.first.max) / 2;
  }
  final v = (input as num).toDouble();
  if (v < s.min || v > s.max) throw RangeError('Grade $v outside ${s.min}-${s.max} (${s.code})');
  return (v - s.min) / (s.max - s.min) * 100;
}

String _fmt(double n, int decimals, String locale) {
  var s = n.toStringAsFixed(decimals);
  if (s.contains('.')) { s = s.replaceFirst(RegExp(r'0+$'), '').replaceFirst(RegExp(r'\.$'), ''); }
  return locale.startsWith('fr') ? s.replaceFirst('.', ',') : s;
}

Displayed display(double score100, GradingScale s, [String locale = 'fr']) {
  final score = score100.clamp(0, 100).toDouble();
  final band = findBand(score, s);
  final color = band?.color ?? colorForPct(score);
  if (s.type == 'letter') return Displayed(band?.label ?? '', color, score >= s.passMark / s.max * 100, label: band?.label);
  final value = roundBy(s.min + score / 100 * (s.max - s.min), s.rounding, s.decimals);
  return Displayed('${_fmt(value, s.decimals, locale)}/${_fmt(s.max, 0, locale)}', color, value >= s.passMark, value: value, label: band?.label);
}

double thresholdInScale(double pct, GradingScale s) => s.min + pct / 100 * (s.max - s.min);

double? weightedAverage100(List<(double, double)> grades) {
  final total = grades.fold<double>(0, (a, g) => a + g.$2);
  if (total <= 0) return null;
  return grades.fold<double>(0, (a, g) => a + g.$1 * g.$2) / total;
}

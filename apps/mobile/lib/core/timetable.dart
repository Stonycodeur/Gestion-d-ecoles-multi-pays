/// Pure helpers for the timetable screen (tested in test/timetable_test.dart).

/// Slots of `GET /timetable` grouped by ISO weekday (1 = Monday), each day sorted by period.
Map<int, List<Map<String, dynamic>>> groupByDay(List<dynamic> slots) {
  final out = <int, List<Map<String, dynamic>>>{};
  for (final raw in slots) {
    final s = (raw as Map).cast<String, dynamic>();
    out.putIfAbsent((s['weekday'] as num).toInt(), () => []).add(s);
  }
  for (final l in out.values) {
    l.sort((a, b) => (a['period_index'] as num).compareTo(b['period_index'] as num));
  }
  return Map.fromEntries(out.entries.toList()..sort((a, b) => a.key.compareTo(b.key)));
}

/// Next upcoming substitution of each slot (the API returns them ordered by date).
Map<String, Map<String, dynamic>> nextSubstitutionBySlot(List<dynamic> subs) {
  final out = <String, Map<String, dynamic>>{};
  for (final raw in subs) {
    final s = (raw as Map).cast<String, dynamic>();
    out.putIfAbsent(s['slot_id'] as String, () => s);
  }
  return out;
}

String periodLabel(int periodIndex) => 'P${periodIndex + 1}';

/// Period codes offered for report cards, from the country's education system (`period_type` comes from configuration).
List<String> periodCodes(String? periodType) => periodType == 'semester' ? const ['S1', 'S2'] : const ['T1', 'T2', 'T3'];

/// A numeric grade is accepted when it lies in [min, max] and is a multiple of the scale step (entry rules of the active scale).
bool validGradeInput(double value, double min, double max, double step) {
  if (value < min || value > max) return false;
  if (step <= 0) return true;
  final k = (value - min) / step;
  return (k - k.roundToDouble()).abs() < 1e-9;
}

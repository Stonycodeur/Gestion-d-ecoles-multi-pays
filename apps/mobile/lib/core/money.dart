import 'package:intl/intl.dart';

/// Amounts travel as integer MINOR units; the number of decimals comes from the currency (XAF: 0, EUR: 2), never from a country rule.
int minorDigits(String currency) => NumberFormat.currency(name: currency).decimalDigits ?? 2;

String formatMoney(int minor, String currency, {String locale = 'fr'}) {
  final f = NumberFormat.currency(locale: locale, name: currency);
  final digits = f.decimalDigits ?? 2;
  var v = minor.toDouble();
  for (var i = 0; i < digits; i++) {
    v /= 10;
  }
  return f.format(v);
}

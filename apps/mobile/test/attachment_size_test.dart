import 'package:flutter_test/flutter_test.dart';
import 'package:ecolemanager_mobile/features/pedagogy_screens.dart';

void main() {
  test('attachment sizes are shown in Ko below 1 Mo and in Mo above', () {
    expect(attachmentSize(900), '1 Ko');
    expect(attachmentSize(2048), '2 Ko');
    expect(attachmentSize(3 * 1048576), '3.0 Mo');
    expect(attachmentSize(1572864), '1.5 Mo');
  });
}

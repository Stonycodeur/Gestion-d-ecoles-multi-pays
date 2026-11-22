import 'dart:convert';
import 'dart:io';
import 'package:http/http.dart' as http;
import 'package:http/io_client.dart';

/// Certificate pinning (spec 11.1). Build with `--dart-define=PINNED_CERT_PEM_B64=<base64 of a PEM bundle>`: the app then trusts ONLY the
/// certificates in that bundle (pin the server's intermediate/CA certificate, plus a backup one for rotation) and refuses every other chain,
/// including those issued by a CA the device trusts. Without the define (development, tests) the platform trust store is used.
const String pinnedCertPemB64 = String.fromEnvironment('PINNED_CERT_PEM_B64');

/// Fails closed: an unreadable bundle throws instead of silently falling back to the system trust store.
SecurityContext? pinnedContext(String pemBase64) {
  if (pemBase64.isEmpty) return null;
  final bytes = base64.decode(pemBase64);
  if (!utf8.decode(bytes, allowMalformed: true).contains('BEGIN CERTIFICATE')) throw const FormatException('PINNED_CERT_PEM_B64 does not contain a PEM certificate');
  return SecurityContext(withTrustedRoots: false)..setTrustedCertificatesBytes(bytes);
}

http.Client buildHttpClient([String pemBase64 = pinnedCertPemB64]) {
  final ctx = pinnedContext(pemBase64);
  return ctx == null ? http.Client() : IOClient(HttpClient(context: ctx));
}

import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';
import '../core/gps_tracker.dart';
import '../core/money.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

Future<List<Map<String, dynamic>>> _myStudents(WidgetRef ref) async {
  final s = ref.read(sessionProvider);
  final r = await ref.read(apiProvider).getJson(s.school!, s.token!, '/me/students', ref.read(cacheProvider));
  return (r.data as List).cast<Map<String, dynamic>>();
}

/// Tuition payment: a real service payment (Mobile Money / card through the provider), NOT an in-app purchase. Needs a connection.
class PaymentScreen extends ConsumerStatefulWidget {
  const PaymentScreen({super.key});
  @override
  ConsumerState<PaymentScreen> createState() => _PaymentState();
}

class _PaymentState extends ConsumerState<PaymentScreen> {
  Map<String, dynamic>? cfg;
  List<Map<String, dynamic>> invoices = [];
  String? method;
  final payer = TextEditingController();
  String message = '';
  Map<String, dynamic>? pending;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final s = ref.read(sessionProvider);
    final api = ref.read(apiProvider);
    try {
      final c = await api.getRaw(s.school!, s.token!, '/payments/config');
      final out = <Map<String, dynamic>>[];
      for (final st in await _myStudents(ref)) {
        final r = await api.getJson(s.school!, s.token!, '/students/${st['id']}/invoices', ref.read(cacheProvider));
        for (final i in (r.data as List).cast<Map<String, dynamic>>()) {
          out.add({...i, 'student': '${st['first_name']} ${st['last_name']}'});
        }
      }
      final online = (c['methods'] as List).cast<Map<String, dynamic>>().where((m) => m['kind'] == 'mobile_money' || m['kind'] == 'card').toList();
      setState(() {
        cfg = c;
        invoices = out;
        method ??= online.isEmpty ? null : online.first['code'] as String;
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Future<void> _pay(Map<String, dynamic> inv) async {
    final s = ref.read(sessionProvider);
    try {
      final r = await ref.read(apiProvider).postOnline(
          s.school!, s.token!, '/invoices/${inv['id']}/pay', {'method': method, 'payer': payer.text},
          extraHeaders: {'Idempotency-Key': '${inv['id']}-${DateTime.now().millisecondsSinceEpoch}'});
      setState(() {
        pending = r as Map<String, dynamic>;
        message = (r['instructions'] ?? 'Paiement initié') as String;
      });
    } catch (e) {
      setState(() => message = 'Impossible : $e (connexion requise / connection required)');
    }
  }

  Future<void> _simulate() async {
    final s = ref.read(sessionProvider);
    try {
      final r = await ref.read(apiProvider).postOnline(s.school!, s.token!, '/payments/${pending!['payment']['id']}/sandbox-confirm', {});
      setState(() {
        message = 'Confirmé ${(r as Map)['receipt'] ?? ''}';
        pending = null;
      });
      await _load();
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  @override
  Widget build(BuildContext context) {
    final cur = cfg?['currency'] as String? ?? 'XAF';
    final methods = ((cfg?['methods'] as List?) ?? []).cast<Map<String, dynamic>>().where((m) => m['kind'] == 'mobile_money' || m['kind'] == 'card').toList();
    return Scaffold(
      appBar: AppBar(title: const Text('Paiements / Payments')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        if (message.isNotEmpty) Text(message, semanticsLabel: 'Statut: $message'),
        if (methods.isNotEmpty)
          DropdownButtonFormField<String>(
            value: method,
            decoration: const InputDecoration(labelText: 'Mode de paiement / Method'),
            items: [for (final m in methods) DropdownMenuItem(value: m['code'] as String, child: Text('${m['label'] ?? m['code']}'))],
            onChanged: (v) => setState(() => method = v),
          ),
        TextField(controller: payer, keyboardType: TextInputType.phone, decoration: const InputDecoration(labelText: 'Téléphone Mobile Money / Phone')),
        if (pending != null && cfg?['mode'] == 'sandbox') FilledButton(onPressed: _simulate, child: const Text('Simuler la confirmation (sandbox)')),
        const Divider(),
        for (final i in invoices)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('${i['number']} — ${i['student']}', style: Theme.of(context).textTheme.titleMedium),
                Text('${i['label']} · ${formatMoney(i['net_minor'] as int, cur)} · reste ${formatMoney(i['outstanding_minor'] as int, cur)} · ${i['status']}'),
                for (final x in (i['installments'] as List).cast<Map<String, dynamic>>())
                  Text('#${x['seq']} ${x['due_on']}: ${formatMoney(x['paid_minor'] as int, cur)} / ${formatMoney(x['amount_minor'] as int, cur)}'),
                if ((i['outstanding_minor'] as int) > 0)
                  Align(alignment: Alignment.centerRight, child: FilledButton(onPressed: method == null ? null : () => _pay(i), child: const Text('Payer le solde / Pay balance'))),
              ]),
            ),
          ),
      ]),
    );
  }
}

/// Guardian screen: consent (window + retention), live map, events. Everything is revocable.
class GpsParentScreen extends ConsumerStatefulWidget {
  const GpsParentScreen({super.key});
  @override
  ConsumerState<GpsParentScreen> createState() => _GpsParentState();
}

class _GpsParentState extends ConsumerState<GpsParentScreen> {
  List<Map<String, dynamic>> kids = [];
  String? kid;
  Map<String, dynamic>? consent, live;
  List<Map<String, dynamic>> events = [];
  String message = '';
  String start = '07:00', end = '18:00';

  @override
  void initState() {
    super.initState();
    _init();
  }

  Future<void> _init() async {
    kids = await _myStudents(ref);
    if (kids.isNotEmpty) kid = kids.first['id'] as String;
    await _refresh();
  }

  Future<void> _refresh() async {
    if (kid == null) return;
    final s = ref.read(sessionProvider);
    final api = ref.read(apiProvider);
    try {
      consent = await api.getRaw(s.school!, s.token!, '/gps/students/$kid/consent');
    } catch (_) {}
    try {
      live = await api.getRaw(s.school!, s.token!, '/gps/students/$kid/live');
      final ev = await api.getJson(s.school!, s.token!, '/gps/students/$kid/events', ref.read(cacheProvider));
      events = (ev.data as List).cast<Map<String, dynamic>>();
      message = '';
    } catch (e) {
      live = null;
      message = 'Position non visible : $e';
    }
    if (mounted) setState(() {});
  }

  Future<void> _consent(bool grant) async {
    final s = ref.read(sessionProvider);
    try {
      await ref.read(apiProvider).postOnline(s.school!, s.token!, '/gps/students/$kid/consent', grant
          ? {'granted': true, 'window': {'days': [1, 2, 3, 4, 5], 'start': start, 'end': end}}
          : {'granted': false});
      message = grant ? 'Suivi autorisé du lundi au vendredi, $start–$end' : 'Suivi révoqué, positions supprimées';
    } catch (e) {
      message = '$e';
    }
    await _refresh();
  }

  @override
  Widget build(BuildContext context) {
    final pos = (live?['position'] as Map<String, dynamic>?);
    final point = pos == null ? null : LatLng((pos['lat'] as num).toDouble(), (pos['lng'] as num).toDouble());
    return Scaffold(
      appBar: AppBar(title: const Text('Localisation / Location')),
      body: ListView(padding: const EdgeInsets.all(16), children: [
        const Text('Le suivi est désactivé tant que vous ne l’autorisez pas. Il est limité à la plage choisie, chiffré, supprimé après 30 jours, et vous pouvez le révoquer à tout moment.'),
        if (kids.length > 1)
          DropdownButton<String>(value: kid, items: [for (final k in kids) DropdownMenuItem(value: k['id'] as String, child: Text('${k['first_name']} ${k['last_name']}'))], onChanged: (v) { kid = v; _refresh(); }),
        Row(children: [
          Expanded(child: TextFormField(initialValue: start, decoration: const InputDecoration(labelText: 'De (HH:MM)'), onChanged: (v) => start = v)),
          const SizedBox(width: 8),
          Expanded(child: TextFormField(initialValue: end, decoration: const InputDecoration(labelText: 'À (HH:MM)'), onChanged: (v) => end = v)),
        ]),
        Row(children: [
          FilledButton(onPressed: () => _consent(true), child: const Text('J’autorise')),
          const SizedBox(width: 8),
          if (consent?['tracking_active'] == true) OutlinedButton(onPressed: () => _consent(false), child: const Text('Révoquer')),
        ]),
        if (message.isNotEmpty) Padding(padding: const EdgeInsets.symmetric(vertical: 8), child: Text(message)),
        if (point != null)
          SizedBox(
            height: 280,
            child: Semantics(
              label: 'Carte : dernière position de l’enfant',
              child: FlutterMap(
                options: MapOptions(initialCenter: point, initialZoom: 16),
                children: [
                  TileLayer(urlTemplate: const String.fromEnvironment('MAP_TILE_URL', defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'), userAgentPackageName: 'com.ecolemanager.pro'),
                  MarkerLayer(markers: [Marker(point: point, width: 40, height: 40, child: const Icon(Icons.location_on, color: Colors.red, size: 40))]),
                ],
              ),
            ),
          ),
        if (live?['state']?['out_of_zone'] == true) const Text('Hors de la zone attendue', style: TextStyle(fontWeight: FontWeight.bold)),
        const SizedBox(height: 8),
        Text('Événements', style: Theme.of(context).textTheme.titleMedium),
        for (final e in events) Text('${e['occurred_at']} — ${e['type']}${e['geofence'] != null ? ' (${e['geofence']})' : ''}'),
      ]),
    );
  }
}

/// Student screen: explains what is shared and with whom, asks the OS permissions with a clear text, starts the background tracker.
class GpsStudentScreen extends ConsumerStatefulWidget {
  const GpsStudentScreen({super.key});
  @override
  ConsumerState<GpsStudentScreen> createState() => _GpsStudentState();
}

class _GpsStudentState extends ConsumerState<GpsStudentScreen> {
  GpsTracker? tracker;
  String studentId = '';
  String info = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    final mine = await _myStudents(ref);
    if (mine.isNotEmpty) studentId = mine.first['id'] as String;
    setState(() {});
  }

  Future<void> _start() async {
    final ok = await showDialog<bool>(
          context: context,
          builder: (c) => AlertDialog(
            title: const Text('Partager ma position'),
            content: const Text('Tes parents ont autorisé le suivi. Ta position est envoyée toutes les 30 secondes pendant les heures d’école, même si l’application est en arrière-plan. Elle est chiffrée et supprimée automatiquement. Tu peux arrêter à tout moment.'),
            actions: [TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Non')), FilledButton(onPressed: () => Navigator.pop(c, true), child: const Text('Continuer'))],
          ),
        ) ??
        false;
    if (!ok) return;
    var perm = await Geolocator.checkPermission();
    if (perm == LocationPermission.denied) perm = await Geolocator.requestPermission();
    if (perm == LocationPermission.denied || perm == LocationPermission.deniedForever) {
      setState(() => info = 'Permission de localisation refusée');
      return;
    }
    final s = ref.read(sessionProvider);
    tracker = GpsTracker(ref.read(apiProvider), s.school!, s.token!, studentId);
    await tracker!.start();
    setState(() => info = 'Démarré');
  }

  Future<void> _revoke() async {
    final s = ref.read(sessionProvider);
    await tracker?.stop();
    try {
      await ref.read(apiProvider).postOnline(s.school!, s.token!, '/gps/students/$studentId/consent', {'granted': false});
      setState(() => info = 'Suivi révoqué');
    } catch (e) {
      setState(() => info = '$e');
    }
  }

  @override
  Widget build(BuildContext context) => Scaffold(
        appBar: AppBar(title: const Text('Ma position / My location')),
        body: ListView(padding: const EdgeInsets.all(16), children: [
          const Text('Le suivi ne fonctionne que si un parent l’a autorisé.'),
          const SizedBox(height: 8),
          FilledButton(onPressed: studentId.isEmpty ? null : _start, child: const Text('Activer l’envoi')),
          OutlinedButton(onPressed: studentId.isEmpty ? null : _revoke, child: const Text('Révoquer le suivi')),
          if (tracker != null) ValueListenableBuilder<String>(valueListenable: tracker!.status, builder: (_, v, __) => Text('État : $v')),
          Text(info),
        ]),
      );
}

String prettyJson(Object o) => const JsonEncoder.withIndent('  ').convert(o);

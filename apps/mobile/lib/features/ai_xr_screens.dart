import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:model_viewer_plus/model_viewer_plus.dart';
import '../core/session.dart';
import 'pedagogy_screens.dart';

Future<dynamic> _get(WidgetRef ref, String path) async {
  final s = ref.read(sessionProvider);
  return (await ref.read(apiProvider).getJson(s.school!, s.token!, path, ref.read(cacheProvider))).data;
}

Future<dynamic> _send(WidgetRef ref, String path, Map<String, dynamic> body) {
  final s = ref.read(sessionProvider);
  return ref.read(apiProvider).postOnline(s.school!, s.token!, path, body);
}

/// Student tutor (tutor = true) or teacher tools. Needs a connection: nothing is queued offline.
class AssistantScreen extends ConsumerStatefulWidget {
  final bool tutor;
  const AssistantScreen({super.key, this.tutor = false});
  @override
  ConsumerState<AssistantScreen> createState() => _AssistantState();
}

class _AssistantState extends ConsumerState<AssistantScreen> {
  final input = TextEditingController();
  final chat = <MapEntry<String, String>>[];
  String kind = 'summarize';
  String message = '';
  Map<String, dynamic>? result;
  bool busy = false;

  Future<void> _run() async {
    if (input.text.trim().isEmpty) return;
    setState(() {
      busy = true;
      message = '';
    });
    try {
      final k = widget.tutor ? 'tutor' : kind;
      final r = await _send(ref, '/ai/assist', {'kind': k, 'text': input.text, 'lang': 'fr', 'target': 'en'}) as Map<String, dynamic>;
      final out = r['output'] as Map<String, dynamic>;
      setState(() {
        if (widget.tutor) {
          chat.add(MapEntry('Moi', input.text));
          chat.add(MapEntry('Tuteur', '${out['reply']}'));
          input.clear();
        } else {
          result = r;
        }
        if (r['simulated'] == true) message = 'Réponse simulée (aucun modèle branché)';
      });
    } catch (e) {
      setState(() => message = '$e');
    } finally {
      setState(() => busy = false);
    }
  }

  /// Teacher validation step: the generated questions become a quiz (gamification) only when the teacher picks a class and a subject and confirms.
  Future<void> _saveQcm() async {
    final out = result!['output'] as Map<String, dynamic>;
    try {
      final classes = ((await _get(ref, '/classes')) as List).cast<Map<String, dynamic>>();
      final subjects = ((await _get(ref, '/subjects')) as List).cast<Map<String, dynamic>>();
      if (!mounted) return;
      String? cls = classes.isEmpty ? null : classes.first['id'] as String;
      String? subj = subjects.isEmpty ? null : subjects.first['id'] as String;
      final title = TextEditingController(text: 'QCM');
      final ok = await showDialog<bool>(
        context: context,
        builder: (c) => StatefulBuilder(
          builder: (c, set) => AlertDialog(
            title: const Text('Enregistrer comme QCM / Save as quiz'),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              TextField(controller: title, decoration: const InputDecoration(labelText: 'Titre / Title')),
              DropdownButton<String>(isExpanded: true, value: cls, hint: const Text('Classe / Class'), items: [for (final x in classes) DropdownMenuItem(value: x['id'] as String, child: Text('${x['name']}'))], onChanged: (v) => set(() => cls = v)),
              DropdownButton<String>(isExpanded: true, value: subj, hint: const Text('Matière / Subject'), items: [for (final x in subjects) DropdownMenuItem(value: x['id'] as String, child: Text('${x['name']}'))], onChanged: (v) => set(() => subj = v)),
            ]),
            actions: [
              TextButton(onPressed: () => Navigator.pop(c, false), child: const Text('Annuler / Cancel')),
              FilledButton(onPressed: cls == null || subj == null ? null : () => Navigator.pop(c, true), child: const Text('Valider / Confirm')),
            ],
          ),
        ),
      );
      if (ok != true) return;
      await _send(ref, '/ai/qcm/save', {'class_id': cls, 'subject_id': subj, 'title': title.text, 'questions': out['questions']});
      if (mounted) setState(() => message = 'QCM enregistré, disponible dans les jeux / Quiz saved');
    } catch (e) {
      if (mounted) setState(() => message = '$e');
    }
  }

  String _render(Map<String, dynamic> r) {
    final o = r['output'] as Map<String, dynamic>;
    if (o['summary'] != null) return '${o['summary']}';
    if (o['text'] != null) return '${o['text']}';
    if (o['exercises'] != null) return [for (final e in o['exercises'] as List) '• $e'].join('\n');
    if (o['questions'] != null) {
      return [
        for (final q in o['questions'] as List) '${q['prompt']}\n${[for (var i = 0; i < (q['choices'] as List).length; i++) '${i == q['correct'] ? '✔' : '○'} ${q['choices'][i]}'].join('\n')}'
      ].join('\n\n');
    }
    return '$o';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text(widget.tutor ? 'Tuteur' : 'Assistant pédagogique')),
      body: ListView(padding: const EdgeInsets.all(12), children: [
        if (message.isNotEmpty) Semantics(liveRegion: true, child: Text(message)),
        const Text('Les noms, e-mails et téléphones sont remplacés par des pseudonymes avant tout envoi au modèle. Les propositions sont validées par l’enseignant.'),
        if (!widget.tutor)
          DropdownButton<String>(
            value: kind,
            items: const [
              DropdownMenuItem(value: 'summarize', child: Text('Résumé de cours')),
              DropdownMenuItem(value: 'qcm', child: Text('Générer un QCM')),
              DropdownMenuItem(value: 'exercises', child: Text('Exercices')),
              DropdownMenuItem(value: 'translate', child: Text('Traduction FR → EN')),
            ],
            onChanged: (v) => setState(() {
              kind = v ?? 'summarize';
              result = null;
            }),
          ),
        if (widget.tutor)
          for (final c in chat) ListTile(dense: true, title: Text(c.key), subtitle: Text(c.value)),
        TextField(controller: input, minLines: 3, maxLines: 8, decoration: InputDecoration(labelText: widget.tutor ? 'Ta question' : 'Texte')),
        FilledButton(onPressed: busy ? null : _run, child: Text(busy ? '…' : 'Envoyer')),
        if (!widget.tutor && result != null) Padding(padding: const EdgeInsets.only(top: 12), child: SelectableText(_render(result!))),
        if (!widget.tutor && result != null && kind == 'qcm' && (result!['output'] as Map)['questions'] != null)
          Align(alignment: Alignment.centerLeft, child: OutlinedButton.icon(icon: const Icon(Icons.save), label: const Text('Enregistrer comme QCM'), onPressed: _saveQcm)),
      ]),
    );
  }
}

/// 3D models with AR (ARCore Scene Viewer / iOS AR Quick Look via model-viewer) and 360° panoramas (drag to look around). Falls back to the text description.
class XrViewerScreen extends ConsumerStatefulWidget {
  const XrViewerScreen({super.key});
  @override
  ConsumerState<XrViewerScreen> createState() => _XrState();
}

class _XrState extends ConsumerState<XrViewerScreen> {
  List<Map<String, dynamic>> items = [];
  Map<String, dynamic>? sel;
  String message = '';

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final l = (await _get(ref, '/xr/assets') as List).cast<Map<String, dynamic>>();
      setState(() {
        items = l;
        sel ??= l.isEmpty ? null : l.first;
        message = '';
      });
    } catch (e) {
      setState(() => message = '$e');
    }
  }

  Widget _viewer(Map<String, dynamic> a) {
    final alt = '${a['alt_text']}';
    if (a['kind'] == 'model_3d') {
      return SizedBox(
        height: 360,
        child: ModelViewer(
          key: ValueKey(a['id']),
          src: '${a['url']}',
          iosSrc: a['ios_url'] == null ? null : '${a['ios_url']}',
          alt: alt,
          ar: true,
          arModes: const ['scene-viewer', 'quick-look', 'webxr'],
          autoRotate: false,
          cameraControls: true,
          disableZoom: false,
        ),
      );
    }
    return Semantics(
      label: alt,
      image: true,
      child: SizedBox(
        height: 280,
        child: InteractiveViewer(
          constrained: false,
          minScale: 0.5,
          maxScale: 3,
          child: Image.network('${a['url']}', height: 280, errorBuilder: (_, __, ___) => Padding(padding: const EdgeInsets.all(16), child: Text(alt))),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('3D / AR / 360°')),
      body: ListView(padding: const EdgeInsets.all(8), children: [
        if (message.isNotEmpty) Semantics(liveRegion: true, child: Text(message)),
        for (final a in items)
          ListTile(
            selected: identical(a, sel) || a['id'] == sel?['id'],
            title: Text('${a['title']}'),
            subtitle: Text(a['kind'] == 'model_3d' ? 'Modèle 3D (AR disponible sur appareil compatible)' : 'Panorama 360° — glisser pour regarder autour'),
            onTap: () => setState(() => sel = a),
          ),
        if (sel != null) ...[_viewer(sel!), Padding(padding: const EdgeInsets.all(8), child: Text('${sel!['alt_text']}'))],
        if (items.isEmpty && message.isEmpty) const Padding(padding: EdgeInsets.all(16), child: Text('Aucun contenu 3D pour le moment.')),
      ]),
    );
  }
}

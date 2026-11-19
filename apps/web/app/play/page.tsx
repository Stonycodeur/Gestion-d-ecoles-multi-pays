'use client';
import { useEffect, useState } from 'react';
import Shell from '../../components/Shell';
import { api } from '../../lib/api';

export default function PlayPage() {
  const [quizzes, setQuizzes] = useState<any[]>([]); const [attempt, setAttempt] = useState<any>(null);
  const [answers, setAnswers] = useState<Record<string, number>>({}); const [result, setResult] = useState<any>(null);
  const [board, setBoard] = useState<any[]>([]); const [scope, setScope] = useState('class'); const [msg, setMsg] = useState('');
  useEffect(() => { api('/quizzes').then((r) => setQuizzes(r.data ?? [])); }, []);
  useEffect(() => { api(`/leaderboards?scope=${scope}`).then((r) => setBoard(r.ok ? r.data : [])); }, [scope, result]);
  const start = async (id: string) => {
    const r = await api(`/quizzes/${id}/start`, { method: 'POST', body: {} });
    if (r.ok) { setAttempt(r.data); setAnswers({}); setResult(null); setMsg(''); } else setMsg(r.error ?? 'error');
  };
  const submit = async () => {
    const r = await api(`/quiz-attempts/${attempt.attempt_id}/submit`, { method: 'POST', body: { answers } });
    if (r.ok) { setResult(r.data); setAttempt(null); } else setMsg(r.error ?? 'error');
  };
  return (
    <Shell>
      <h1>Jeux et quiz</h1>
      {!attempt && <ul>{quizzes.map((q) => <li key={q.id}>{q.title} ({q.mode}) <button onClick={() => start(q.id)}>Jouer</button></li>)}</ul>}
      {attempt && (
        <form onSubmit={(e) => { e.preventDefault(); void submit(); }}>
          {attempt.questions.map((q: any) => (
            <fieldset key={q.id}><legend>{q.prompt}</legend>
              {q.choices.map((c: any) => (
                <label key={c.orig} style={{ display: 'block' }}>
                  <input type="radio" name={q.id} checked={answers[q.id] === c.orig} onChange={() => setAnswers({ ...answers, [q.id]: c.orig })} /> {c.text}
                </label>))}
            </fieldset>))}
          <button type="submit">Valider</button>
        </form>
      )}
      {result && <p role="status">Score {result.score100}/100 · +{result.xp} XP{result.badges?.length ? ` · badges : ${result.badges.join(', ')}` : ''}{result.boss_defeated ? ' · Boss vaincu !' : ''}</p>}
      <p role="status">{msg}</p>
      <h2>Classement</h2>
      <select aria-label="portée" value={scope} onChange={(e) => setScope(e.target.value)}><option value="class">Classe</option><option value="school">École</option></select>
      <ol>{board.map((b) => <li key={b.rank + b.name}>{b.rank}. {b.name} — {b.points} XP</li>)}</ol>
    </Shell>
  );
}

// @ts-nocheck
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import SEO from '@/components/SEO';
import { csrfFetch } from '@/lib/csrf';
import { Button } from '@/components/ui/button';
import { PASSWORD_RULE, passwordMessage, passwordProblems } from '@/lib/passwordPolicy';

const post = async (path, body) => {
  const r = await csrfFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('api'), { status: r.status, body: out });
  return out;
};

/**
 * R24 (owner decision R21.1) — the institutional partner's self-service reset:
 *   /institution/mot-de-passe-oublie : the registered e-mail address -> a link valid 30 minutes, once (the answer never says whether the address is known);
 *   /institution/reinitialiser#token=… : choose a new password under the shared rule; every session ends. The token travels in the URL fragment (never sent to
 *   a server or a log) and is removed from the address bar at once. The administrator-assisted recovery stays the fallback.
 */
export function InstitutionForgot() {
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault(); setError(''); setMessage('');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Indiquez l’adresse e-mail de votre compte institutionnel.');
    setBusy(true);
    try { setMessage((await post('/api/institution/forgot', { email: email.trim() })).message || ''); }
    catch (x) { setError(x.body?.message || 'Demande impossible pour le moment. Réessayez plus tard.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-md space-y-4 p-4" data-testid="institution-forgot-page">
      <SEO title="Mot de passe oublié — espace institutionnel" description="Recevoir un lien de réinitialisation" path="/institution/mot-de-passe-oublie" noindex={true} />
      <h1 className="text-2xl font-bold">Mot de passe oublié</h1>
      <p className="text-sm">Indiquez l’adresse e-mail enregistrée par ADA pour votre compte institutionnel : si le compte est actif, vous recevrez un lien valable 30 minutes, utilisable une seule fois.</p>
      {error ? <p role="alert" className="text-red-800" data-testid="institution-forgot-error">{error}</p> : null}
      <p role="status" className="text-green-800" data-testid="institution-forgot-done">{message}</p>
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div><label htmlFor="forgot-email" className="block">Adresse e-mail</label><input id="forgot-email" type="email" autoComplete="username" className="w-full rounded border p-2" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
        <Button type="submit" disabled={busy}>Recevoir un lien</Button>
      </form>
      <p className="text-sm" data-testid="institution-forgot-fallback">Si vous n’avez plus accès à cette adresse ou si l’e-mail n’arrive pas, écrivez à l’équipe ADA depuis la page <Link to="/contact" className="underline">Contact</Link> : après vérification, un administrateur vous remet un mot de passe provisoire par un canal séparé.</p>
      <p><Link to="/institution" className="underline">Retour à la connexion</Link></p>
    </div>
  );
}

export function InstitutionReset() {
  const location = useLocation();
  const token = useRef('');
  const [next, setNext] = useState(''); const [again, setAgain] = useState('');
  const [error, setError] = useState(''); const [done, setDone] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => {
    const m = /(?:^|[#&])token=([a-f0-9]{64})/.exec(location.hash || '');
    if (m) { token.current = m[1]; try { window.history.replaceState(null, '', window.location.pathname); } catch { /* the token simply stays in the address bar */ } }
    else if (!token.current) setError('Ce lien est incomplet. Ouvrez le lien reçu par e-mail, ou demandez-en un nouveau.');
  }, [location.hash]);
  const submit = async (e) => {
    e.preventDefault(); setError(''); setDone('');
    if (!token.current) return setError('Ce lien est incomplet. Ouvrez le lien reçu par e-mail, ou demandez-en un nouveau.');
    const problems = passwordProblems(next);
    if (problems.length) return setError(passwordMessage(problems));
    if (next !== again) return setError('Les deux saisies du nouveau mot de passe sont différentes.');
    setBusy(true);
    try { const out = await post('/api/institution/reset', { token: token.current, password: next }); token.current = ''; setNext(''); setAgain(''); setDone(out.message || 'Mot de passe enregistré.'); }
    catch (x) { setError(x.body?.message || 'Enregistrement impossible pour le moment. Réessayez.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="mx-auto max-w-md space-y-4 p-4" data-testid="institution-reset-page">
      <SEO title="Nouveau mot de passe — espace institutionnel" description="Choisir un nouveau mot de passe" path="/institution/reinitialiser" noindex={true} />
      <h1 className="text-2xl font-bold">Choisir un nouveau mot de passe</h1>
      {error ? <p role="alert" className="text-red-800" data-testid="institution-reset-error">{error}</p> : null}
      <p role="status" className="text-green-800" data-testid="institution-reset-done">{done}</p>
      {done ? <p><Link to="/institution" className="underline" data-testid="institution-reset-login">Se connecter</Link></p> : (
        <form onSubmit={submit} className="space-y-3" noValidate>
          <div><label htmlFor="reset-new" className="block">Nouveau mot de passe</label><input id="reset-new" type="password" autoComplete="new-password" aria-describedby="reset-rule" className="w-full rounded border p-2" value={next} onChange={(e) => setNext(e.target.value)} required />
            <p id="reset-rule" className="text-sm">{PASSWORD_RULE}</p></div>
          <div><label htmlFor="reset-again" className="block">Confirmer le nouveau mot de passe</label><input id="reset-again" type="password" autoComplete="new-password" className="w-full rounded border p-2" value={again} onChange={(e) => setAgain(e.target.value)} required /></div>
          <Button type="submit" disabled={busy}>Enregistrer le mot de passe</Button>
          <p className="text-sm">Toutes vos sessions ouvertes seront fermées.</p>
        </form>
      )}
      <p className="text-sm"><Link to="/institution/mot-de-passe-oublie" className="underline">Demander un nouveau lien</Link></p>
    </div>
  );
}

export default InstitutionForgot;

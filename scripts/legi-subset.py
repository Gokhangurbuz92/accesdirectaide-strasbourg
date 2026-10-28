#!/usr/bin/env python3
"""
D15 — legal articles behind data/rules/rights-rules.v1.json, from the DILA LEGI open dataset (Licence Ouverte 2.0), WITHOUT storing the corpus.

The global LEGI archive (≈ 1.2 GB) and every later daily delta are STREAMED (HTTP → gzip → tar, member by member); only the article files of the cited
codes whose number falls in a cited reference are parsed and kept. Deltas are applied in date order (later versions replace earlier ones; the delta's
liste_suppression_legi.dat removes files). The SHA-256 of every archive read is recorded, so the extraction is reproducible and auditable.

Output (small JSON): for every right and every legalBasis entry, the matching articles with their LEGIARTI id, état, effective dates (DATE_DEBUT /
DATE_FIN), the version chain, a Légifrance link, the plain text and its SHA-256 — or the reason why the entry cannot be resolved from the codes
(décret, arrêté, annexe: not code articles). This is an attachment of official texts, NOT a legal reading: no rule is derived from it.

Incremental refresh (--state FILE): a full run also writes the extraction state (every kept article version and text, the archives read) to FILE
(gzip JSON, kept OUTSIDE the source tree); a later run with --incremental reads it and streams ONLY the daily deltas published after the last one applied,
so a refresh reads a few MB instead of the 1.2 GB global archive. The result is the same as a full run over the same archives (same store, same archive
log). It refuses (exit 3, nothing written) when a full run is needed: no or unreadable state, other register (rules SHA-256) or base URL, a newer global
archive, or a delta older than the last applied one that was never read.

Usage: python3 -I scripts/legi-subset.py --rules data/rules/rights-rules.v1.json --out data/rules/legal-articles.v1.json
          [--base-url https://echanges.dila.gouv.fr/OPENDATA/LEGI/] [--max-deltas N] [--reference-date YYYY-MM-DD] [--state FILE [--incremental]]
"""
import argparse, datetime, gzip, hashlib, html, io, json, os, re, sys, tarfile, urllib.request

CODES = {   # code label in rights-rules.v1.json → LEGITEXT id of the code (Légifrance)
    'CASF': ('LEGITEXT000006074069', "Code de l'action sociale et des familles"),
    'CSS': ('LEGITEXT000006073189', 'Code de la sécurité sociale'),
    'CCH': ('LEGITEXT000006074096', "Code de la construction et de l'habitation"),
    'Code du travail': ('LEGITEXT000006072050', 'Code du travail'),
}
TEXT_IDS = {v[0]: k for k, v in CODES.items()}
NUM_RE = re.compile(r'^([LRDA])(\d+(?:-\d+)*)$')
ANNEXE_RE = re.compile(r'^annexe\s+(\d+(?:-\d+)*)$', re.I)
GLOBAL_RE = re.compile(r'Freemium_legi_global_(\d{8})-\d{6}\.tar\.gz')
DELTA_RE = re.compile(r'LEGI_(\d{8})-\d{6}\.tar\.gz')


def num_key(num):
    a = ANNEXE_RE.match(num.strip())
    if a: return ('ANNEXE', tuple(int(x) for x in a.group(1).split('-')))
    m = NUM_RE.match(num.strip())
    return (m.group(1), tuple(int(x) for x in m.group(2).split('-'))) if m else None


MONTHS = {m: i + 1 for i, m in enumerate(['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'])}
# An arrêté is cited by its date only; a few title words (from the register's own wording or the official title) pick the right one. Several matches = unresolved.
ARRETE_KEYWORDS = {'2019-09-27': 'aides personnelles au logement', '2024-12-19': 'assurance chômage'}


def parse_texts(entry):
    """'Décret n°2025-293 du 29 mars 2025', 'Décrets 2019-797 et 2023-33', 'Arrêté du 19 décembre 2024 (…)' → [{'nature', 'num'|None, 'date'|None, 'keyword'|None}]."""
    t = entry.strip(); out = []
    if re.match(r'^D[ée]crets?\b', t):
        for n in re.findall(r'\b(\d{4}-\d+)\b', t): out.append({'nature': 'DECRET', 'num': n, 'date': None, 'keyword': None})
    m = re.match(r'^Arr[êe]t[ée] du (\d{1,2})(?:er)? (\w+) (\d{4})', t)
    if m and m.group(2).lower() in MONTHS:
        d = '%s-%02d-%02d' % (m.group(3), MONTHS[m.group(2).lower()], int(m.group(1)))
        out.append({'nature': 'ARRETE', 'num': None, 'date': d, 'keyword': ARRETE_KEYWORDS.get(d)})
    return out


def text_matches(want, meta):
    if meta['nature'] != want['nature']: return False
    if want['num']: return meta['num'] == want['num']
    return meta['dateTexte'] == want['date'] and bool(want['keyword']) and want['keyword'].lower() in (meta['title'] or '').lower()


def parse_basis(entry):
    """'CASF L262-2 à L262-12' → ('CASF', [('range', k1, k2)]) ; 'CSS R843-1, R843-2' → singles ; otherwise (None, reason)."""
    text = re.sub(r'\([^)]*\)', '', entry).strip()
    code = next((c for c in sorted(CODES, key=len, reverse=True) if text.startswith(c + ' ')), None)
    if not code:
        return None, 'outside the cited codes (décret, arrêté or other text): attach from JORF, not LEGI codes'
    items, rest = [], text[len(code):].strip()
    for part in [p.strip() for p in rest.split(',') if p.strip()]:
        if ' à ' in part:
            a, b = [num_key(x) for x in part.split(' à ', 1)]
            if not a or not b: return None, 'unparsed range: ' + part
            items.append(('range', a, b))
        else:
            k = num_key(part)
            if not k: return None, 'not an article number: ' + part
            items.append(('one', k, k))   # an « annexe N-N » is matched on the article number « Annexe N-N »
    return code, items


def family(prefix):
    return 'RD' if prefix in ('R', 'D') else prefix


def matches(items, key):
    for _, a, b in items:
        if family(key[0]) == family(a[0]) == family(b[0]) and a[1] <= key[1] <= b[1]:
            return True
    return False


def tag(xml, name):
    m = re.search(r'<%s>(.*?)</%s>' % (name, name), xml, re.S)
    return m.group(1).strip() if m else None


def plain(xml):
    m = re.search(r'<BLOC_TEXTUEL>\s*<CONTENU>(.*?)</CONTENU>', xml, re.S)
    if not m: return ''
    t = re.sub(r'<br\s*/?>|</p>', '\n', m.group(1)); t = re.sub(r'<[^>]+>', '', t)
    return re.sub(r'\n{3,}', '\n\n', html.unescape(t)).strip()


class HashingReader(io.RawIOBase):
    def __init__(self, raw): self.raw, self.h, self.n = raw, hashlib.sha256(), 0
    def readable(self): return True
    def readinto(self, b):
        chunk = self.raw.read(len(b))
        if not chunk: return 0
        self.h.update(chunk); self.n += len(chunk); b[:len(chunk)] = chunk; return len(chunk)


def stream(url, wanted, store, log, wanted_texts=(), texts=None):
    req = urllib.request.Request(url, headers={'User-Agent': 'AccesDirectAide-LAB legi-subset (D15)'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        hr = HashingReader(resp); kept = removed = 0
        with tarfile.open(fileobj=io.BufferedReader(hr, 1 << 20), mode='r|gz') as tar:
            for m in tar:
                tar.members = []   # streaming mode keeps every header otherwise (≈ 1.6 M members in the global archive)
                name = m.name
                if name.endswith('liste_suppression_legi.dat') and m.isfile():
                    for line in tar.extractfile(m).read().decode('utf-8', 'replace').splitlines():
                        aid = line.strip().rsplit('/', 1)[-1]
                        if aid in store: del store[aid]; removed += 1
                        if texts is not None and aid in texts: del texts[aid]; removed += 1
                    continue
                if wanted_texts and m.isfile() and '/TNC_' in name and '/texte/version/' in name and name.endswith('.xml'):
                    xml = tar.extractfile(m).read().decode('utf-8', 'replace')
                    meta = {'nature': tag(xml, 'NATURE'), 'num': tag(xml, 'NUM') or None, 'dateTexte': tag(xml, 'DATE_TEXTE'), 'title': tag(xml, 'TITREFULL')}
                    if any(text_matches(w, meta) for w in wanted_texts):
                        tid = tag(xml, 'ID'); cid = tag(xml, 'CID')
                        texts[tid] = dict(meta, kind='text', id=tid, cid=cid, nor=tag(xml, 'NOR'), etat=tag(xml, 'ETAT'), dateDebut=tag(xml, 'DATE_DEBUT'), dateFin=tag(xml, 'DATE_FIN'),
                                          url='https://www.legifrance.gouv.fr/loda/id/' + (cid or tid))
                        kept += 1
                    continue
                if not (m.isfile() and '/article/' in name and name.endswith('.xml')): continue
                tid = next((t for t in TEXT_IDS if '/' + t + '/' in name), None)
                if not tid: continue
                xml = tar.extractfile(m).read().decode('utf-8', 'replace')
                num = tag(xml, 'NUM'); key = num_key(num or '')
                if not key or not any(matches(items, key) for items in wanted.get(TEXT_IDS[tid], [])): continue
                aid = tag(xml, 'ID')
                versions = [dict(zip(('debut', 'etat', 'fin', 'id'), v)) for v in re.findall(r'<LIEN_ART debut="([^"]*)" etat="([^"]*)" fin="([^"]*)" id="([^"]*)"', xml)]
                text = plain(xml)
                store[aid] = {'id': aid, 'code': TEXT_IDS[tid], 'num': num, 'etat': tag(xml, 'ETAT'), 'dateDebut': tag(xml, 'DATE_DEBUT'), 'dateFin': tag(xml, 'DATE_FIN'),
                              'versions': versions, 'text': text, 'textSha256': hashlib.sha256(text.encode('utf-8')).hexdigest()}
                kept += 1
    log({'archive': url.rsplit('/', 1)[-1], 'bytes': hr.n, 'sha256': hr.h.hexdigest(), 'articlesKept': kept, 'removed': removed})


def load_state(path):
    try:
        with gzip.open(path, 'rt', encoding='utf-8') as f: st = json.load(f)
        return st if st.get('schema') == 'ADA_LEGI_SUBSET_STATE_V1' else None
    except (OSError, ValueError): return None


def refuse_reason(st, rules_sha, base_url, glob, deltas):
    """Why the saved state cannot be extended by the published deltas (None when it can)."""
    if not st: return 'no readable state'
    if st['rulesSha256'] != rules_sha: return 'the register changed (rules SHA-256)'
    if st['baseUrl'] != base_url: return 'other base URL'
    if st['baseArchive'] != glob: return 'a newer global archive is published (%s, state: %s)' % (glob, st['baseArchive'])
    done = [x['archive'] for x in st['archives']]
    if not done or done[0] != glob: return 'the state does not start with the global archive'
    last = done[-1] if len(done) > 1 else None
    missing = [n for n in deltas if n not in done and last and n < last]
    if missing: return 'delta(s) older than the last applied one were never read: ' + ', '.join(missing[:3])
    if [n for n in done[1:] if n not in deltas]: return 'an applied delta is no longer published'
    return None


def save_state(path, st):   # atomic: a crash never leaves a half-written state
    tmp = path + '.tmp'
    with open(tmp, 'wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as f: f.write(json.dumps(st, ensure_ascii=False).encode('utf-8'))
    os.replace(tmp, path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--rules', required=True); ap.add_argument('--out', required=True); ap.add_argument('--index-out', default=None)
    ap.add_argument('--base-url', default='https://echanges.dila.gouv.fr/OPENDATA/LEGI/')
    ap.add_argument('--max-deltas', type=int, default=None); ap.add_argument('--reference-date', default=datetime.date.today().isoformat())
    ap.add_argument('--state', default=None); ap.add_argument('--incremental', action='store_true')
    a = ap.parse_args()
    if a.incremental and not a.state: sys.exit('--incremental needs --state')
    rules_sha = hashlib.sha256(open(a.rules, 'rb').read()).hexdigest()
    rules = json.load(open(a.rules, encoding='utf-8'))
    wanted, parsed, wanted_texts = {}, [], []
    for r in rules['rights']:
        for entry in r.get('legalBasis', []):
            code, items = parse_basis(entry)
            parsed.append((r['id'], entry, code, items))
            if code: wanted.setdefault(code, []).append(items)
            else: wanted_texts.extend(parse_texts(entry))
    listing = urllib.request.urlopen(urllib.request.Request(a.base_url, headers={'User-Agent': 'AccesDirectAide-LAB legi-subset (D15)'}), timeout=60).read().decode('utf-8', 'replace')
    names = sorted(set(re.findall(r'href="([^"]+\.tar\.gz)"', listing)))
    glob = sorted(n for n in names if GLOBAL_RE.fullmatch(n))[-1]; gdate = GLOBAL_RE.fullmatch(glob).group(1)
    deltas = sorted(n for n in names if DELTA_RE.fullmatch(n) and DELTA_RE.fullmatch(n).group(1) >= gdate)
    if a.max_deltas is not None: deltas = deltas[:a.max_deltas]
    store, archives, texts = {}, [], {}
    todo = [glob] + deltas
    if a.incremental:
        st = load_state(a.state)
        why = refuse_reason(st, rules_sha, a.base_url, glob, deltas)
        if why: print('incremental refresh refused (a full run is needed): ' + why, file=sys.stderr); sys.exit(3)
        store, texts, archives = st['store'], st['texts'], st['archives']
        done = {x['archive'] for x in archives}; todo = [n for n in deltas if n not in done]
        print(json.dumps({'incremental': True, 'alreadyApplied': len(done), 'newDeltas': todo}), file=sys.stderr, flush=True)
    def log(x): archives.append(x); print(json.dumps(x), file=sys.stderr, flush=True)
    for n in todo: stream(a.base_url + n, wanted, store, log, wanted_texts, texts)
    applied = [x['archive'] for x in archives]
    deltas = applied[1:]   # what was really applied, in order (the same list as a full run's when the refresh is accepted)
    if a.state: save_state(a.state, {'schema': 'ADA_LEGI_SUBSET_STATE_V1', 'rulesSha256': rules_sha, 'baseUrl': a.base_url, 'baseArchive': glob, 'archives': archives, 'store': store, 'texts': texts})
    ref = a.reference_date; refs = []
    for right, entry, code, items in parsed:
        if not code:
            want = parse_texts(entry)
            found = []
            for w in want:
                hits = [t for t in texts.values() if text_matches(w, t) and (t['dateDebut'] or '') <= ref < (t['dateFin'] or '2999-01-01')]
                if len(hits) == 1: found.append(hits[0])
            if want and len(found) == len(want):
                refs.append({'right': right, 'basis': entry, 'resolved': [dict(t, num=t['title']) for t in found], 'unresolved': None}); continue
            reason = items if not want else ('%d of %d cited text(s) found in force in LEGI on %s (none guessed when ambiguous)' % (len(found), len(want), ref))
            refs.append({'right': right, 'basis': entry, 'resolved': [], 'unresolved': reason}); continue
        arts = [x for x in store.values() if x['code'] == code and matches(items, num_key(x['num']))]
        inforce = {}
        for x in arts:   # the version in force on the reference date, one per article number
            if (x['dateDebut'] or '') <= ref < (x['dateFin'] or '2999-01-01'): inforce[x['num']] = x
        out = [dict(x, url='https://www.legifrance.gouv.fr/codes/article_lc/' + x['id']) for x in sorted(inforce.values(), key=lambda x: num_key(x['num']))]
        refs.append({'right': right, 'basis': entry, 'code': CODES[code][1], 'codeId': CODES[code][0], 'resolved': out,
                     'unresolved': None if out else 'no article of this reference is in force on %s in the LEGI data read' % ref})
    doc = {'schema': 'ADA_LEGAL_ARTICLES_V1', 'referenceDate': ref,
           'source': {'producer': 'DILA', 'dataset': 'LEGI (codes en vigueur)', 'licence': 'Licence Ouverte / Open Licence 2.0', 'attribution': 'Direction de l’information légale et administrative (DILA) — Légifrance',
                      'baseUrl': a.base_url, 'baseArchive': glob, 'lastDelta': deltas[-1] if deltas else None, 'deltasApplied': len(deltas), 'archives': archives},
           'statement': 'Textes officiels rattachés aux références citées par le registre de recherche. Ce n’est pas une lecture juridique : aucune règle n’en est déduite automatiquement.',
           'references': refs}
    json.dump(doc, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    if a.index_out:   # the browser gets numbers, dates and links only (no article text): small and enough to show the attachment
        idx = {'schema': 'ADA_LEGAL_ARTICLES_INDEX_V1', 'referenceDate': ref, 'source': {k: doc['source'][k] for k in ('producer', 'dataset', 'licence', 'attribution', 'baseArchive', 'lastDelta', 'deltasApplied')},
               'references': [{'right': r['right'], 'basis': r['basis'], 'code': r.get('code'), 'unresolved': r['unresolved'],
                               'articles': [{'num': x['num'], 'id': x['id'], 'dateDebut': x['dateDebut'], 'url': x['url'], 'kind': x.get('kind', 'article')} for x in r['resolved']]} for r in refs]}
        json.dump(idx, open(a.index_out, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(json.dumps({'articles': sum(len(r['resolved']) for r in refs), 'resolvedEntries': sum(1 for r in refs if r['resolved']), 'entries': len(refs)}))


if __name__ == '__main__':
    main()

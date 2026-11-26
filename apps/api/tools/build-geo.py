#!/usr/bin/env python3
"""Builds apps/api/geo-data from github.com/dr5hn/countries-states-cities-database (ODbL-1.0, attribution in docs/GEO.md).
Usage: python3 tools/build-geo.py <path-to-clone>/json   (output: geo-data/countries.json + geo-data/regions/<ISO2>.json.gz)"""
import gzip, json, os, sys

src = sys.argv[1]
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'geo-data')
os.makedirs(os.path.join(out, 'regions'), exist_ok=True)
AR = {'AF': 'أفريقيا', 'AS': 'آسيا', 'EU': 'أوروبا', 'NA': 'أمريكا الشمالية', 'SA': 'أمريكا الجنوبية', 'OC': 'أوقيانوسيا', 'AN': 'أنتاركتيكا'}
CONT = {'AF': ('Afrique', 'Africa'), 'AS': ('Asie', 'Asia'), 'EU': ('Europe', 'Europe'), 'NA': ('Amérique du Nord', 'North America'),
        'SA': ('Amérique du Sud', 'South America'), 'OC': ('Océanie', 'Oceania'), 'AN': ('Antarctique', 'Antarctica')}

def continent(c):
    r, sr = c['region'], c.get('subregion') or ''
    if r == 'Africa': return 'AF'
    if r == 'Asia': return 'AS'
    if r == 'Europe': return 'EU'
    if r == 'Oceania': return 'OC'
    if r == 'Polar': return 'AN'
    if r == 'Americas': return 'SA' if sr == 'South America' else 'NA'
    return 'AN'

def tz_first(c):
    t = c.get('timezones')
    if isinstance(t, str):
        try: t = json.loads(t.replace("'", '"'))
        except Exception: t = None
    return (t[0]['zoneName'] if t else None)

countries = json.load(open(os.path.join(src, 'countries.json'), encoding='utf-8'))
full = {x['iso2']: x for x in json.load(open(os.path.join(src, 'countries+states+cities.json'), encoding='utf-8'))}
flat = {x['name']: x for x in json.load(open(os.path.join(src, 'countries+cities.json'), encoding='utf-8'))}
rows, ncity, nreg = [], 0, 0
for c in sorted(countries, key=lambda x: x['name']):
    iso = c['iso2']
    tr = c.get('translations')
    if isinstance(tr, str):
        try: tr = json.loads(tr.replace("'", '"'))
        except Exception: tr = {}
    k = continent(c)
    rows.append({'c': iso, 'i3': c['iso3'], 'n': c['name'], 'fr': (tr or {}).get('fr') or c['name'], 'nat': c.get('native') or c['name'], 'k': k,
                 'sr': c.get('subregion') or '', 'cap': c.get('capital') or '', 'cur': c.get('currency') or '', 'ph': c.get('phonecode') or '',
                 'tz': tz_first(c), 'em': c.get('emoji') or '', 'la': c.get('latitude'), 'lo': c.get('longitude')})
    regs = []
    for s in (full.get(iso) or {}).get('states', []):
        cities = [[ci['name'], ci.get('latitude'), ci.get('longitude')] for ci in s.get('cities', [])]
        regs.append({'id': s['id'], 'c': s.get('iso2') or '', 'n': s['name'], 't': s.get('type') or '', 'la': s.get('latitude'), 'lo': s.get('longitude'), 'ci': cities})
    if not regs:
        cities = [[n, None, None] for n in (flat.get(c['name']) or {}).get('cities', [])]
        regs.append({'id': 0, 'c': '', 'n': c['name'], 't': 'country', 'la': c.get('latitude'), 'lo': c.get('longitude'), 'ci': cities})
    nreg += len(regs); ncity += sum(len(r['ci']) for r in regs)
    with gzip.open(os.path.join(out, 'regions', iso + '.json.gz'), 'wt', encoding='utf-8', compresslevel=9) as f:
        json.dump(regs, f, ensure_ascii=False, separators=(',', ':'))
json.dump({'continents': [{'code': k, 'fr': v[0], 'en': v[1], 'ar': AR[k]} for k, v in CONT.items()], 'countries': rows}, open(os.path.join(out, 'countries.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
print(len(rows), 'countries', nreg, 'regions', ncity, 'cities')

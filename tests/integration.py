"""Integration checks against a local preview. Creates isolated test sessions only."""
import urllib.request, urllib.error, http.cookiejar, json, concurrent.futures, os
BASE = os.environ.get('TEST_BASE_URL', 'http://localhost:5173').rstrip('/')
assert BASE.startswith(('http://localhost:', 'http://127.0.0.1:')), 'Use a local test environment'
def client():
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def req(c, path, data=None, origin=None):
    r = urllib.request.Request(BASE+'/api/'+path, data=json.dumps(data).encode() if data is not None else None, headers={'Content-Type':'application/json','Origin':origin or BASE})
    try:
        with c.open(r, timeout=90) as x: return x.status, json.load(x)
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try: return e.code, json.loads(raw)
        except ValueError: return e.code, {'message':raw}
a, b = client(), client()
assert req(a, 'cart')[0] == 401
assert req(a, 'session', {}, 'https://unrelated.example')[0] == 403
code, initial = req(a, 'session', {}); assert code == 200
assert req(b, 'session', {})[0] == 200
code, d = req(a, 'products/515291'); assert code == 200, (code,d)
assert d['conflict'] is True
assert req(a, 'proposals', {'productId':'515291','quantity':1})[0] == 409
p = next(p for p in initial['catalog']['items'] if p['quantity'] and p['quantity']>3 and not p['conflict'] and not p['hasOffers'])
assert req(a, 'proposals', {'productId':p['id'],'quantity':0})[0] == 422
code, proposal = req(a, 'proposals', {'productId':p['id'],'quantity':2}); assert code == 201, (code,proposal)
assert req(a, 'cart')[1]['itemCount'] == 0
path = 'proposals/'+proposal['id']+'/confirm'
assert req(a, path, {'confirmed':False})[0] == 422
assert req(b, path, {'confirmed':True})[0] == 404
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:
    results = list(ex.map(lambda _:req(a,path,{'confirmed':True}),range(2)))
assert all(x[0]==200 for x in results), results
assert req(a, 'cart')[1]['itemCount'] == 2
assert req(a, path, {'confirmed':True})[1]['cart']['itemCount'] == 2
assert req(b, 'cart')[1]['itemCount'] == 0
assert req(a, 'proposals', {'productId':p['id'],'quantity':100000})[0] == 409
assert req(a, 'chat', {'text':'да, добавь'})[0] == 409
assert req(a, 'conversation/resume', {})[0] == 200
assert req(a, 'cart')[1]['itemCount'] == 2
assert req(a, 'cart/remove', {'productId':p['id'],'confirmed':False})[0] == 422
assert req(a, 'cart/remove', {'productId':p['id'],'confirmed':True})[1]['itemCount'] == 0
if initial.get('mode') == 'catalog':
    assert '160' in req(a, 'chat', {'text':'Проверить артикул 027228'})[1]['text']
    assert 'Здравствуйте' in req(a, 'chat', {'text':'чем ты можешь мне помочь'})[1]['text']
assert req(a, 'session', {})[1]['messages']
code, catalog = req(a, 'catalog/load', {}); assert code == 200 and len(catalog['items'])>=len(initial['catalog']['items'])
print('PASS: authentication, origin, isolation, conflicts, quantity, explicit confirmation, concurrent duplicate protection, replay, stock, chat read-only, removal, live SKU, help, persisted history, pagination')



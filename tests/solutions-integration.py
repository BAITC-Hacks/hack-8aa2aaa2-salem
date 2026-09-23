"""Local-only bundle transaction tests. Uses isolated sessions and their own fixtures."""
import urllib.request, urllib.error, http.cookiejar, json, sqlite3, pathlib, time, uuid, copy, concurrent.futures
BASE='http://127.0.0.1:5173'
root=pathlib.Path(__file__).resolve().parents[1]
files=list((root/'.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite'))
dbfile=next(p for p in files if sqlite3.connect(p).execute("SELECT COUNT(*) FROM sqlite_master WHERE name='solutions'").fetchone()[0])
def request(c,path,data=None):
 r=urllib.request.Request(BASE+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':BASE})
 try:
  with c.open(r,timeout=90) as x:return x.status,json.load(x)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
sessions=[]
def client():
 jar=http.cookiejar.CookieJar();c=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));assert request(c,'session',{})[0]==200
 sid=next(x.value for x in jar if x.name=='ekt_session');sessions.append(sid);return c,sid
def insert(sid,plan):
 with sqlite3.connect(dbfile) as d:d.execute('INSERT INTO solutions(id,session_id,payload,status,expires,created) VALUES(?,?,?,?,?,?)',(plan['id'],sid,json.dumps(plan),'pending',int(time.time()*1000)+900000,int(time.time()*1000)))
a,sid=client();b,other=client()
try:
 products=[request(a,'products/'+i)[1] for i in ['515282','515283']]
 def plan():
  needs=[{'id':str(j),'label':'Fixture','query':p['manufacturerSku'],'quantity':1,'constraints':[]} for j,p in enumerate(products)]
  items=[{'product':p,'quantity':1,'requirementId':str(j),'reason':'API test fixture','evidence':[],'subtotal':p['price']} for j,p in enumerate(products)]
  return {'id':str(uuid.uuid4()),'goal':'Test fixture','requirements':needs,'options':[{'key':'budget','title':'Fixture','summary':'Fixture','tradeoffs':[],'items':items,'total':sum(p['price'] for p in products)}],'report':{'assessment':'Test','assumptions':[],'exclusions':[],'nextSteps':[]},'createdAt':'2026-09-23T00:00:00Z','expiresAt':'2099-01-01T00:00:00Z','status':'pending','scope':'test'}
 p=plan();insert(sid,p);path='solutions/'+p['id']+'/select'
 assert request(a,path,{'optionKey':'budget','confirmed':False})[0]==422
 assert request(b,path,{'optionKey':'budget','confirmed':True})[0]==404
 assert request(a,path,{'optionKey':'invented','confirmed':True})[0]==422
 assert request(a,'cart')[1]['itemCount']==0
 with concurrent.futures.ThreadPoolExecutor(max_workers=2) as ex:results=list(ex.map(lambda _:request(a,path,{'optionKey':'budget','confirmed':True}),range(2)))
 assert all(r[0]==200 for r in results),results
 assert request(a,'cart')[1]['itemCount']==2
 assert request(a,path,{'optionKey':'budget','confirmed':True})[1]['replayed'] is True
 assert request(b,'cart')[1]['itemCount']==0
 for item in products:assert request(a,'cart/remove',{'productId':item['id'],'confirmed':True})[0]==200
 # One changed price must block the ENTIRE bundle.
 changed=copy.deepcopy(plan());changed['options'][0]['items'][1]['product']['price']+=1;insert(sid,changed)
 assert request(a,'solutions/'+changed['id']+'/select',{'optionKey':'budget','confirmed':True})[0]==409
 assert request(a,'cart')[1]['itemCount']==0
 # One insufficient component must also block all items.
 insufficient=plan();insufficient['options'][0]['items'][1]['quantity']=100000;insert(sid,insufficient)
 assert request(a,'solutions/'+insufficient['id']+'/select',{'optionKey':'budget','confirmed':True})[0]==409
 assert request(a,'cart')[1]['itemCount']==0
 # Pending bundle cannot exceed stock when cart already holds a product.
 full=plan();insert(sid,full)
 with sqlite3.connect(dbfile) as d:d.execute('INSERT INTO cart(session_id,product_id,product_json,quantity) VALUES(?,?,?,?)',(sid,products[1]['id'],json.dumps(products[1]),products[1]['quantity']))
 before=request(a,'cart')[1]['itemCount'];assert request(a,'solutions/'+full['id']+'/select',{'optionKey':'budget','confirmed':True})[0]==409
 assert request(a,'cart')[1]['itemCount']==before
 assert len(request(a,'cart')[1]['items'])==1
 for status in ['superseded','expired']:
  with sqlite3.connect(dbfile) as d:d.execute('UPDATE solutions SET status=? WHERE id=?',(status,full['id']))
  assert request(a,'solutions/'+full['id']+'/select',{'optionKey':'budget','confirmed':True})[0]==410
 print('PASS bundle API: explicit choice, session isolation, concurrent replay, whole-bundle atomicity, changed price, stock including existing cart, stale plans')
finally:
 with sqlite3.connect(dbfile) as d:
  for session in sessions:
   for table in ['messages','proposals','solutions','cart','agent_locks','sessions']:d.execute('DELETE FROM '+table+' WHERE '+('id' if table=='sessions' else 'session_id')+'=?',(session,))

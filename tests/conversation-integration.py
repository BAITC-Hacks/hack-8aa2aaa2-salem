"""Local-only API / real-model regression cases. Creates and removes its own sessions."""
import urllib.request, urllib.error, http.cookiejar, json, sqlite3, pathlib, uuid, time
BASE='http://127.0.0.1:5173'
root=pathlib.Path(__file__).resolve().parents[1]
dbfile=next(p for p in (root/'.wrangler/state/v3/d1/miniflare-D1DatabaseObject').glob('*.sqlite') if sqlite3.connect(p).execute("SELECT COUNT(*) FROM sqlite_master WHERE name='solutions'").fetchone()[0])
sessions=[]
def request(c,path,data=None):
 r=urllib.request.Request(BASE+'/api/'+path,data=json.dumps(data).encode() if data is not None else None,headers={'Content-Type':'application/json','Origin':BASE})
 try:
  with c.open(r,timeout=110) as response:return response.status,json.load(response)
 except urllib.error.HTTPError as e:return e.code,json.load(e)
def client():
 jar=http.cookiejar.CookieJar();c=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar));code,data=request(c,'session',{});assert code==200,(code,data)
 sid=next(x.value for x in jar if x.name=='ekt_session');sessions.append(sid);return c,sid
def message(sid,role,data):
 with sqlite3.connect(dbfile) as d:d.execute('INSERT INTO messages(id,session_id,role,content_json,created) VALUES(?,?,?,?,?)',(str(uuid.uuid4()),sid,role,json.dumps(data),int(time.time()*1000)))
def resume(c):assert request(c,'conversation/resume',{})[1]['conversationStatus']=='active'
def chat(c,text):
 code,result=request(c,'chat',{'text':text});assert code==200,(code,result);assert result['mode']=='agent',result
 print(json.dumps({'input':text,'output':result['text'],'status':result.get('conversationStatus'),'suggestions':result.get('suggestions')},ensure_ascii=True),flush=True);return result
try:
 c,sid=client();other,otherid=client()
 code,p=request(c,'proposals',{'productId':'515282','quantity':2});assert code==201,(code,p)
 message(sid,'assistant',{'text':'Подготовил две штуки. Добавить их в корзину?','proposal':p})
 # Exact consent now performs the transaction, no second button gate.
 result=chat(c,'да');assert result['cart']['itemCount']==2;assert result['conversationStatus']=='completed';assert result['suggestions']==[]
 assert request(c,'session',{})[1]['conversationStatus']=='completed';assert request(c,'chat',{'text':'ещё'})[0]==409
 assert request(other,'session',{})[1]['conversationStatus']=='active'
 resume(c)
 result=chat(c,'Добавь выбранный товар в корзину');assert request(c,'cart')[1]['itemCount']==2
 assert request(c,'session',{})[1]['conversationStatus']=='completed'
 resume(c)
 result=chat(c,'Поставь количество 3 штуки в корзине');assert result['cart']['itemCount']==3;assert result['conversationStatus']=='completed'
 resume(c)
 result=chat(c,'Удали этот товар из корзины');assert result['cart']['itemCount']==0
 assert request(other,'cart')[1]['itemCount']==0
 # A resolved informational task terminates without optional editing questions.
 result=chat(other,'Составь готовое короткое сообщение электрику: автомат отключается, маркировку прочитать невозможно, сам щит не открываю. Просто выдай текст, дополнительные варианты не нужны.')
 assert result['conversationStatus']=='completed',result;assert result['suggestions']==[]
 assert not any(x in result['text'].lower() for x in ['покороче','сделать короче','более безопасный вариант'])
 resume(other)
 result=chat(other,'Спасибо, этого достаточно.');assert result['conversationStatus']=='completed';assert result['suggestions']==[]
 # A saved one-option bundle can be chosen conversationally, not only by exact parser phrases.
 bundle,sid2=client();product=request(bundle,'products/515282')[1]
 plan={'id':str(uuid.uuid4()),'goal':'Тест выбранного комплекта','requirements':[{'id':'one','label':'Выбранная деталь','query':product['sku'],'quantity':1,'constraints':[]}],'options':[{'key':'budget','title':'Выбранный комплект','summary':'По согласованному артикулу','tradeoffs':[],'total':product['price'],'items':[{'product':product,'quantity':1,'requirementId':'one','reason':'Согласованный товар','evidence':[],'subtotal':product['price']}]}],'report':{'assessment':'Тест API','assumptions':[],'exclusions':[],'nextSteps':[]},'createdAt':'2026-09-23T00:00:00Z','expiresAt':'2099-01-01T00:00:00Z','status':'pending','scope':'test'}
 with sqlite3.connect(dbfile) as d:d.execute('INSERT INTO solutions(id,session_id,payload,status,expires,created) VALUES(?,?,?,?,?,?)',(plan['id'],sid2,json.dumps(plan),'pending',int(time.time()*1000)+900000,int(time.time()*1000)))
 message(sid2,'assistant',{'text':'Все выбранные позиции собраны в один комплект.','solution':plan})
 result=chat(bundle,'Пока не добавляй выбранные товары');assert request(bundle,'cart')[1]['itemCount']==0
 if request(bundle,'session',{})[1]['conversationStatus']=='completed':resume(bundle)
 result=chat(bundle,'Добавь выбранные товары в корзину');assert result['cart']['itemCount']==1;assert result['solutionReceipt']['selectedKey']=='budget';assert result['conversationStatus']=='completed'
 print('PASS live conversation: consent, no duplicate add, persisted completion/resume, cart edit/remove, resolved electrician text and natural bundle choice',flush=True)
finally:
 with sqlite3.connect(dbfile) as d:
  for sid in sessions:
   for table in ['messages','proposals','solutions','cart','agent_locks','sessions']:d.execute('DELETE FROM '+table+' WHERE '+('id' if table=='sessions' else 'session_id')+'=?',(sid,))

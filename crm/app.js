'use strict';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>(Number(n||0)/100).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
const DEFAULT_CRM_API='https://script.google.com/macros/s/AKfycbyzSdWYQZU_ofcyNg8uUUtYSlGymvCtVvkojTOIxUVNMNpDWuJ2Mi7UYZILGOD700wlsg/exec';
function telegramData(){return window.Telegram?.WebApp?.initData||'';}
const labels={sale:'Продажа',sales:'Документы',stock:'Склад',shifts:'Смены',reports:'Отчёты',orders:'Заказы',settings:'Настройки'};
let page='settings',category='',search='',cart={},locationId='CAFE',busy=false,live=false,demoMode=false,connectionError='',apiUrl=localStorage.getItem('crmApiUrl')||DEFAULT_CRM_API,accessToken='',pending=null;
let demoEvents=[],demoCounter=0;
const demoProducts=[{id:'DEMO01',name:'Круассан классический',category:'Выпечка',unit:'шт',price:18000,cost:null,stock_tracked:true,min_stock:5},{id:'DEMO02',name:'Булочка с корицей',category:'Выпечка',unit:'шт',price:22000,cost:null,stock_tracked:true,min_stock:4},{id:'DEMO03',name:'Эклер шоколадный',category:'Десерты',unit:'шт',price:25000,cost:null,stock_tracked:true,min_stock:3},{id:'DEMO04',name:'Капучино',category:'Напитки',unit:'шт',price:23000,cost:null,stock_tracked:false,min_stock:0}];
let data={employee:{name:'Демонстрация',role:'admin'},locations:[{id:'CAFE',name:'Кофейня'},{id:'WORKSHOP',name:'Цех'}],products:demoProducts,partners:[{id:'DEMO_PARTNER',name:'Тестовый партнёр'}],sales:[],shifts:[],stock:{}};
function resetDemo(){demoEvents=[];demoProducts.forEach(p=>{if(p.stock_tracked)demoEvents.push({event_id:'seed'+p.id,created_at:new Date().toISOString(),actor_id:'demo',location_id:'CAFE',type:'stock.receive',payload:{product_id:p.id,delta:20}});});demoSnapshot();}
function demoSnapshot(){const s=CRMCore.reduce(demoEvents);data={employee:{id:'demo',name:'Демонстрация',role:'admin'},locations:[{id:'CAFE',name:'Кофейня'},{id:'WORKSHOP',name:'Цех'}],products:demoProducts,partners:[{id:'DEMO_PARTNER',name:'Тестовый партнёр'}],sales:Object.values(s.sales).reverse(),shifts:Object.values(s.shifts).map(x=>({...x,expected_cash:CRMCore.expectedCash(s,x.id)})).reverse(),stock:s.stock};}
function currentShift(){return data.shifts.find(x=>x.location_id===locationId&&x.status==='open');}
function available(p){return p.stock_tracked?(data.stock[CRMCore.key(locationId,p.id)]||0):null;}
function notify(message){$('#toast').textContent=message;$('#toast').style.display='block';clearTimeout(notify.timer);notify.timer=setTimeout(()=>$('#toast').style.display='none',4500);}

function mobileMenu(){return !!window.matchMedia?.('(max-width:760px)').matches;}
function setMenu(open,restoreFocus=true){
 const mobile=mobileMenu();open=!!open&&mobile;
 document.body.classList.toggle('menu-open',open);
 $('#menu-toggle').setAttribute('aria-expanded',String(open));
 $('#menu-backdrop').hidden=!open;
 $('#sidebar').inert=mobile&&!open;
 $('#sidebar').setAttribute('aria-hidden',String(mobile&&!open));
 $('#workspace').inert=open;
 if(open)$('#menu-close').focus();
 else if(restoreFocus&&mobile)$('#menu-toggle').focus();
}
$('#menu-toggle').onclick=()=>setMenu(!document.body.classList.contains('menu-open'));
$('#menu-close').onclick=()=>setMenu(false);
$('#menu-backdrop').onclick=()=>setMenu(false);
window.addEventListener('keydown',e=>{
 if(e.key==='Escape'&&document.body.classList.contains('menu-open'))setMenu(false);
 if(e.key==='Tab'&&document.body.classList.contains('menu-open')){
  const controls=[...$('#sidebar').querySelectorAll('a[href],button:not(:disabled)')];
  const first=controls[0],last=controls[controls.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
 }
});
window.matchMedia?.('(max-width:760px)').addEventListener('change',()=>setMenu(false,false));

function render(){
  $('#nav').innerHTML=Object.entries(labels).map(([id,name])=>`<button data-page="${id}" class="${page===id?'active':''}">${name}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b=>{b.disabled=busy||(!live&&!demoMode&&b.dataset.page!=='settings');b.onclick=()=>{if(busy)return;page=b.dataset.page;setMenu(false,false);render();};});
  $('#title').textContent=labels[page];$('#identity').textContent=data.employee.name+' · '+data.employee.role;
  $('#location').innerHTML=data.locations.map(l=>`<option value="${esc(l.id)}" ${l.id===locationId?'selected':''}>${esc(l.name)}</option>`).join('');
  $('#location').disabled=busy;$('#shiftButton').disabled=busy||(!live&&!demoMode);$('#shiftButton').textContent=currentShift()?'Закрыть смену':'Открыть смену';
  $('#mode').className='notice'+(live?' live':'');$('#mode').textContent=live?'Рабочий режим · Google Sheets подключены · '+data.products.length+' позиций.':demoMode?'ДЕМОНСТРАЦИЯ · Все товары, цены и остатки здесь тестовые. Действия не записываются в вашу таблицу и сбросятся при перезагрузке.':'Вход в CRM · Подключите свою таблицу. Рабочий каталог появится после проверки доступа.';
  ({sale:renderSale,sales:renderSales,stock:renderStock,shifts:renderShifts,reports:renderReports,orders:renderOrders,settings:renderSettings}[page])();
}
$('#location').onchange=e=>{if(busy)return;locationId=e.target.value;cart={};render();};
function renderSale(){
 $('#content').innerHTML=`<div class="sale-layout"><div><div class="toolbar"><input id="search" placeholder="Поиск по названию" aria-label="Поиск" value="${esc(search)}"><button onclick="refresh()">Обновить</button></div><div id="categories" class="chips"></div><div id="products" class="products"></div></div><div class="cart"><h2>Новая продажа</h2><div class="muted">${currentShift()?'Смена открыта':'Сначала откройте смену'} · внутренний документ</div><div id="cart-lines"></div><div class="total"><span>Итого</span><span id="total"></span></div><select id="payment" aria-label="Способ расчёта"><option value="cash">Наличные</option><option value="card">Терминал</option><option value="transfer">Перевод</option><option value="unpaid">В долг партнёру</option></select><select id="partner" aria-label="Партнёр"><option value="">Без партнёра</option>${data.partners.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="primary" id="sell" onclick="sell()">Зарегистрировать продажу</button><p class="key-note">Оплата принимается отдельно. Этот документ не является фискальным чеком.</p></div></div>`;
 $('#search').oninput=e=>{search=e.target.value;renderProducts();};renderProducts();renderCart();
}
function renderProducts(){
 const categories=['',...new Set(data.products.map(p=>p.category))];$('#categories').innerHTML=categories.map(c=>`<button class="${category===c?'active':''}">${esc(c||'Все позиции')}</button>`).join('');$('#categories').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{category=categories[i];renderProducts();});
 const list=data.products.filter(p=>(!category||p.category===category)&&p.name.toLowerCase().includes(search.toLowerCase()));
 $('#products').innerHTML=list.length?list.map(p=>`<button class="product" data-id="${esc(p.id)}"><span class="cat">${esc(p.category)}</span><strong>${esc(p.name)}</strong><span class="bottom"><span>${rub(p.price)}</span><span class="muted">${p.stock_tracked?available(p)+' '+esc(p.unit):'без склада'}</span></span></button>`).join(''):'<div class="empty">Нет товаров. В рабочем режиме каталог заполняется на листе «Товары».</div>';
 $('#products').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,1));
}
function add(id,n){if(busy||pending)return notify('Сначала завершите или повторите текущую операцию');const p=data.products.find(x=>x.id===id),q=(cart[id]||0)+n;if(p.stock_tracked&&q>available(p))return notify('Недостаточно остатка');if(q<=0)delete cart[id];else cart[id]=q;renderCart();}
function renderCart(){
 const lines=Object.entries(cart);$('#cart-lines').innerHTML=lines.length?lines.map(([id,q])=>{const p=data.products.find(x=>x.id===id);return `<div class="cart-row"><div class="line"><span>${esc(p.name)}</span><strong>${rub(p.price*q)}</strong></div><div class="stepper"><button data-id="${esc(id)}" data-n="-1">−</button><span>${q} ${esc(p.unit)}</span><button data-id="${esc(id)}" data-n="1">+</button></div></div>`;}).join(''):'<div class="empty">Выберите позиции слева.<br>Здесь появится состав продажи.</div>';
 $('#cart-lines').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,Number(b.dataset.n)));
 $('#total').textContent=rub(lines.reduce((a,[id,q])=>a+data.products.find(x=>x.id===id).price*q,0));$('#sell').disabled=busy||!lines.length||!currentShift();
}
async function sell(){if(busy)return;const d={location_id:locationId,lines:Object.entries(cart).map(([product_id,qty])=>({product_id,qty})),method:$('#payment').value,partner_id:$('#partner').value};if(!d.lines.length)return;if(d.method==='unpaid'&&!d.partner_id)return notify('Выберите партнёра');try{await mutate('sale.create',d);cart={};render();notify('Продажа сохранена');}catch(e){notify(e.message);}}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Пока нет записей</td></tr>`}</tbody></table></div>`;}
function short(id){return esc(String(id).slice(0,8));}function date(s){return new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderSales(){const sales=data.sales.filter(s=>s.location_id===locationId);$('#content').innerHTML=`<div class="toolbar"><span class="muted">Последние 300 документов · время Москвы</span><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Документ','Время','Состав','Сумма','Оплачено','Статус','Действия'],sales.map(s=>[short(s.id),date(s.created_at),esc(s.lines.map(l=>l.name+' × '+l.qty).join(', ')),rub(s.total),rub(s.paid),s.status==='refunded'?'Возвращён':s.paid<s.total?'Есть долг':'Продан',s.status==='sold'?`<button data-refund="${esc(s.id)}">Возврат</button>${s.total>s.paid?`<button data-pay="${esc(s.id)}">Принять оплату</button>`:''}`:'—']))}</div>`;$('#content').querySelectorAll('[data-refund]').forEach(b=>b.onclick=()=>refundDialog(b.dataset.refund));$('#content').querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>paymentDialog(b.dataset.pay));}
function input(name,label,type='text',value='',extra=''){return `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra} required>`;}
function select(name,label,options){return `<label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;}
function dialog(title,fields,save){if(busy||pending)return notify('Есть незавершённая операция. Откройте настройки для повторной отправки.');$('#dialog-title').textContent=title;$('#fields').innerHTML=fields;$('#form-error').textContent='';$('#submit').disabled=false;$('#form').onsubmit=async e=>{e.preventDefault();if(busy)return;$('#submit').disabled=true;try{await save(Object.fromEntries(new FormData(e.target)));$('#dialog').close();render();notify('Сохранено');}catch(err){$('#form-error').textContent=err.message;}finally{$('#submit').disabled=false;}};$('#dialog').showModal();}
function shiftDialog(){const shift=currentShift();if(shift)dialog('Закрытие смены',`<p class="muted">Ожидаемые наличные: ${rub(shift.expected_cash)}</p>`+input('actual_cash','Наличные по факту, ₽','number','', 'min="0" step="0.01"')+input('reason','Комментарий / причина расхождения','text','Без расхождений'),v=>mutate('shift.close',{location_id:locationId,...v}));else dialog('Открытие смены',input('opening_cash','Разменные наличные, ₽','number','0','min="0" step="0.01"'),v=>mutate('shift.open',{location_id:locationId,...v}));}
function refundDialog(id){dialog('Полный возврат продажи',input('reason','Причина')+select('restock','Возвращать товар в остаток?',[['false','Нет — товар не возвращён в продажу'],['true','Да — товар можно снова продавать']]),v=>mutate('sale.refund',{location_id:locationId,sale_id:id,reason:v.reason,restock:v.restock==='true'}));}
function paymentDialog(id){const s=data.sales.find(x=>x.id===id);dialog('Погашение долга',input('amount','Сумма, ₽','number',(s.total-s.paid)/100,'min="0.01" step="0.01"')+select('method','Способ',[['cash','Наличные'],['card','Терминал'],['transfer','Перевод']]),v=>mutate('payment.add',{location_id:locationId,sale_id:id,...v}));}
function renderStock(){const list=data.products.filter(p=>p.stock_tracked);$('#content').innerHTML=`<div class="toolbar"><button onclick="stockDialog('stock.receive')">+ Приход</button><button onclick="stockDialog('stock.writeoff')">Списание</button><button onclick="stockDialog('stock.count')">Инвентаризация</button><button onclick="stockDialog('stock.transfer')">Перемещение</button><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Позиция','Категория','Остаток','Минимум','Состояние'],list.map(p=>[esc(p.name),esc(p.category),available(p)+' '+esc(p.unit),p.min_stock||0,available(p)<Number(p.min_stock)?'<span class="badge low">Мало</span>':'<span class="badge">Достаточно</span>']))}</div>`;}
function stockDialog(action){if(!data.products.some(p=>p.stock_tracked))return notify('Сначала добавьте товары с учётом остатков');dialog({'stock.receive':'Приход товара','stock.writeoff':'Списание товара','stock.count':'Фактический остаток','stock.transfer':'Перемещение товара'}[action],select('product_id','Товар',data.products.filter(p=>p.stock_tracked).map(p=>[p.id,p.name+' · '+p.unit]))+input('qty',action==='stock.count'?'Сколько насчитали':'Количество','number','','min="0" step="0.001"')+(action==='stock.transfer'?select('to_location','Куда',data.locations.filter(x=>x.id!==locationId).map(x=>[x.id,x.name])):'')+input('reason','Основание / причина'),v=>mutate(action,{location_id:locationId,...v}));}
function renderShifts(){$('#content').innerHTML=`<div class="toolbar"><button onclick="shiftDialog()">${currentShift()?'Закрыть смену':'Открыть смену'}</button><button onclick="cashDialog('cash.in')">Внести наличные</button><button onclick="cashDialog('cash.out')">Изъять наличные</button><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Смена','Открытие','Закрытие','Начальные','По учёту','Факт','Разница'],data.shifts.filter(s=>s.location_id===locationId).map(s=>[short(s.id),date(s.opened_at),s.closed_at?date(s.closed_at):'<span class="badge">Открыта</span>',rub(s.opening_cash),rub(s.expected_cash),s.status==='closed'?rub(s.actual_cash):'—',s.status==='closed'?rub(s.difference):'—']))}</div>`;}
function cashDialog(action){dialog(action==='cash.in'?'Внесение наличных':'Изъятие наличных',input('amount','Сумма, ₽','number','','min="0.01" step="0.01"')+input('reason','Основание'),v=>mutate(action,{location_id:locationId,...v}));}
function renderReports(){$('#content').innerHTML=`<div class="toolbar"><input id="from" type="date" value="${today()}" aria-label="Начало периода"><input id="to" type="date" value="${today()}" aria-label="Конец периода"><button class="primary" onclick="loadReport()">Показать отчёт</button></div><div id="report"><div class="empty">Выберите период. Выручка и поступления считаются отдельно; долг показан на текущий момент.</div></div>`;loadReport();}
async function loadReport(){const from=$('#from').value,to=$('#to').value;if(!from||!to||from>to)return notify('Проверьте даты');try{const r=live?await api('report',{location_id:locationId,from,to}):CRMCore.report(CRMCore.reduce(demoEvents),locationId,from,to);if(page!=='reports')return;$('#report').innerHTML=`<div class="metrics">${[['Выручка за период',rub(r.revenue)],['Поступления − возвраты',rub(r.receipts)],['Продаж / возвратов',r.sale_count+' / '+r.refund_count],['Текущий долг партнёров',rub(r.debt)]].map(([l,v])=>`<div class="metric"><span class="muted">${l}</span><strong>${v}</strong></div>`).join('')}</div><div class="panel"><h2>Что входит в отчёт</h2><p>Продажи до возвратов: ${rub(r.gross)}. Возвраты: ${rub(r.refunds)}. Наличными принято за вычетом возвратов: ${rub(r.cash)}. Списаний: ${r.writeoffs}.</p><p>Прибыль пока не рассчитывается: для неё нужны подтверждённая себестоимость, расходы и правила списания ингредиентов.</p></div>`;}catch(e){notify(e.message);}}
function renderOrders(){$('#content').innerHTML='<div class="panel"><h2>Заказы из бота и с сайта</h2><p>Следующий модуль: принять → приготовить → отгрузить. Он будет связан с партнёрами, остатками и оплатами.</p><p>В этой версии интеграция ещё не подключена. Существующие заявки продолжают работать в текущем боте.</p></div>';}
function renderSettings(){$('#content').innerHTML=`<div class="split"><div class="panel"><h2>Подключение</h2><p>${telegramData()?'Telegram передал данные аккаунта. Проверяем доступ сотрудника автоматически — личный ключ не требуется.':'Адрес CRM уже указан. Для входа из обычного браузера введите личный ключ.'}</p><label for="api">Адрес API / HTTPS-прокси</label><input id="api" type="url" style="width:100%" value="${esc(apiUrl)}" placeholder="https://ваш-сервер/crm-api"><label for="token" ${telegramData()?'hidden':''}>Личный ключ доступа</label><input id="token" type="${telegramData()?'hidden':'password'}" style="width:100%" autocomplete="off"><p class="key-note">${telegramData()?'Доступ определяется по Telegram ID и роли в CRM.':'Ключ хранится только в памяти этой вкладки. Через рабочего бота доступен автоматический вход.'}</p><p id="connection-error" class="danger" role="alert">${esc(connectionError)}</p><button id="connect-button" class="primary" onclick="connect()">${telegramData()?'Повторить вход через Telegram':'Подключить'}</button><button onclick="disconnect()">Открыть демонстрацию</button></div><div class="panel"><h2>Состояние первой версии</h2><p>Готовая основа: продажи и полные возвраты, долг и погашение, смены, наличные, склад готовых изделий и отчёты.</p><p>Требуют следующего этапа: скидки и комбо, техкарты, партии и сроки годности, импорт текущих заказов, роли с ограничением по точкам.</p><p>Модули подключаются к вашей таблице после установки Apps Script.</p>${pending?'<p class="danger">Есть операция без подтверждения. Повторите её с тем же ID, чтобы проверить результат без дубля.</p><button onclick="retryPending()">Повторить операцию</button>':''}</div></div>`;}
async function api(action,d,requestId){if(!apiUrl)throw Error('Не указан адрес API');const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),40000);try{const res=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,data:d,request_id:requestId,accessToken,initData:telegramData()}),cache:'no-store',signal:ctrl.signal});if(!res.ok)throw Error('API вернул HTTP '+res.status);const json=await res.json();if(!json.ok){const err=new Error(json.error||'Ошибка операции');err.confirmed=!json.uncertain;throw err;}return json.data;}finally{clearTimeout(timer);}}
async function connect(automatic=false){
 if(busy)return;
 if(pending)return notify('Сначала повторите неподтверждённую операцию');
 const newUrl=automatic?DEFAULT_CRM_API:$('#api').value.trim();
 if(!newUrl.startsWith('https://')){connectionError='Нужен HTTPS-адрес API';$('#connection-error').textContent=connectionError;return;}
 apiUrl=newUrl;accessToken=telegramData()?'':$('#token').value.trim();connectionError='';
 busy=true;$('#connect-button').disabled=true;$('#connect-button').textContent=telegramData()?'Вход через Telegram…':'Подключение…';$('#connection-error').textContent='';
 try{
  const next=await api('bootstrap',{});
  if(!next||!Array.isArray(next.products)||!Array.isArray(next.locations)||!next.employee)throw Error('Скрипт вернул неполные данные CRM');
  data=next;live=true;demoMode=false;localStorage.setItem('crmApiUrl',apiUrl);locationId=data.locations[0]?.id||'';cart={};category='';search='';page='sale';
  notify('Таблица подключена · '+data.products.length+' позиций');
 }catch(e){
  connectionError=e.message==='Failed to fetch'?'Браузер не смог связаться со скриптом. Проверьте адрес /exec, доступ к развёртыванию и соединение.':e.name==='AbortError'?'Скрипт не ответил за 40 секунд. Попробуйте подключиться ещё раз.':e.message;
  page='settings';notify(connectionError);
 }finally{busy=false;render();}
}
function disconnect(){if(busy)return;if(pending)return notify('Сначала повторите неподтверждённую операцию');live=false;demoMode=true;connectionError='';accessToken='';cart={};locationId='CAFE';category='';search='';page='sale';resetDemo();render();}
async function refresh(){if(busy)return;if(live)try{data=await api('bootstrap',{});render();}catch(e){notify(e.message);}else render();}
async function mutate(action,d){if(busy)throw Error('Дождитесь завершения операции');if(pending)throw Error('Повторите неподтверждённую операцию в настройках');busy=true;document.body.classList.add('loading');try{if(live){pending={action,data:d,id:crypto.randomUUID()};try{data=await api(action,d,pending.id);pending=null;}catch(e){if(e.confirmed)pending=null;throw e;}}else demoMutate(action,d);}finally{busy=false;document.body.classList.remove('loading');}}
async function retryPending(){if(!pending||busy)return;busy=true;try{data=await api(pending.action,pending.data,pending.id);pending=null;cart={};$('#dialog').close();render();notify('Операция подтверждена');}catch(e){if(e.confirmed)pending=null;notify(e.message);}finally{busy=false;}}
function demoMutate(type,d){const s=CRMCore.reduce(demoEvents),sh=currentShift(),check=CRMCore.check,m=CRMCore.money,q=CRMCore.qty,p={},id='demo-'+(++demoCounter);const needShift=()=>check(sh,'Сначала откройте смену');
 if(type==='shift.open'){check(!sh,'Смена уже открыта');p.id=id;p.opening_cash=m(d.opening_cash);check(p.opening_cash>=0,'Неверная сумма');}
 else if(type==='shift.close'){needShift();p.shift_id=sh.id;p.actual_cash=m(d.actual_cash);check(p.actual_cash>=0,'Неверная сумма');p.expected_cash=CRMCore.expectedCash(s,sh.id);p.comment=d.reason;}
 else if(type==='sale.create'){needShift();p.id=id;p.shift_id=sh.id;p.partner_id=d.partner_id;p.lines=d.lines.map(l=>{const x=data.products.find(x=>x.id===l.product_id);check(!x.stock_tracked||l.qty<=available(x),'Недостаточно остатка');return {product_id:x.id,name:x.name,qty:l.qty,price:x.price,cost:x.cost,stock_tracked:x.stock_tracked,line_total:Math.round(l.qty*x.price)};});p.total=p.lines.reduce((a,l)=>a+l.line_total,0);p.payment=d.method==='unpaid'?null:{method:d.method,amount:p.total};}
 else if(type==='payment.add'){needShift();const sale=s.sales[d.sale_id];p.shift_id=sh.id;p.sale_id=sale.id;p.method=d.method;p.amount=m(d.amount);check(p.amount>0&&p.amount<=sale.total-sale.paid,'Проверьте сумму');}
 else if(type==='sale.refund'){needShift();const sale=s.sales[d.sale_id];check(sale.status==='sold','Возврат уже выполнен');p.sale_id=sale.id;p.shift_id=sh.id;p.restock=d.restock;p.reason=d.reason;const sums={};s.payments.filter(x=>x.sale_id===sale.id).forEach(x=>sums[x.method]=(sums[x.method]||0)+x.amount);p.payments=Object.keys(sums).map(method=>({method,amount:sums[method]}));check((sums.cash||0)<=CRMCore.expectedCash(s,sh.id),'Недостаточно наличных для возврата');}
 else if(type.startsWith('stock.')){p.product_id=d.product_id;p.reason=d.reason;const n=q(d.qty),stock=s.stock[CRMCore.key(locationId,d.product_id)]||0;check(n>=0&&(type==='stock.count'||n>0),'Проверьте количество');p.delta=type==='stock.count'?q(n-stock):type==='stock.receive'?n:-n;check(stock+p.delta>=0,'Недостаточно остатка');if(type==='stock.transfer')p.to_location=d.to_location;}
 else if(type==='cash.in'||type==='cash.out'){needShift();p.shift_id=sh.id;p.amount=m(d.amount);p.reason=d.reason;check(p.amount>0,'Проверьте сумму');if(type==='cash.out')check(p.amount<=CRMCore.expectedCash(s,sh.id),'Недостаточно наличных');}
 else throw Error('Операция ещё не подключена');demoEvents.push({event_id:id,created_at:new Date().toISOString(),actor_id:'demo',location_id:locationId,type,payload:p});demoSnapshot();}
window.addEventListener('beforeunload',e=>{if(pending||busy){e.preventDefault();e.returnValue='';}});
window.Telegram?.WebApp?.ready();window.Telegram?.WebApp?.expand();
data={employee:{name:'Вход не выполнен',role:'—'},locations:[{id:'CAFE',name:'Кофейня'},{id:'WORKSHOP',name:'Цех'}],products:[],partners:[],sales:[],shifts:[],stock:{}};
render();
if(window.matchMedia)setMenu(false,false);

async function startTelegramLogin(){
 if(!telegramData())return;
 $('#mode').textContent='Вход через Telegram · Проверяем доступ сотрудника…';
 await connect(true);
}
void startTelegramLogin();

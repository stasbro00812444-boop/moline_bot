'use strict';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>(Number(n||0)/100).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
const siteEditorContracts=new Set(['products-20261115-photo-v4','products-20261115-rules-v1']);
const siteNutrients=[['calories','Ккал'],['protein','Белки, г'],['fat','Жиры, г'],['carbs','Углеводы, г']];
function siteNutrient(raw,label){
 const value=String(raw??'').trim();
 if(!value)return null;
 if(!/^\d{1,4}(?:[.,]\d{1,2})?$/.test(value)||Number(value.replace(',','.'))>9999)
  throw Error(label+' — укажите число от 0 до 9999, до двух знаков после запятой.');
 return Number(value.replace(',','.'));
}
function requireSiteEditor(){
 if(!siteEditorContracts.has(data.capabilities?.site_contract))throw Error('CRM получила неподдерживаемую версию карточек. Проверьте развёртывание Apps Script и переподключитесь. Данные не отправлены.');
}
const today=()=>new Date(Date.now()+10800000).toISOString().slice(0,10);
const DEFAULT_CRM_API='https://script.google.com/macros/s/AKfycbyzSdWYQZU_ofcyNg8uUUtYSlGymvCtVvkojTOIxUVNMNpDWuJ2Mi7UYZILGOD700wlsg/exec';
function telegramData(){return window.Telegram?.WebApp?.initData||'';}
const labels={sale:'Продажа',sales:'Документы',stock:'Склад',products:'Товары',availability:'Наличие сайта',shifts:'Смены',reports:'Отчёты',orders:'Заказы',settings:'Настройки'};
let page='settings',category='',search='',cart={},locationId='CAFE',busy=false,live=false,demoMode=false,connectionError='',apiUrl=localStorage.getItem('crmApiUrl')||DEFAULT_CRM_API,accessToken='',pending=null;
let demoEvents=[],demoCounter=0;
const demoProducts=[{id:'DEMO01',name:'Круассан классический',category:'Выпечка',unit:'шт',price:18000,cost:null,stock_tracked:true,min_stock:5},{id:'DEMO02',name:'Булочка с корицей',category:'Выпечка',unit:'шт',price:22000,cost:null,stock_tracked:true,min_stock:4},{id:'DEMO03',name:'Эклер шоколадный',category:'Десерты',unit:'шт',price:25000,cost:null,stock_tracked:true,min_stock:3},{id:'DEMO04',name:'Капучино',category:'Напитки',unit:'шт',price:23000,cost:null,stock_tracked:false,min_stock:0}];
let data={employee:{name:'Демонстрация',role:'admin'},locations:[{id:'CAFE',name:'Кофейня'},{id:'WORKSHOP',name:'Цех'}],products:demoProducts,partners:[{id:'DEMO_PARTNER',name:'Тестовый партнёр'}],sales:[],shifts:[],stock:{}};
function resetDemo(){demoEvents=[];demoProducts.forEach(p=>{if(p.stock_tracked)demoEvents.push({event_id:'seed'+p.id,created_at:new Date().toISOString(),actor_id:'demo',location_id:'CAFE',type:'stock.receive',payload:{product_id:p.id,delta:20}});});demoSnapshot();}
function demoSnapshot(){const s=CRMCore.reduce(demoEvents);data={employee:{id:'demo',name:'Демонстрация',role:'admin'},locations:[{id:'CAFE',name:'Кофейня'},{id:'WORKSHOP',name:'Цех'}],products:demoProducts,partners:[{id:'DEMO_PARTNER',name:'Тестовый партнёр'}],sales:Object.values(s.sales).reverse(),shifts:Object.values(s.shifts).map(x=>({...x,expected_cash:CRMCore.expectedCash(s,x.id)})).reverse(),stock:s.stock};}
function currentShift(){return data.shifts.find(x=>x.location_id===locationId&&x.status==='open');}
const inventoryClock=new WeakMap();
function stockIssue(code,id){
 const error=new Error({snapshot_required:'Сначала обновите остатки',missing_product:'Товар отсутствует в каталоге',
   invalid_recipe:'Проверьте рецепт сборки',wrong_location:'Выберите действующую точку'}[code]);
 error.stockIssue={code,product_id:id,stock_id:id};
 return error;
}
function inventoryAt(point){
 const snapshot=data.inventory,start=snapshot&&inventoryClock.get(snapshot);
 if(snapshot?.version!==1||typeof snapshot.revision!=='string'||!snapshot.revision||
    !Number.isFinite(start)||!Number.isFinite(snapshot.valid_for_ms)||
    performance.now()-start>=snapshot.valid_for_ms)return null;
 return snapshot.locations?.[point]||null;
}
function readyStock(id,point=locationId){
 if(demoMode)return Math.max(0,data.stock[CRMCore.key(point,id)]||0);
 const quantity=inventoryAt(point)?.available?.[id];
 if(!Number.isFinite(quantity)||quantity<0)throw stockIssue('snapshot_required',id);
 return quantity;
}
function displayedStock(id,point=locationId){
 try{return readyStock(id,point);}catch{return null;}
}
function cartPlan(items=cart){
 if(!data.locations.some(x=>x.id===locationId))throw stockIssue('wrong_location');
 return CRMCore.planAvailable(id=>readyStock(id),Object.entries(items).map(([id,qty])=>{
   const product=data.products.find(p=>p.id===id);
   if(!product)throw stockIssue('missing_product',id);
   const recipe=data.assembly_recipes?.[id];
   if(recipe&&!data.products.some(p=>p.id===recipe.base_product_id&&p.stock_tracked))throw stockIssue('invalid_recipe',id);
   return {...product,product_id:id,qty};
 }),data.assembly_recipes||{});
}
function available(p,used){
 if(!p.stock_tracked)return null;
 const free=displayedStock(p.id);
 return free===null?null:Math.max(0,CRMCore.qty(free-(used[p.id]||0)));
}
function fromClassic(id,items=cart){
 const ready=displayedStock(id);
 return ready!==null&&data.assembly_recipes?.[id]?Math.max(0,(items[id]||0)-ready):0;
}
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

let cartObserver;
function bindCartJump(){
 const cartPanel=$('.cart'),jump=$('#jump-cart');if(!cartPanel)return;
 jump.onclick=()=>{cartPanel.scrollIntoView({block:'start'});cartPanel.querySelector('h2').focus({preventScroll:true});};
 cartObserver=new IntersectionObserver(([entry])=>{if(cartPanel.isConnected)jump.hidden=entry.isIntersecting||!Object.keys(cart).length;});
 cartObserver.observe(cartPanel);
}
const listQueries=new Map();
function bindListFilter(){
 const config={stock:['Поиск по складу','tbody tr'],sales:['Найти документ','tbody tr'],orders:['Найти заказ','.order-card, .panel']};
 const settings=config[page],toolbar=$('#content .toolbar');if(!settings||!toolbar)return;
 const rows=[...document.querySelectorAll('#content '+settings[1])].filter(el=>page==='orders'||el.cells.length>1);
 if(!rows.length)return;
 const scope=page+'-'+locationId,input=document.createElement('input'),count=document.createElement('span');
 input.type='search';input.placeholder=settings[0];input.setAttribute('aria-label',settings[0]);input.value=listQueries.get(scope)||'';
 count.className='muted';count.setAttribute('role','status');
 function filter(){
  listQueries.set(scope,input.value);const term=input.value.trim().toLocaleLowerCase('ru');let visible=0;
  for(const row of rows){row.hidden=!row.textContent.toLocaleLowerCase('ru').includes(term);if(!row.hidden)visible++}
  count.textContent=term?'Найдено: '+visible+' из '+rows.length:'';
 }
 input.addEventListener('input',filter);toolbar.prepend(input,count);filter();
}
function render(){
  const groups=[['Работа точки',['sale','orders','sales','shifts']],['Ассортимент',['stock','products','availability']],['Управление',['reports','settings']]];
  const visible=id=>(id!=='availability'||!!data.site_availability)&&(id!=='products'||data.capabilities?.product_create===true);
  const button=id=>`<button type="button" data-page="${id}" class="${id===page?'active':''}" ${id===page?'aria-current="page"':''}>${labels[id]}</button>`;
  $('#nav').innerHTML=groups.map(([name,ids])=>'<section><h2>'+name+'</h2>'+ids.filter(visible).map(button).join('')+'</section>').join('');
  $('#quick-nav').innerHTML=['sale','orders','products','stock'].map(button).join('');
  document.querySelectorAll('[data-page]').forEach(b=>{b.disabled=busy||(!live&&!demoMode&&b.dataset.page!=='settings');b.onclick=()=>{if(busy)return;page=b.dataset.page;setMenu(false,false);render();$('#title').focus({preventScroll:true});window.scrollTo(0,0);};});
  $('#quick-nav').hidden=!live&&!demoMode;
  $('#jump-cart').hidden=true;cartObserver?.disconnect();
  $('#title').textContent=labels[page];$('#identity').textContent=data.employee.name+' · '+data.employee.role;
  $('#location').innerHTML=data.locations.map(l=>`<option value="${esc(l.id)}" ${l.id===locationId?'selected':''}>${esc(l.name)}</option>`).join('');
  $('#location').disabled=busy||!!pending;$('#shiftButton').disabled=busy||!!pending||!canSell()||(!live&&!demoMode);$('#shiftButton').textContent=currentShift()?'Закрыть смену':'Открыть смену';
  $('#mode').className='notice'+(live?' live':'');$('#mode').textContent=live?'Рабочий режим · Google Sheets подключены · '+data.products.length+' позиций.':demoMode?'ДЕМОНСТРАЦИЯ · Все товары, цены и остатки здесь тестовые. Действия не записываются в вашу таблицу и сбросятся при перезагрузке.':'Вход в CRM · Подключите свою таблицу. Рабочий каталог появится после проверки доступа.';
  ({sale:renderSale,sales:renderSales,stock:renderStock,products:renderProductAdmin,availability:renderAvailability,shifts:renderShifts,reports:renderReports,orders:renderOrders,settings:renderSettings}[page])();bindListFilter();
}
$('#location').onchange=e=>{if(busy||pending){e.target.value=locationId;return;}locationId=e.target.value;clearSaleCart();render();};
function renderSale(){
 $('#content').innerHTML=`<div class="sale-layout"><div><div class="toolbar"><input id="search" placeholder="Поиск по названию" aria-label="Поиск" value="${esc(search)}"><button id="sale-refresh" onclick="refresh()">Обновить остатки</button></div><section id="sale-feedback" class="sale-feedback" hidden><div id="sale-feedback-message" role="status" aria-live="polite"></div><div id="sale-feedback-actions" class="sale-feedback-actions"></div></section><div id="categories" class="chips"></div><div id="products" class="products"></div></div><div class="cart"><h2 tabindex="-1">Новая продажа</h2><div class="muted">${!canSell()?'Только просмотр':currentShift()?'Смена открыта':'Сначала откройте смену'} · внутренний документ</div><div id="cart-lines"></div><div class="total"><span>Итого</span><span id="total"></span></div><select id="payment" aria-label="Способ расчёта"><option value="cash">Наличные</option><option value="card">Терминал</option><option value="transfer">Перевод</option><option value="unpaid">В долг партнёру</option></select><select id="partner" aria-label="Партнёр"><option value="">Без партнёра</option>${data.partners.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="primary" id="sell" onclick="sell()">Зарегистрировать продажу</button><p class="key-note">Оплата принимается отдельно. Этот документ не является фискальным чеком.</p></div></div>`;
 $('#search').oninput=e=>{search=e.target.value;renderProducts();};renderProducts();renderCart();renderSaleFeedback();bindCartJump();
}
document.addEventListener('error',event=>{if(event.target.matches?.('.sale-product-photo'))event.target.hidden=true;},true);
function renderProducts(){
 const categories=['',...new Set(data.products.map(p=>p.category))];$('#categories').innerHTML=categories.map(c=>`<button class="${category===c?'active':''}">${esc(c||'Все позиции')}</button>`).join('');$('#categories').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{category=categories[i];renderProducts();});
 const list=data.products.filter(p=>(!category||p.category===category)&&p.name.toLowerCase().includes(search.toLowerCase()));
 const cards=Object.fromEntries((data.site_cards||[]).map(c=>[c.product_id,c]));
 let usage={};
 try{usage=Object.fromEntries(cartPlan().map(item=>[item.product_id,item.qty]));}catch{}
 $('#products').innerHTML=list.length?list.map(p=>{const free=available(p,usage),media=cards[p.id]?.media_id;const photo=/^[a-f0-9]{64}$/.test(media||'')?`https://molinebymonk.ru/api/auth/catalog/media/${media}.webp`:MOLINE_LEGACY_IMAGES[p.id];return `<button class="product" data-id="${esc(p.id)}">${photo?`<img class="sale-product-photo" src="${esc(photo)}" alt="" loading="lazy">`:'<span class="sale-product-photo sale-product-placeholder" aria-hidden="true"></span>'}<span class="cat">${esc(p.category)}</span><strong>${esc(p.name)}</strong><span class="bottom"><span>${rub(p.price)}</span><span class="muted">${p.stock_tracked?(free===null?'Обновите остатки':free+(data.assembly_recipes?.[p.id]?' готовых':' '+esc(p.unit))):'без склада'}</span></span></button>`;}).join(''):'<div class="empty">Нет товаров. В рабочем режиме каталог заполняется на листе «Товары».</div>';
 $('#products').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,1,b.querySelector('strong').textContent));
}
function canSell(){return ['admin','manager','cashier'].includes(data.employee.role);}
let saleFeedback=null,reviewedUsage=null;
function clearSaleCart(){cart={};reviewedUsage=null;saleFeedback=null;}
function productName(id){return data.products.find(p=>p.id===id)?.name||id||'';}
function pointName(){return data.locations.find(x=>x.id===locationId)?.name||locationId||'точка не выбрана';}
function usageKey(plan){return JSON.stringify(plan.map(i=>[i.product_id,i.qty]).sort((a,b)=>a[0].localeCompare(b[0])));}
function showSaleFeedback(message,actions=[],title='Продажа · '+pointName(),reveal=true){
 saleFeedback={title,message,actions};
 renderSaleFeedback(reveal);
}
function renderSaleFeedback(reveal=false){
 const panel=$('#sale-feedback');
 if(!panel)return;
 const current=saleFeedback||(pending?{
   title:'Продажа · '+pointName(),
   message:'CRM не подтвердила операцию. Проверьте результат с тем же ID.',
   actions:[['Проверить операцию',retryPending]],
 }:null);
 panel.hidden=!current;
 $('#sale-refresh').hidden=!!current?.actions.some(([,action])=>action===refresh);
 if(!current)return;
 $('#sale-feedback-message').innerHTML=(current.title?'<strong>'+esc(current.title)+'</strong>':'')+'<p>'+esc(current.message)+'</p>';
 $('#sale-feedback-actions').replaceChildren(...current.actions.map(([label,action])=>{
   const button=document.createElement('button');
   button.type='button';button.textContent=label;button.onclick=action;
   button.disabled=busy||(action===refresh&&refreshing);
   return button;
 }));
 if(reveal)panel.scrollIntoView({block:'nearest'});
}
function chooseSalePoint(){const control=$('#location');control.focus();control.scrollIntoView({block:'nearest'});}
function focusCart(){const lines=$('#cart-lines');lines.scrollIntoView({block:'nearest'});lines.querySelector('button')?.focus();}
function explainSale(error,id,label,phase='add'){
 const detail=error.stockIssue,code=detail?.code||error.code;
 const name=label||productName(id||detail?.product_id);
 const title=(phase==='add'&&name?'Не добавлен товар «'+name+'»':name?'Продажа · '+name:'Продажа')+' · '+pointName();
 const refreshAction=['Обновить остатки',refresh],pointAction=['Выбрать точку',chooseSalePoint],quantityAction=['Проверить количество',focusCart];
 let message,actions=[];
 switch(code){
  case 'busy':message='Выполняется операция. Дождитесь ответа CRM.';break;
  case 'pending':
   message='CRM не подтвердила операцию. Проверьте результат с тем же ID.';
   actions=[['Проверить операцию',retryPending]];break;
  case 'permission':
   message='Ваша роль разрешает просмотр. Для продажи нужны права кассира, менеджера или администратора.';break;
  case 'snapshot_required':
   message='Доступные остатки устарели или ещё не получены. Обновите данные и повторите действие.';
   actions=[refreshAction];break;
  case 'wrong_location':
   message='Эта точка отсутствует в актуальных данных CRM. Выберите действующую точку.';
   actions=[pointAction,refreshAction];break;
  case 'missing_product':
   message='Позиции нет в актуальном каталоге. Обновите список товаров и уберите позицию из корзины, если она там осталась.';
   actions=[refreshAction,...(Object.keys(cart).length?[quantityAction]:[])];break;
  case 'invalid_recipe':
   message='Проверьте рецепт сборки и учёт остатков основы у позиции «'+productName(detail?.product_id||id)+'».';
   actions=[refreshAction];break;
  case 'invalid_quantity':
   message='Проверьте количество. Товары со сборкой учитываются целыми штуками.';
   actions=Object.keys(cart).length?[quantityAction]:[];break;
  case 'ready_shortage':
  case 'base_shortage': {
   const stockId=detail.stock_id,base=code==='base_shortage';
   const held=phase==='add'?inventoryAt(locationId):null;
   const online=held?.online_reserved?.[stockId]||0,total=held?.reserved?.[stockId]||0;
   const {available,needed}=detail;
   message=(base?'Не хватает основы для сборки «'+productName(detail.product_id)+'». ':'')+
     (stockId!==id?'«'+productName(stockId)+'». ':'')+'Доступно '+available+', требуется '+needed+'.';
   if(online>0)message+=' Зарезервировано онлайн: '+online+'.';
   if(total>online)message+=' В других резервах: '+CRMCore.qty(total-online)+'.';
   if(phase==='add'&&available===0&&!total&&!base&&!(data.stock[CRMCore.key(locationId,stockId)]>0))
     message+=' На этой точке готового товара нет.';
   actions=[refreshAction];
   const alternatives=data.locations.filter(l=>l.id!==locationId&&(displayedStock(stockId,l.id)||0)>0);
   if(alternatives.length){
     message+=' Есть в наличии на точке «'+alternatives.map(l=>l.name).join('», «')+'».';
     actions.push(pointAction);
   }
   if(Object.keys(cart).length)actions.push(quantityAction);
   break;
  }
  default:
   message=error.confirmed&&error.message?error.message:'Не удалось проверить действие. Обновите остатки и повторите.';
   actions=[refreshAction,...(Object.keys(cart).length?[quantityAction]:[])];
 }
 showSaleFeedback(message,actions,title);
}
function saleError(code){return Object.assign(new Error(code),{code});}
function confirmAssembly(product,amount,accept){
 const recipe=data.assembly_recipes[product.id],base=productName(recipe.base_product_id);
 $('#dialog-title').textContent='Использовать основу для сборки?';
 $('#fields').innerHTML='<p>Позиция «'+esc(product.name)+'» · '+esc(pointName())+'.</p><p>Использовать '+
  CRMCore.qty(amount*recipe.base_qty)+' шт «'+esc(base)+'»?</p><button type="button" id="classic-no">Не добавлять</button>';
 $('#form-error').textContent='';$('#form-progress').textContent='';$('#submit').disabled=false;$('#submit').textContent='Добавить';
 $('#classic-no').onclick=()=>$('#dialog').close();
 $('#form').onsubmit=e=>{e.preventDefault();$('#dialog').close();accept();};
 $('#dialog').showModal();
}
function add(id,n,label,confirmedUsage){
 if(busy||pending)return explainSale(saleError(busy?'busy':'pending'),id,label);
 if($('#dialog').open){$('#form-progress').textContent='Сначала закройте текущее окно.';return;}
 if(!canSell())return explainSale(saleError('permission'),id,label);
 if(!data.locations.some(point=>point.id===locationId))return explainSale(saleError('wrong_location'),id,label);
 if(n!==1&&n!==-1)return explainSale(saleError('invalid_quantity'),id,label);
 const next={...cart},q=(cart[id]||0)+n;
 if(q<=0)delete next[id];else next[id]=q;
 let keepApproval=!Object.keys(cart).length;
 if(!keepApproval){try{keepApproval=reviewedUsage===usageKey(cartPlan());}catch{}}
 let usage=null;
 if(n<0){
   if(keepApproval){try{usage=usageKey(cartPlan(next));}catch{}}
 }else{
   const product=data.products.find(x=>x.id===id);
   if(!product)return explainSale(saleError('missing_product'),id,label);
   try{usage=usageKey(cartPlan(next));}catch(error){return explainSale(error,id,label);}
   const addedBase=fromClassic(id,next)-fromClassic(id,cart);
   if(addedBase>0&&confirmedUsage!==usage)
     return confirmAssembly(product,addedBase,()=>add(id,n,label,usage));
 }
 cart=next;reviewedUsage=keepApproval?usage:null;saleFeedback=null;
 renderProducts();renderCart();renderSaleFeedback();
}
function renderCart(){
 const lines=Object.entries(cart);let problem=false;
 try{cartPlan();}catch{problem=true;}
 $('#cart-lines').innerHTML=lines.length?lines.map(([id,q])=>{
   const p=data.products.find(x=>x.id===id),fromBase=p?fromClassic(id):0,name=esc(p?.name||id);
   const step=(n,caption)=>'<button type="button" data-id="'+esc(id)+'" data-n="'+n+'" aria-label="'+caption+' количество '+name+'">'+(n<0?'−':'+')+'</button>';
   return '<div class="cart-row"><div class="line"><span>'+name+'</span><strong>'+(p?rub(p.price*q):'Удалён из каталога')+
    '</strong></div>'+(fromBase?'<p class="muted">'+fromBase+' по рецепту</p>':'')+
    '<div class="stepper">'+step(-1,'Уменьшить')+'<span>'+q+' '+esc(p?.unit||'шт')+'</span>'+step(1,'Увеличить')+'</div></div>';
 }).join(''):'<div class="empty">Добавьте товар из каталога. Здесь появятся количество и сумма.</div>';
 if(problem&&lines.length)$('#cart-lines').insertAdjacentHTML('beforeend','<p class="danger">Проверьте остатки и состав корзины перед продажей.</p>');
 $('#cart-lines').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,Number(b.dataset.n)));
 $('#total').textContent=rub(lines.reduce((a,[id,q])=>a+(data.products.find(x=>x.id===id)?.price||0)*q,0));
 const jump=$('#jump-cart');jump.textContent='К корзине · '+$('#total').textContent;
 const box=$('.cart').getBoundingClientRect();jump.hidden=!lines.length||(box.top<innerHeight && box.bottom>0);
 $('#sell').disabled=busy||!!pending||!canSell()||!lines.length||!currentShift();
}
async function sell(){
 if(busy||pending)return explainSale(saleError(busy?'busy':'pending'),null,'','sell');
 if(!canSell())return explainSale(saleError('permission'),null,'','sell');
 if(!currentShift()||!Object.keys(cart).length)return;
 let usage;
 try{usage=cartPlan();}catch(error){return explainSale(error,null,'','sell');}
 const key=usageKey(usage);
 if(reviewedUsage!==key){
   const list=usage.map(l=>'<li>'+esc(productName(l.product_id))+' · '+l.qty+'</li>').join('');
   return dialog('Проверьте списание со склада',list?'<ul>'+list+'</ul>':'<p>Позиции без списания со склада.</p>',()=>{
     if(usageKey(cartPlan())!==key)throw Error('Списание изменилось. Закройте окно и обновите остатки.');
     reviewedUsage=key;saleFeedback=null;
   });
 }
 const d={location_id:locationId,lines:Object.entries(cart).map(([product_id,qty])=>({product_id,qty})),
   expected_stock_usage:usage,method:$('#payment').value,partner_id:$('#partner').value};
 if(d.method==='unpaid'&&!d.partner_id)return showSaleFeedback('Выберите партнёра для продажи в долг.',[['Выбрать партнёра',()=>$('#partner').focus()]]);
 showSaleFeedback('Отправляем продажу. Дождитесь ответа CRM.',[],'Продажа · '+pointName(),false);
 try{
   const operation=mutate('sale.create',d);
   $('#location').disabled=true;renderCart();
   await operation;
   clearSaleCart();render();notify('Продажа сохранена');
 }catch(error){
   explainSale(pending?saleError('pending'):error,null,'','sell');
   $('#location').disabled=!!pending;
   renderCart();
 }
}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Пока нет записей</td></tr>`}</tbody></table></div>`;}
function short(id){return esc(String(id).slice(0,8));}function date(s){return new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderSales(){const sales=data.sales.filter(s=>s.location_id===locationId);$('#content').innerHTML=`<div class="toolbar"><span class="muted">Последние 300 документов · время Москвы</span><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Документ','Время','Состав','Сумма','Оплачено','Статус','Действия'],sales.map(s=>[short(s.id),date(s.created_at),esc(s.lines.map(l=>l.name+' × '+l.qty).join(', ')),rub(s.total),rub(s.paid),s.status==='refunded'?'Возвращён':s.paid<s.total?'Есть долг':'Продан',s.status==='sold'?`<button data-refund="${esc(s.id)}">Возврат</button>${s.total>s.paid?`<button data-pay="${esc(s.id)}">Принять оплату</button>`:''}`:'—']))}</div>`;$('#content').querySelectorAll('[data-refund]').forEach(b=>b.onclick=()=>refundDialog(b.dataset.refund));$('#content').querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>paymentDialog(b.dataset.pay));}
function input(name,label,type='text',value='',extra=''){return `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra} required>`;}
function select(name,label,options){return `<label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;}
function dialog(title,fields,save){$('#submit').textContent='Сохранить';if(busy||pending)return notify('Есть незавершённая операция. Откройте настройки для повторной отправки.');$('#dialog-title').textContent=title;$('#fields').innerHTML=fields;$('#form-error').textContent='';$('#form-progress').textContent='';$('#submit').disabled=false;$('#form').onsubmit=async e=>{e.preventDefault();if(busy)return;$('#submit').disabled=true;try{await save(Object.fromEntries(new FormData(e.target)));$('#dialog').close();render();notify('Сохранено');}catch(err){const node=$('#form-error');node.textContent=err.name==='AbortError'?'CRM не ответила за 40 секунд. Операция могла сохраниться. Проверьте список товаров или повторите неподтвержденную операцию в настройках.':err.message;node.scrollIntoView({block:'nearest'});}finally{$('#submit').disabled=false;$('#submit').textContent='Сохранить';}};$('#dialog').showModal();}
function shiftDialog(){const shift=currentShift();if(shift)dialog('Закрытие смены',`<p class="muted">Ожидаемые наличные: ${rub(shift.expected_cash)}</p>`+input('actual_cash','Наличные по факту, ₽','number','', 'min="0" step="0.01"')+input('reason','Комментарий / причина расхождения','text','Без расхождений'),v=>mutate('shift.close',{location_id:locationId,...v}));else dialog('Открытие смены',input('opening_cash','Разменные наличные, ₽','number','0','min="0" step="0.01"'),v=>mutate('shift.open',{location_id:locationId,...v}));}
function refundDialog(id){const order=(data.orders||[]).find(o=>o.sale_id===id&&o.source==='site-paid');if(order)return notify('Онлайн-возврат оформляется через банк');dialog('Полный возврат продажи',input('reason','Причина')+select('restock','Возвращать товар в остаток?',[['false','Нет — товар не возвращён в продажу'],['true','Да — товар можно снова продавать']]),v=>mutate('sale.refund',{location_id:locationId,sale_id:id,reason:v.reason,restock:v.restock==='true'}));}
function paymentDialog(id){const s=data.sales.find(x=>x.id===id);dialog('Погашение долга',input('amount','Сумма, ₽','number',(s.total-s.paid)/100,'min="0.01" step="0.01"')+select('method','Способ',[['cash','Наличные'],['card','Терминал'],['transfer','Перевод']]),v=>mutate('payment.add',{location_id:locationId,sale_id:id,...v}));}
function renderStock(){const list=data.products.filter(p=>p.stock_tracked);$('#content').innerHTML=`<div class="toolbar"><button onclick="stockDialog('stock.receive')">+ Приход</button><button onclick="stockDialog('stock.writeoff')">Списание</button><button onclick="stockDialog('stock.count')">Инвентаризация</button><button onclick="stockDialog('stock.transfer')">Перемещение</button><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Позиция','Категория','Готовых свободно','Минимум','Состояние'],list.map(p=>[esc(p.name),esc(p.category),(displayedStock(p.id)===null?'—':displayedStock(p.id)+' '+esc(p.unit)),p.min_stock||0,displayedStock(p.id)===null?'Обновите остатки':displayedStock(p.id)<Number(p.min_stock)?'<span class="badge low">Мало</span>':'<span class="badge">Достаточно</span>']))}</div>`;}
function renderProductAdmin(){
 const canEdit=live&&['admin','manager'].includes(data.employee.role);
 const cards=Object.fromEntries((data.site_cards||[]).map(p=>[p.product_id,p]));
 const pencil='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L9 17l-4 1 1-4L16.5 3.5Z"/></svg>';
 $('#content').innerHTML=`<div class="toolbar"><button class="primary" id="new-product" ${canEdit?'':'disabled'}>+ Добавить товар</button><button onclick="refresh()">Обновить</button></div><div class="panel product-admin"><p class="muted">Откройте товар, чтобы изменить его и карточку сайта в одной форме.</p><div class="product-admin-list">${data.products.map(p=>{
  const card=cards[p.id],legacy=!!MOLINE_LEGACY_IMAGES[p.id],eligible=data.capabilities?.site_cards&&!['ADD_001','ADD_002','SYS_PAYMENT_TEST'].includes(p.id);
  const shown=card?.next_price_on&&card.next_price_on<=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Moscow'})?Number(card.next_price)*100:p.price;
  const photo=card?.media_id?`https://molinebymonk.ru/api/auth/catalog/media/${esc(card.media_id)}.webp`:MOLINE_LEGACY_IMAGES[p.id];
  const image=photo?`<img class="product-thumb" src="${photo}" alt="" loading="lazy">`:'<span class="product-thumb product-thumb-empty" aria-hidden="true"></span>';
  const published=legacy?(!card||card.published===true):card?.published===true;
  const state=published?'На сайте':card?'Снят с сайта':'Не на сайте';
  const edit=eligible?`<button class="product-edit" data-site-edit="${esc(p.id)}" aria-label="${card||legacy?'Редактировать':'Оформить'}: ${esc(p.name)}" title="${card||legacy?'Редактировать':'Оформить'}" ${canEdit?'':'disabled'}>${pencil}</button>`:'';
  const publish=eligible?(published?`<button class="product-state-action" data-site-unpublish="${esc(p.id)}" ${canEdit?'':'disabled'}>Снять с сайта</button>`:card?`<button class="product-state-action" data-site-publish="${esc(p.id)}" ${canEdit?'':'disabled'}>Опубликовать</button>`:''):'';
  const archive=eligible?`<button class="product-archive danger" data-product-archive="${esc(p.id)}" ${canEdit?'':'disabled'}>Удалить товар</button>`:'';
  return `<article class="product-admin-row">${image}<div class="product-admin-main"><strong>${esc(p.name)}</strong><div class="product-admin-meta"><span>${rub(shown)}</span><span class="product-admin-status">${state}</span></div>${p.stock_tracked&&live?shiftProduct(p):''}${publish}${archive}</div>${edit}</article>`;
 }).join('')}</div></div>`;
 $('#new-product').onclick=()=>productDialog();
 $('#content').querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=()=>productDialog(b.dataset.siteEdit));
 $('#content').querySelectorAll('[data-site-publish]').forEach(b=>b.onclick=()=>publishSiteProduct(b.dataset.sitePublish));
 $('#content').querySelectorAll('[data-site-unpublish]').forEach(b=>b.onclick=()=>unpublishSiteProduct(b.dataset.siteUnpublish));
 $('#content').querySelectorAll('[data-product-archive]').forEach(b=>b.onclick=()=>archiveProduct(b.dataset.productArchive));
}
function shiftProduct(p){
 const inventory=data.inventory?.locations?.[locationId];
 if(!inventory)return '';
 const stock=data.stock[locationId+':'+p.id]||0,held=inventory.reserved[p.id]||0;
 const dates=data.bake?.[p.id]||[];
 return `<div class="shift-product"><dl class="shift-counts">
   <div><dt>В наличии</dt><dd>${stock}</dd></div>
   <div><dt>В резерве</dt><dd>${held}</dd></div>
   <div><dt>Свободно сегодня</dt><dd>${inventory.available[p.id]??0}</dd></div>
 </dl>
 ${inventory.carry?.[p.id]?`<p>Осталось с прошлых смен: ${inventory.carry[p.id]} шт. · ожидает решения цеха</p>`:''}
 ${held>stock-(inventory.carry?.[p.id]||0)?`<p>Не хватает ${held-stock+(inventory.carry?.[p.id]||0)} шт. для выдачи</p>`:''}
 <p>Предзаказ: ${esc(dates.find(x=>x.open)?.date||'дата не открыта')}</p>
 <button data-batch="${esc(p.id)}">Внести партию</button>
 ${locationId==='CAFE'&&p.category.toLowerCase()==='выпечка'?`<button data-bake="${esc(p.id)}">План выпечки</button>`:''}</div>`;
}
document.addEventListener('click',e=>{
 const batch=e.target.closest('[data-batch]'),plan=e.target.closest('[data-bake]');
 if(!batch&&!plan)return;
 const id=batch?.dataset.batch||plan.dataset.bake,p=data.products.find(x=>x.id===id);
 if(batch)return dialog('Внести партию · '+p.name,input('qty','Испечено, шт.','number','','min="1" step="1" required'),v=>mutate('stock.receive',{location_id:locationId,product_id:id,qty:Number(v.qty),reason:'Утренняя партия'}));
 const rows=data.bake?.[id]||[];
 dialog('План выпечки · '+p.name,'<p>Сохраните план, чтобы продавать готовый остаток по этой позиции. Лимит задаётся отдельно на каждую дату.</p>'+rows.map(x=>`<p>${esc(x.date)} · план ${x.capacity} · оплачено ${x.promised} · свободно ${x.free}</p>`).join('')+input('date','Дата получения','date','','required')+input('capacity','Лимит в штуках (0 — закрыть)','number','','min="0" step="1" required'),v=>mutate('bake.plan',{location_id:locationId,product_id:id,date:v.date,capacity:Number(v.capacity)}));
});
async function archiveProduct(id){
 const product=data.products.find(p=>p.id===id);if(!product)return;
 if(Object.keys(cart).some(key=>key===id))return notify('Сначала уберите товар из текущей продажи');
 if(!confirm(`Убрать «${product.name}» из CRM и с сайта? История продаж сохранится.`))return;
 try{await mutate('catalog.product.archive',{product_id:id});render();notify('Товар перемещен в архив');}catch(error){notify(error.message);}
}
const preparedPhotos=new WeakMap();
function imageCropBounds(bitmap){
 const sample=document.createElement('canvas');sample.width=sample.height=160;
 const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(bitmap,0,0,160,160);
 const data=ctx.getImageData(0,0,160,160).data;
 const corners=[[2,2],[157,2],[2,157],[157,157]].map(([x,y])=>[...data.slice((y*160+x)*4,(y*160+x)*4+4)]);
 const transparent=corners.every(c=>c[3]<24),uniform=!transparent&&corners.every(c=>c[3]>245&&c.slice(0,3).every((v,i)=>Math.abs(v-corners[0][i])<14));
 if(!transparent&&!uniform)return null;
 let minX=160,minY=160,maxX=-1,maxY=-1,content=0;
 for(let y=0;y<160;y++)for(let x=0;x<160;x++){
  const i=(y*160+x)*4,foreground=transparent?data[i+3]>36:Math.max(Math.abs(data[i]-corners[0][0]),Math.abs(data[i+1]-corners[0][1]),Math.abs(data[i+2]-corners[0][2]))>32;
  if(foreground){minX=Math.min(x,minX);minY=Math.min(y,minY);maxX=Math.max(x,maxX);maxY=Math.max(y,maxY);content++;}
 }
 if(content<160||maxX<minX||maxY<minY)return null;
 const width=(maxX-minX+1)/160,height=(maxY-minY+1)/160;
 if(width>.9&&height>.9)return null;
 const margin=.07*Math.max(width,height),left=Math.max(0,minX/160-margin),top=Math.max(0,minY/160-margin),right=Math.min(1,(maxX+1)/160+margin),bottom=Math.min(1,(maxY+1)/160+margin);
 return {x:Math.floor(left*bitmap.width),y:Math.floor(top*bitmap.height),w:Math.max(1,Math.ceil((right-left)*bitmap.width)),h:Math.max(1,Math.ceil((bottom-top)*bitmap.height))};
}
async function preparedPhoto(file,autoCrop){
 if(!(file instanceof File)||!file.size)return null;
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Нужен PNG, JPEG или WebP');
 const key=autoCrop?'crop':'original',cached=preparedPhotos.get(file);
 if(cached?.[key])return cached[key];
 let bitmap;try{bitmap=await createImageBitmap(file);}catch{throw Error('Не удалось открыть фото. Сохраните его как PNG или JPEG и попробуйте снова.');}
 try{
  const crop=autoCrop?imageCropBounds(bitmap):null,source=crop||{x:0,y:0,w:bitmap.width,h:bitmap.height};
  const canvas=document.createElement('canvas');let blob;
  for(const maxSide of [1200,1000,800,640]){
   const scale=Math.min(1,maxSide/Math.max(source.w,source.h));canvas.width=Math.max(1,Math.round(source.w*scale));canvas.height=Math.max(1,Math.round(source.h*scale));
   canvas.getContext('2d').drawImage(bitmap,source.x,source.y,source.w,source.h,0,0,canvas.width,canvas.height);
   for(const quality of [.88,.75,.62,.5]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob?.type==='image/webp'&&blob.size<=750000)break;}
   if(blob?.type==='image/webp'&&blob.size<=750000)break;
   await new Promise(resolve=>setTimeout(resolve,0));
  }
  if(!blob||blob.type!=='image/webp'||blob.size>750000)throw Error('Не получилось подготовить фото. Попробуйте PNG или JPEG.');
  preparedPhotos.set(file,{...cached,[key]:blob});return blob;
 }finally{bitmap.close();}
}
async function imageData(file,autoCrop){
 const blob=await preparedPhoto(file,autoCrop);if(!blob)return '';
 const bytes=new Uint8Array(await blob.arrayBuffer()),parts=[];
 for(let i=0;i<bytes.length;i+=32768){parts.push(String.fromCharCode(...bytes.subarray(i,i+32768)));if(i&&i%262144===0)await new Promise(resolve=>setTimeout(resolve,0));}
 return btoa(parts.join(''));
}
async function productSaveStage(message){
 const progress=$('#form-progress');if(progress)progress.textContent=message;
 const submit=$('#submit');if(submit)submit.textContent='Сохраняем…';
 await new Promise(resolve=>requestAnimationFrame(resolve));
}
async function publishSiteProduct(id){
 try{requireSiteEditor();if(!confirm('Проверили фото, описание, состав и правило склада? Товар появится на сайте после публикации.'))return;await mutate('catalog.site.publish',{product_id:id});render();notify('Товар опубликован на сайте');}catch(e){notify(e.message);}
}
async function unpublishSiteProduct(id){
 try{requireSiteEditor();if(!confirm('Снять товар с сайта? Оформленные заказы сохранятся.'))return;await mutate('catalog.site.unpublish',{product_id:id});render();notify('Товар снят с сайта');}catch(e){notify(e.message);}
}
function productDialog(id=''){
 if(!live||!['admin','manager'].includes(data.employee.role))return;
 const p=id?data.products.find(x=>x.id===id):null;
 if(id&&!p)return;
 const card=(data.site_cards||[]).find(x=>x.product_id===id),legacy=!!(id&&MOLINE_LEGACY_IMAGES[id]);
 const published=legacy?(!card||card.published===true):card?.published===true;
 const categories=[...new Set(['Выпечка','Напитки','Десерты',...data.products.map(x=>x.category).filter(Boolean)])];
 const imageUrl=card?.media_id?`https://molinebymonk.ru/api/auth/catalog/media/${esc(card.media_id)}.webp`:MOLINE_LEGACY_IMAGES[id];
 const stock=p?.stock_tracked?'true':'false';
 const fields=`<h3>Товар CRM</h3>`+
  input('name','Название','text',p?.name||'','maxlength="100"')+
  select('category','Категория',categories.map(c=>[c,c]))+
  '<label for="f-category_new">Или новая категория</label><input id="f-category_new" name="category_new" maxlength="40" placeholder="Например, завтраки">'+
  select('unit','Единица',[['шт','шт'],['кг','кг'],['л','л']])+
  input('price','Цена, ₽','number',p?p.price/100:'','min="0.01" max="100000" step="0.01" inputmode="decimal"')+
  `<label for="f-cost">Себестоимость, ₽ (необязательно)</label><input id="f-cost" name="cost" type="number" min="0" step="0.01" value="${esc(p?.cost==null?'':p.cost/100)}">`+
  select('stock_tracked','Учитывать остатки?', [['false','Нет'],['true','Да']])+
  input('min_stock','Минимальный остаток','number',p?.min_stock??0,'min="0" max="100000" step="0.001" inputmode="decimal"')+
  `<h3>Карточка сайта</h3><label for="site-name">Название на сайте (необязательно)</label><input id="site-name" name="site_name" maxlength="100" value="${esc(card?.site_name||'')}" placeholder="Как в CRM">`+
  `<label for="site-photo">${imageUrl?'Заменить фото':'Фото товара'}</label><input id="site-photo" name="image" type="file" accept="image/png,image/jpeg,image/webp"><label class="photo-auto-crop"><input id="photo-auto-crop" name="auto_crop" type="checkbox" checked> Убрать пустые однотонные поля у нового фото</label><p id="photo-prepare-status" class="muted" role="status"></p><p class="muted">Настройте оба вида до сохранения. Изменения видны сразу; снимок страницы повторяет настройки сайта.</p>`+
  `<div class="photo-preview-pair"><section><h4>В каталоге</h4><div class="site-preview size-${esc(card?.image_size||'medium')}" id="site-preview"><div class="site-preview-image">${imageUrl?`<img class="site-photo" crossorigin="anonymous" src="${esc(imageUrl)}" alt="Фото в каталоге">`:'<span>Фото пока не выбрано</span>'}</div><strong id="site-preview-name">${esc(card?.site_name||p?.name||'Новый товар')}</strong><span id="site-preview-price">${p?rub(p.price):'Цена'}</span><span class="site-preview-add">добавить</span></div></section><section><h4>Открытая карточка</h4><div class="detail-preview"><div class="detail-preview-header"><strong id="detail-preview-name">${esc(card?.site_name||p?.name||'Новый товар')}</strong><span>♡</span></div><div class="detail-preview-image">${imageUrl?`<img class="site-photo" crossorigin="anonymous" src="${esc(imageUrl)}" alt="Фото в карточке">`:'<span>Фото пока не выбрано</span>'}</div><span>в корзину</span></div></section></div>`+
  select('image_size','Размер в каталоге',[['small','Компактный'],['medium','Обычный'],['large','Крупный']])+
  `<label for="f-image_zoom">Масштаб в каталоге <output id="image-zoom-value"></output></label><input id="f-image_zoom" name="image_zoom" type="range" min="0.5" max="6" step="0.1" value="${esc(card?.image_zoom||1)}"><label for="f-image_x">Каталог: левее / правее</label><input id="f-image_x" name="image_x" type="range" min="-100" max="100" step="1" value="${esc(card?.image_x??0)}"><label for="f-image_y">Каталог: выше / ниже</label><input id="f-image_y" name="image_y" type="range" min="-100" max="100" step="1" value="${esc(card?.image_y??0)}"><button type="button" id="reset-image-position">Сбросить положение в каталоге</button>`+
  `<label for="f-detail_image_zoom">Масштаб в карточке <output id="detail-zoom-value"></output></label><input id="f-detail_image_zoom" name="detail_image_zoom" type="range" min="0.5" max="6" step="0.1" value="${esc(card?.detail_image_zoom||1)}"><label for="f-detail_image_x">Карточка: левее / правее</label><input id="f-detail_image_x" name="detail_image_x" type="range" min="-100" max="100" step="1" value="${esc(card?.detail_image_x??0)}"><label for="f-detail_image_y">Карточка: выше / ниже</label><input id="f-detail_image_y" name="detail_image_y" type="range" min="-100" max="100" step="1" value="${esc(card?.detail_image_y??0)}"><button type="button" id="reset-detail-position">Сбросить положение в карточке</button>`+
  `<label for="site-description">Описание</label><textarea id="site-description" name="description" maxlength="2000">${esc(card?.description||'')}</textarea>`+
  `<label for="site-ingredients">Состав и аллергены</label><textarea id="site-ingredients" name="ingredients" maxlength="2000">${esc(card?.ingredients||'')}</textarea>`+
  `<label for="f-weight">Масса или объем порции</label><input id="f-weight" name="weight" maxlength="30" placeholder="70 г или 300 мл" value="${esc(card?.weight||'')}">`+
  `<fieldset class="nutrition-fields"><legend>Пищевая ценность</legend><p class="muted" id="nutrition-hint">Укажите КБЖУ на 100 г или 100 мл. Подойдут 5,6 и 5.6.</p><div class="nutrition-entry-grid">${siteNutrients.map(([key,label])=>`<label>${label}<input id="f-${key}" name="${key}" type="text" inputmode="decimal" maxlength="12" aria-describedby="nutrition-hint" value="${esc(card?.[key]??'')}"></label>`).join('')}</div><div id="nutrition-preview" aria-live="polite"></div></fieldset>`+
  (legacy?'':select('stock_mode','Правило наличия на сайте',[['manual','Включать вручную'],['finished','Готовый остаток'],['recipe','По рецепту сборки'],['made_to_order','Готовим под заказ (лимит дня)']]))+
  `<label for="site-next-price">Новая цена, ₽ (необязательно)</label><input id="site-next-price" name="next_price" type="number" min="0.01" step="0.01" value="${esc(card?.next_price||'')}"><label for="site-next-date">Дата новой цены (по Москве)</label><input id="site-next-date" name="next_price_on" type="date" value="${esc(card?.next_price_on||'')}">`+
  `<label class="product-publish-choice"><input name="publish" type="checkbox" ${published?'checked':''}> Показывать на сайте после сохранения</label><p class="muted">Черновик можно дополнить и опубликовать позже. Единица и учёт остатков фиксируются при создании.</p>`;
 let savedId=id;
 dialog(p?'Редактировать товар':'Новый товар',fields,async v=>{
  const nextCategory=(v.category_new||v.category).trim();
  if(!/^[а-яёa-z0-9][а-яёa-z0-9 -]{1,38}[а-яёa-z0-9]$/i.test(nextCategory))throw Error('Категория: 3–40 символов, буквы, цифры, пробел и дефис.');
  if(p&&v.unit!==p.unit)throw Error('Единицу существующего товара изменить нельзя.');
  if(p&&(v.stock_tracked==='true')!==p.stock_tracked)throw Error('Учёт остатков существующего товара изменить нельзя.');
  requireSiteEditor();
  const nutrients=Object.fromEntries(siteNutrients.map(([key,label])=>[key,siteNutrient(v[key],label)]));
  const wantsSite=v.publish==='on';
  await productSaveStage('Проверяем данные и обрабатываем фото…');
  const photo=await imageData(v.image,v.auto_crop==='on');let media_id=card?.media_id||'';
  if(wantsSite&&!legacy&&(!media_id&&!photo||!v.description.trim()||!v.ingredients.trim()))throw Error('Для публикации добавьте фото, описание и состав.');
  if(photo){await productSaveStage('Загружаем фото…');const upload=await api('catalog.media.upload',{image:photo},crypto.randomUUID());media_id=upload.media_id;}
  const details={name:v.name,category:nextCategory,unit:v.unit,price:v.price,cost:v.cost,stock_tracked:v.stock_tracked==='true',min_stock:v.min_stock};
  const productChanged=!p||p.name!==details.name||p.category!==details.category||p.unit!==details.unit||p.price!==Math.round(Number(details.price)*100)||(p.cost==null?'':p.cost)!==(details.cost===''?'':Math.round(Number(details.cost)*100))||p.stock_tracked!==details.stock_tracked||Number(p.min_stock||0)!==Number(details.min_stock);
  if(savedId&&productChanged){await productSaveStage('Обновляем товар в CRM…');await mutate('catalog.product.update',{product_id:savedId,...details});}
  else{
   if(!savedId){
    await productSaveStage('Создаем товар в CRM…');
    const before=new Set(data.products.map(x=>x.id));
    await mutate('catalog.product.create',details);
    const created=data.products.find(x=>!before.has(x.id)&&x.name===details.name&&x.category===details.category);
    if(!created)throw Error('Товар создан, но его код не найден. Обновите список и откройте товар для завершения.');
    savedId=created.id;
   }
  }
  const siteDetails={product_id:savedId,site_name:v.site_name,description:v.description,ingredients:v.ingredients,media_id,stock_mode:legacy?'legacy':v.stock_mode,next_price:v.next_price,next_price_on:v.next_price_on,weight:v.weight,...nutrients,image_size:v.image_size,image_x:Number(v.image_x),image_y:Number(v.image_y),image_zoom:Number(v.image_zoom),detail_image_zoom:Number(v.detail_image_zoom),detail_image_x:Number(v.detail_image_x),detail_image_y:Number(v.detail_image_y)};
  const siteChanged=!card||['site_name','description','ingredients','media_id','stock_mode','next_price','next_price_on','weight','calories','protein','fat','carbs','image_size','image_x','image_y','image_zoom','detail_image_zoom','detail_image_x','detail_image_y'].some(key=>String(card[key]??(key==='image_size'?'medium':''))!==String(siteDetails[key]??''));
  if(siteChanged){await productSaveStage('Сохраняем карточку сайта…');await mutate('catalog.site.save',siteDetails);}
  const currently=legacy?(!card||card.published===true):card?.published===true;
  if(wantsSite&&!currently){await productSaveStage('Публикуем товар на сайте…');await mutate('catalog.site.publish',{product_id:savedId});}
  if(!wantsSite&&currently){await productSaveStage('Снимаем товар с сайта…');await mutate('catalog.site.unpublish',{product_id:savedId});}
 });
 $('#f-category').value=p?.category||categories[0];$('#f-unit').value=p?.unit||'шт';
 $('#f-stock_tracked').value=stock;
 if(p){for(const name of ['unit','stock_tracked']){const select=$('#f-'+name);select.disabled=true;const hidden=document.createElement('input');hidden.type='hidden';hidden.name=name;hidden.value=select.value;select.after(hidden);}}
 if(!legacy)$('#f-stock_mode').value=card?.stock_mode||((p?.stock_tracked)?'finished':'manual');
 $('#f-image_size').value=card?.image_size||'medium';
 $('#f-image_size').onchange=e=>{$('#site-preview').className='site-preview size-'+e.target.value;position();};
 let previewURL=null;
 // Match the site's alpha-based fitting, including transparent PNGs.
 const fitImage=img=>{if(!img.naturalWidth)return;try{const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d',{willReadFrequently:true}),ratio=Math.min(96/img.naturalWidth,96/img.naturalHeight),w=img.naturalWidth*ratio,h=img.naturalHeight*ratio;ctx.drawImage(img,(96-w)/2,(96-h)/2,w,h);const pixels=ctx.getImageData(0,0,96,96).data;let minX=96,minY=96,maxX=-1,maxY=-1,opaque=0;for(let y=0;y<96;y++)for(let x=0;x<96;x++){let alpha=pixels[(y*96+x)*4+3];if(alpha>245)opaque++;if(alpha>32){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}}if(maxX<0||opaque>9000){img.dataset.fitScale=.82;img.dataset.fitX=0;img.dataset.fitY=0;}else{const width=(maxX-minX+1)/96,height=(maxY-minY+1)/96,scale=Math.max(.7,Math.min(1.12,.72/Math.max(width,height)));img.dataset.fitScale=scale;img.dataset.fitX=(48-(minX+maxX+1)/2)*scale/96*100;img.dataset.fitY=(48-(minY+maxY+1)/2)*scale/96*100;}}catch{img.dataset.fitScale=.82;img.dataset.fitX=0;img.dataset.fitY=0;}position();};
 const position=()=>{for(const [selector,prefix] of [['#site-preview .site-photo',''],['.detail-preview .site-photo','detail_']]){const img=$(selector);if(!img)continue;const detail=!!prefix,size=$('#f-image_size').value,sizeFactor=detail?1:size==='small'?.86:size==='large'?1.08:1;img.style.setProperty('--preview-scale',Math.min(6,Number(img.dataset.fitScale||.82)*sizeFactor*Number($('#f-'+prefix+'image_zoom').value)));img.style.setProperty('--preview-x',(Number(img.dataset.fitX||0)+Number($('#f-'+prefix+'image_x').value))+'%');img.style.setProperty('--preview-y',(Number(img.dataset.fitY||0)+Number($('#f-'+prefix+'image_y').value))+'%');}$('#image-zoom-value').textContent=$('#f-image_zoom').value+'×';$('#detail-zoom-value').textContent=$('#f-detail_image_zoom').value+'×';};
 for(const key of ['image_zoom','image_x','image_y','detail_image_zoom','detail_image_x','detail_image_y'])$('#f-'+key).oninput=position;
 $('#reset-image-position').onclick=()=>{for(const key of ['image_x','image_y'])$('#f-'+key).value=0;$('#f-image_zoom').value=1;position();};
 $('#reset-detail-position').onclick=()=>{for(const key of ['detail_image_x','detail_image_y'])$('#f-'+key).value=0;$('#f-detail_image_zoom').value=1;position();};
 for(const img of document.querySelectorAll('.photo-preview-pair img')){img.onload=()=>fitImage(img);if(img.complete&&img.naturalWidth)fitImage(img);}position();
 $('#site-name').oninput=e=>{const value=e.target.value||$('#f-name').value||'Новый товар';$('#site-preview-name').textContent=value;$('#detail-preview-name').textContent=value;};
 $('#f-name').oninput=e=>{if(!$('#site-name').value){$('#site-preview-name').textContent=e.target.value||'Новый товар';$('#detail-preview-name').textContent=e.target.value||'Новый товар';}};
 $('#f-price').oninput=e=>{$('#site-preview-price').textContent=e.target.value?Number(e.target.value).toLocaleString('ru-RU')+' ₽':'Цена';};
 const previewFile=async()=>{const file=$('#site-photo').files?.[0];if(!file)return;const status=$('#photo-prepare-status');status.textContent='Подготавливаем фото…';try{const blob=await preparedPhoto(file,$('#photo-auto-crop').checked);if(file!==$('#site-photo').files?.[0])return;if(previewURL)URL.revokeObjectURL(previewURL);previewURL=URL.createObjectURL(blob);for(const selector of ['#site-preview .site-preview-image','.detail-preview-image']){const preview=$(selector);preview.replaceChildren();const img=document.createElement('img');img.className='site-photo';img.alt='Предпросмотр готового фото';img.onload=()=>fitImage(img);img.onerror=()=>notify('Не удалось показать выбранное фото');img.src=previewURL;preview.append(img);}status.textContent='Такой файл будет загружен на сайт';position();}catch(error){status.textContent=error.message;}};
 $('#site-photo').onchange=previewFile;$('#photo-auto-crop').onchange=previewFile;
 function previewNutrition(){
  const preview=$('#nutrition-preview'),values=siteNutrients.map(([key,label])=>{
   const control=$('#f-'+key);
   try{const number=siteNutrient(control.value,label);control.removeAttribute('aria-invalid');return [label,number];}
   catch{control.setAttribute('aria-invalid','true');return [label,null];}
  });
  const volume=/мл|литр|(?:\d|\s)л(?:\s|$)/i.test($('#f-weight').value);
  preview.innerHTML=values.some(([,number])=>number!==null)?`<strong>На ${volume?'100 мл':'100 г'} в карточке сайта</strong><dl>${values.map(([label,number])=>`<div><dt>${label}</dt><dd>${number===null?'—':number.toLocaleString('ru-RU')}</dd></div>`).join('')}</dl>`:'';
 }
 for(const name of ['weight',...siteNutrients.map(([key])=>key)])$('#f-'+name).addEventListener('input',previewNutrition);
 previewNutrition();
}
function renderAvailability(){
 const settings=data.site_availability,canEdit=live&&['admin','manager'].includes(data.employee.role);
 if(!settings){$('#content').innerHTML='<div class="panel"><p>Настройки наличия пока не загружены. Обновите CRM.</p></div>';return;}
 const toggle=(key,on,label,detail,effective)=>`<div class="availability-row"><div><strong>${esc(label)}</strong><p class="muted">${esc(detail)}${effective===false&&on?' · сейчас недоступен':''}</p></div><button type="button" class="availability-toggle ${on?'is-on':''}" data-availability-key="${esc(key)}" aria-pressed="${on}" aria-label="${esc(label)}: ${on?'выключить':'включить'}" ${canEdit?'':'disabled'}>${on?'Доступен':'Выключен'}</button></div>`;
 $('#content').innerHTML=`<div class="toolbar"><span class="muted">Изменения сразу действуют для новых заказов на сайте</span><button onclick="refresh()">Обновить</button></div><div class="panel"><h2>Ингредиенты</h2><p class="muted">Общий переключатель не меняет остатки и не отменяет уже оплаченные заказы.</p>${toggle('MILK_CLASSIC',settings.milk,'Классическое молоко','Латте, капучино, флет-уайт, раф, маття латте и какао')}</div><div class="panel"><h2>Позиции</h2><p class="muted">Можно выключить одну позицию независимо от общего переключателя молока. Выключение действует на все даты.</p>${settings.products.map(p=>toggle(p.id,p.enabled,p.name,p.category,p.effective)).join('')}</div>`;
 $('#content').querySelectorAll('[data-availability-key]').forEach(button=>button.onclick=async()=>{
  const key=button.dataset.availabilityKey,on=button.getAttribute('aria-pressed')==='true',next=!on;
  if(busy||pending)return;
  // Show the requested state immediately, but mark it as unconfirmed until the server responds.
  button.setAttribute('aria-pressed',String(next));button.setAttribute('aria-busy','true');
  button.classList.toggle('is-on',next);button.classList.add('is-saving');
  button.textContent=(next?'Доступен':'Выключен')+'…';button.title='Сохраняем на сервере';button.disabled=true;
  try{await mutate('catalog.availability',{key,active:next});render();notify(key==='MILK_CLASSIC'?'Наличие молока обновлено':'Доступность позиции обновлена');}
  catch(error){render();notify(error.message);}
 });
}
function stockDialog(action){if(!data.products.some(p=>p.stock_tracked))return notify('Сначала добавьте товары с учётом остатков');dialog({'stock.receive':'Приход товара','stock.writeoff':'Списание товара','stock.count':'Фактический остаток','stock.transfer':'Перемещение товара'}[action],select('product_id','Товар',data.products.filter(p=>p.stock_tracked).map(p=>[p.id,p.name+' · '+p.unit]))+input('qty',action==='stock.count'?'Сколько насчитали':'Количество','number','','min="0" step="0.001"')+(action==='stock.transfer'?select('to_location','Куда',data.locations.filter(x=>x.id!==locationId).map(x=>[x.id,x.name])):'')+input('reason','Основание / причина'),v=>mutate(action,{location_id:locationId,...v}));}
function renderShifts(){$('#content').innerHTML=`<div class="toolbar"><button onclick="shiftDialog()">${currentShift()?'Закрыть смену':'Открыть смену'}</button><button onclick="cashDialog('cash.in')">Внести наличные</button><button onclick="cashDialog('cash.out')">Изъять наличные</button><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Смена','Открытие','Закрытие','Начальные','По учёту','Факт','Разница'],data.shifts.filter(s=>s.location_id===locationId).map(s=>[short(s.id),date(s.opened_at),s.closed_at?date(s.closed_at):'<span class="badge">Открыта</span>',rub(s.opening_cash),rub(s.expected_cash),s.status==='closed'?rub(s.actual_cash):'—',s.status==='closed'?rub(s.difference):'—']))}</div>`;}
function cashDialog(action){dialog(action==='cash.in'?'Внесение наличных':'Изъятие наличных',input('amount','Сумма, ₽','number','','min="0.01" step="0.01"')+input('reason','Основание'),v=>mutate(action,{location_id:locationId,...v}));}
function renderReports(){$('#content').innerHTML=`<div class="toolbar"><input id="from" type="date" value="${today()}" aria-label="Начало периода"><input id="to" type="date" value="${today()}" aria-label="Конец периода"><button class="primary" onclick="loadReport()">Показать отчёт</button></div><div id="report"><div class="empty">Выберите период. Выручка и поступления считаются отдельно; долг показан на текущий момент.</div></div>`;loadReport();}
let reportRevision=0;
async function loadReport(){const rev=++reportRevision,target=$('#report'),point=locationId;
 const current=()=>rev===reportRevision&&target.isConnected&&point===locationId;
 const from=$('#from').value,to=$('#to').value;if(!from||!to||from>to)return notify('Проверьте даты');try{const r=live?await api('report',{location_id:locationId,from,to}):CRMCore.report(CRMCore.reduce(demoEvents),locationId,from,to);if(!current())return;target.innerHTML=`<div class="metrics">${[['Выручка за период',rub(r.revenue)],['Поступления − возвраты',rub(r.receipts)],['Продаж / возвратов',r.sale_count+' / '+r.refund_count],['Текущий долг партнёров',rub(r.debt)]].map(([l,v])=>`<div class="metric"><span class="muted">${l}</span><strong>${v}</strong></div>`).join('')}</div><div class="panel"><h2>Что входит в отчёт</h2><p>Продажи до возвратов: ${rub(r.gross)}. Возвраты: ${rub(r.refunds)}. Наличными принято за вычетом возвратов: ${rub(r.cash)}. Списаний: ${r.writeoffs}.</p><p>Прибыль пока не рассчитывается: для неё нужны подтверждённая себестоимость, расходы и правила списания ингредиентов.</p></div>`;}catch(e){if(current())target.textContent=e.message;}}
const orderLabels={new:'Новый',accepted:'Принят · резерв',ready:'Готов',fulfilled:'Выдан',cancelled:'Отменён'};
function renderOrders(){
 const orders=(data.orders||[]).filter(o=>o.location_id===locationId);
 $('#content').innerHTML=`<div class="toolbar"><button onclick="refresh()">Обновить заказы</button></div>`+orders.map(o=>{
  const online=o.source==='site-paid',paid=o.payment_status==='paid',refunded=o.payment_status==='refunded';
  return `<article class="panel"><h2>Заказ ${o.source==='site-paid'?esc(o.external_id.slice(-6).toUpperCase()):short(o.id)} · ${esc(orderLabels[o.status]||o.status)}</h2>${online?`<p class="badge">${refunded?'Оплата возвращена':paid?'Оплачен онлайн':'Проверяем оплату'}</p>`:''}${o.pilot?'<p class="muted">Тест оплаты · без приготовления</p>':''}<p>${date(o.created_at)} · ${esc(o.due_at)} · ${o.mode==='delivery'?'Доставка':'Самовывоз'}</p><p>${esc(o.customer?.name||'Контакт не указан')} · ${esc(o.customer?.phone)}<br>${esc(o.customer?.address||'')}</p><p>${o.lines.map(l=>esc(l.name)+' × '+l.qty).join('<br>')}</p><p>${esc(o.comment||'')}</p><strong>${rub(o.total)}</strong><div class="toolbar">${o.status==='new'&&(!online||paid)?`<button data-order="${esc(o.id)}" data-status="accepted">${o.pilot?'Принять тест':online?'Принять в работу':'Принять и зарезервировать'}</button>`:''}${o.status==='accepted'&&(!online||paid)?`<button data-order="${esc(o.id)}" data-status="ready">Готов</button>`:''}${o.status==='ready'&&(!online||paid)?`<button data-fulfill="${esc(o.id)}">${online?'Подтвердить выдачу':'Выдать и учесть оплату'}</button>`:''}${['new','accepted','ready'].includes(o.status)?`<button data-order="${esc(o.id)}" data-status="cancelled">Отменить</button>`:''}</div>${online&&o.status==='cancelled'&&paid?'<p class="muted">Заказ отменен. Возврат денег оформляется отдельно в банке.</p>':''}</article>`;
 }).join('');
 for(const hold of data.pending_holds||[]){const minutes=Math.max(0,Math.floor((Date.now()-Date.parse(hold.created))/60000));$('#content').insertAdjacentHTML('beforeend',`<article class="panel"><strong>Резерв № ${esc(hold.id.slice(-6))}</strong><p>${Date.now()>=hold.expires?'Требуется сверка с банком':'Ожидает оплаты'} · ${minutes} мин · получение ${esc(hold.date)}</p><button data-reconcile="${esc(hold.id)}">Сверить с банком</button></article>`);}
 if(!orders.length&&!data.pending_holds?.length)$('#content').innerHTML+='<div class="panel">Пока нет заказов</div>';
 $('#content').querySelectorAll('[data-reconcile]').forEach(b=>b.onclick=async()=>{
   b.disabled=true;try{await api('hold.reconcile',{id:b.dataset.reconcile},crypto.randomUUID());await refresh();notify('Сверка запрошена. До ответа банка резерв сохраняется.');}
   catch(e){notify(e.message);}finally{b.disabled=false;}
 });
 $('#content').querySelectorAll('[data-order]').forEach(b=>b.onclick=()=>{
  const o=orders.find(o=>o.id===b.dataset.order),cancel=b.dataset.status==='cancelled';
  const fields=cancel?input('reason','Причина отмены')+(o?.payment_status==='paid'?'<p>Отмена заказа не возвращает деньги. Возврат оформляется отдельно в банке.</p>':''):'<p>Подтвердить изменение заказа?</p>';
  dialog(orderLabels[b.dataset.status],fields,v=>mutate('order.status',{location_id:locationId,order_id:b.dataset.order,status:b.dataset.status,...v}));
 });
 $('#content').querySelectorAll('[data-fulfill]').forEach(b=>b.onclick=()=>{
  const online=orders.find(o=>o.id===b.dataset.fulfill)?.source==='site-paid';
  dialog(online?'Выдача заказа':'Выдача и оплата',online?'<p>Заказ уже оплачен онлайн. Подтвердить выдачу?</p>':select('method','Как получена оплата',[['cash','Наличные'],['card','Терминал'],['transfer','Перевод']])+'<p>Подтверждайте после получения денег.</p>',v=>mutate('order.fulfill',{location_id:locationId,order_id:b.dataset.fulfill,...v}));
 });
}
function renderSettings(){$('#content').innerHTML=`<div class="split"><div class="panel"><h2>Подключение</h2><p>${telegramData()?'Telegram передал данные аккаунта. Проверяем доступ сотрудника автоматически — личный ключ не требуется.':'Адрес CRM уже указан. Для входа из обычного браузера введите личный ключ.'}</p><label for="api">Адрес API / HTTPS-прокси</label><input id="api" type="url" style="width:100%" value="${esc(apiUrl)}" placeholder="https://ваш-сервер/crm-api"><label for="token" ${telegramData()?'hidden':''}>Личный ключ доступа</label><input id="token" type="${telegramData()?'hidden':'password'}" style="width:100%" autocomplete="off"><p class="key-note">${telegramData()?'Доступ определяется по Telegram ID и роли в CRM.':'Ключ хранится только в памяти этой вкладки. Через рабочего бота доступен автоматический вход.'}</p><p id="connection-error" class="danger" role="alert">${esc(connectionError)}</p><button id="connect-button" class="primary" onclick="connect()">${telegramData()?'Повторить вход через Telegram':'Подключить'}</button><button onclick="disconnect()">Открыть демонстрацию</button></div><div class="panel"><h2>Состояние первой версии</h2><p>Готовая основа: продажи и полные возвраты, долг и погашение, смены, наличные, склад готовых изделий и отчёты.</p><p>Заказы с сайта: приём, резервирование, готовность, выдача и отмена. Следующие этапы: авторизация партнёров, техкарты, партии и сроки годности.</p><p>Модули подключаются к вашей таблице после установки Apps Script.</p>${pending?'<p class="danger">Есть операция без подтверждения. Повторите её с тем же ID, чтобы проверить результат без дубля.</p><button onclick="retryPending()">Повторить операцию</button>':''}</div></div>`;}
async function api(action,d,requestId,expectedEmployee){if(!apiUrl)throw Error('Не указан адрес API');const started=performance.now(),ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),40000);try{const res=await fetch(apiUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,data:d,request_id:requestId,expected_employee:expectedEmployee,accessToken,initData:telegramData()}),cache:'no-store',signal:ctrl.signal});if(!res.ok)throw Error('API вернул HTTP '+res.status);const json=await res.json();if(!json.ok){const err=new Error(json.error||'Ошибка операции');err.confirmed=action==='sale.create'?json.uncertain===false:!json.uncertain;err.stockIssue=json.stock_issue;throw err;}const inventory=json.data?.inventory;if(inventory&&typeof inventory==='object')inventoryClock.set(inventory,started);return json.data;}finally{clearTimeout(timer);}}
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
  listQueries.clear();data=next;live=true;demoMode=false;localStorage.setItem('crmApiUrl',apiUrl);locationId=data.locations.some(l=>l.id===locationId)?locationId:data.locations[0]?.id||'';clearSaleCart();category='';search='';page='sale';
  await restoreSale();
  notify('Таблица подключена · '+data.products.length+' позиций');
 }catch(e){
  connectionError=e.message==='Failed to fetch'?'Браузер не смог связаться со скриптом. Проверьте адрес /exec, доступ к развёртыванию и соединение.':e.name==='AbortError'?'Скрипт не ответил за 40 секунд. Попробуйте подключиться ещё раз.':e.message;
  page='settings';notify(connectionError);
 }finally{busy=false;render();}
}
function disconnect(){if(busy)return;if(pending)return notify('Сначала повторите неподтверждённую операцию');listQueries.clear();live=false;demoMode=true;connectionError='';accessToken='';clearSaleCart();locationId='CAFE';category='';search='';page='sale';resetDemo();render();}
let refreshing=false;
async function refresh(){
 if(busy||refreshing)return;
 if(!live){render();return;}
 const previous=data,endpoint=apiUrl;
 refreshing=true;
 const button=$('#sale-refresh');
 if(button){button.disabled=true;button.textContent='Обновляем…';}
 renderSaleFeedback();
 try{
   const next=await api('bootstrap',{});
   if(live&&!busy&&previous===data&&apiUrl===endpoint){
     const method=$('#payment')?.value,partner=$('#partner')?.value;
     data=next;
     if(page==='sale'&&!pending)saleFeedback={message:'Остатки обновлены. Проверьте позицию ещё раз.',actions:[]};
     render();
     if(page==='sale'&&method){$('#payment').value=method;$('#partner').value=partner||'';}
   }
 }catch(e){
   if(page==='sale'&&!pending)showSaleFeedback('Не удалось обновить остатки. Проверьте соединение и повторите.',[['Обновить остатки',refresh]]);
   else notify(e.message);
 }finally{
   refreshing=false;
   const current=$('#sale-refresh');
   if(current){current.disabled=false;current.textContent='Обновить остатки';}
   renderSaleFeedback();
 }
}
function applyResponse(action,response){
 if(action==='catalog.availability'){
  if(!response?.site_availability)throw Error('CRM не подтвердила наличие. Проверьте состояние повторно.');
  data={...data,site_availability:response.site_availability};
 }else data=response;
}
let recoveryKey='';
async function digest(value){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value));
 return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
}
async function storedSale(){
 const raw=localStorage.getItem(recoveryKey);if(raw===null)return null;
 const r=JSON.parse(raw);
 if(r.owner!==data.employee.id||typeof r.body!=='string'||r.hash!==await digest(JSON.stringify([r.owner,r.point,r.id,r.body])))throw Error('Запись восстановления повреждена. Сверьте журнал с менеджером.');
 const body=JSON.parse(r.body);
 if(body.location_id!==r.point||!data.locations.some(l=>l.id===r.point))throw Error('Исходная точка недоступна. Нужна сверка журнала.');
 return {id:r.id,action:'sale.create',data:body,owner:r.owner,hash:r.hash};
}
function lockSale(fn){
 if(!recoveryKey||!navigator.locks)throw Error('Защищённое хранилище кассы недоступно. Откройте CRM в поддерживаемом браузере.');
 return navigator.locks.request(recoveryKey,{ifAvailable:true},lock=>{
   if(!lock)throw Error('Другая вкладка проверяет продажу. Дождитесь результата.');
   return fn();
 });
}
async function verifyRecoveryScope(){
 const key='moline-sale-v1:'+await digest(JSON.stringify([apiUrl,data.employee.id]));
 if(key!==recoveryKey)throw Error('Сотрудник или подключение изменились. Откройте CRM снова.');
}
async function beginSale(body){
 await verifyRecoveryScope();
 if(data.capabilities?.sale_receipt!==1)throw Error('Обновите подключение CRM: сервер не поддерживает проверку продажи.');
 await lockSale(async()=>{
   const old=await storedSale();
   if(old){pending=old;locationId=old.data.location_id;render();throw Error('Сначала проверьте предыдущую продажу');}
   const r={owner:data.employee.id,point:body.location_id,id:crypto.randomUUID(),body:JSON.stringify(body)};
   r.hash=await digest(JSON.stringify([r.owner,r.point,r.id,r.body]));
   localStorage.setItem(recoveryKey,JSON.stringify(r));
   pending=await storedSale();
   try{const response=await api('sale.create',pending.data,pending.id,r.owner);
    if(response?.employee?.id!==r.owner||!Array.isArray(response.sales))throw Error('Неполный ответ кассы');
    applyResponse('sale.create',response);
   }
   catch(e){if(e.confirmed){localStorage.removeItem(recoveryKey);pending=null;}throw e;}
   localStorage.removeItem(recoveryKey);pending=null;
 });
}
async function restoreSale(){
 recoveryKey='moline-sale-v1:'+await digest(JSON.stringify([apiUrl,data.employee.id]));
 pending=await storedSale();if(!pending)return;
 locationId=pending.data.location_id;
 await recoverSale(false,true);
}
async function recoverSale(retry,connecting=false){
 if(!pending||(!connecting&&busy))return;
 const op=pending;busy=true;
 try{
  await lockSale(async()=>{
   await verifyRecoveryScope();
   const saved=await storedSale();
   if(saved && saved.hash!==op.hash){pending=saved;locationId=saved.data.location_id;throw Error('В другой вкладке начата следующая продажа. Проверьте её результат.');}
   const result=await api('sale.receipt',op.data,op.id,op.owner);
   if(result?.status==='committed' && result.request_id===op.id){
    const snapshot=await api('bootstrap',{});
    if(snapshot?.employee?.id!==op.owner||!Array.isArray(snapshot.sales))throw Error('Не удалось подтвердить сотрудника');
    applyResponse(op.action,snapshot);
   }else if(result?.status==='missing' && saved && !retry){
    saleFeedback={message:'В журнале пока нет этой продажи. Можно отправить исходную продажу с тем же ID.',actions:[['Отправить исходную продажу',()=>recoverSale(true)],['Проверить операцию',retryPending]]};return;
   }else if(result?.status==='missing' && saved && retry){
    const response=await api(op.action,op.data,op.id,op.owner);
    if(response?.employee?.id!==op.owner||!Array.isArray(response.sales))throw Error('Не удалось подтвердить сотрудника');
    applyResponse(op.action,response);
   }else throw Error('Требуется сверка документа с менеджером.');
   if(saved)localStorage.removeItem(recoveryKey);
   pending=null;clearSaleCart();
   saleFeedback={message:'Операция подтверждена. Документ доступен в разделе «Документы».',actions:[]};notify('Операция подтверждена');
  });
 }catch(e){saleFeedback={message:'Результат не подтверждён. '+e.message,actions:[['Проверить операцию',retryPending]]};}
 finally{busy=connecting;render();}
}

async function mutate(action,d){if(busy)throw Error('Дождитесь завершения операции');if(pending)throw Error('Повторите неподтвержденную операцию в настройках');busy=true;if(page!=='sale'&&!$('#dialog').open)document.body.classList.add('loading');try{if(live && action==="sale.create"){await beginSale(d);return;}if(live){pending={action,data:d,id:crypto.randomUUID()};try{applyResponse(action,await api(action,d,pending.id));pending=null;}catch(e){if(e.confirmed)pending=null;throw e;}}else demoMutate(action,d);}finally{busy=false;document.body.classList.remove('loading');}}
async function retryPending(){
 if(!pending||busy)return;
 if(pending.action==='sale.create'){await recoverSale(false);return;}
 const operation=pending;
 busy=true;
 showSaleFeedback('Проверяем операцию с прежним ID.',[],'Продажа · '+pointName(),false);
 let message='';
 try{
   applyResponse(operation.action,await api(operation.action,operation.data,operation.id));
   pending=null;saleFeedback=null;
   if(operation.action==='sale.create')clearSaleCart();
   $('#dialog').close();
   message='Операция подтверждена';
 }catch(error){
   if(error.confirmed)pending=null;
   if(page==='sale')explainSale(pending?saleError('pending'):error,null,'','sell');
   else {saleFeedback=null;message=pending?'Ответ ещё не получен. Оставьте вкладку открытой и проверьте операцию снова.':error.message;}
 }finally{
   busy=false;
   render();
   if(message)notify(message);
 }
}
function demoMutate(type,d){const s=CRMCore.reduce(demoEvents),sh=currentShift(),check=CRMCore.check,m=CRMCore.money,q=CRMCore.qty,p={},id='demo-'+(++demoCounter);const needShift=()=>check(sh,'Сначала откройте смену');
 if(type==='shift.open'){check(!sh,'Смена уже открыта');p.id=id;p.opening_cash=m(d.opening_cash);check(p.opening_cash>=0,'Неверная сумма');}
 else if(type==='shift.close'){needShift();p.shift_id=sh.id;p.actual_cash=m(d.actual_cash);check(p.actual_cash>=0,'Неверная сумма');p.expected_cash=CRMCore.expectedCash(s,sh.id);p.comment=d.reason;}
 else if(type==='sale.create'){needShift();p.id=id;p.shift_id=sh.id;p.partner_id=d.partner_id;p.stock_usage=cartPlan(Object.fromEntries(d.lines.map(l=>[l.product_id,l.qty])));p.lines=d.lines.map(l=>{const x=data.products.find(x=>x.id===l.product_id);return {product_id:x.id,name:x.name,qty:l.qty,price:x.price,cost:x.cost,stock_tracked:x.stock_tracked,line_total:Math.round(l.qty*x.price)};});p.total=p.lines.reduce((a,l)=>a+l.line_total,0);p.payment=d.method==='unpaid'?null:{method:d.method,amount:p.total};}
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



let refreshingOrders=false;
setInterval(async()=>{
 if(!live||page!=='orders'||busy||pending||document.hidden||$('#dialog').open||refreshingOrders)return;
 refreshingOrders=true;
 try{const previous=data,next=await api('bootstrap',{});if(live&&page==='orders'&&data===previous&&!busy&&!pending&&!$('#dialog').open){data=next;renderOrders();}}
 catch{}finally{refreshingOrders=false;}
},20000);



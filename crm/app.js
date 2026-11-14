'use strict';
const $=s=>document.querySelector(s),esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rub=n=>(Number(n||0)/100).toLocaleString('ru-RU',{maximumFractionDigits:2})+' ₽';
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
function stockState(){return {stock:data.stock,orders:Object.fromEntries((data.orders||[]).map(o=>[o.id,o]))};}
function physicalAvailable(p){return (data.stock[CRMCore.key(locationId,p.id)]||0)-CRMCore.reserved(stockState(),locationId,p.id);}
function cartPlan(items=cart){return CRMCore.planStock(stockState(),locationId,Object.entries(items).map(([id,qty])=>{const p=data.products.find(p=>p.id===id);if(!p)throw Error('Товар удалён из каталога');return {...p,product_id:id,qty};}),data.assembly_recipes||{});}
function cartStockUsage(items=cart){return Object.fromEntries(cartPlan(items).map(x=>[x.product_id,x.qty]));}
function available(p){if(!p.stock_tracked)return null;let used={};try{used=cartStockUsage();}catch{}return Math.max(0,physicalAvailable(p)-(used[p.id]||0));}
function fromClassic(id,items=cart){const p=data.products.find(p=>p.id===id);return data.assembly_recipes?.[id]?Math.max(0,(items[id]||0)-Math.max(0,physicalAvailable(p))):0;}
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
  $('#nav').innerHTML=Object.entries(labels).filter(([id])=>(id!=='availability'||!!data.site_availability)&&(id!=='products'||data.capabilities?.product_create===true)).map(([id,name])=>`<button data-page="${id}" class="${page===id?'active':''}">${name}</button>`).join('');
  $('#nav').querySelectorAll('button').forEach(b=>{b.disabled=busy||(!live&&!demoMode&&b.dataset.page!=='settings');b.onclick=()=>{if(busy)return;page=b.dataset.page;setMenu(false,false);render();};});
  $('#title').textContent=labels[page];$('#identity').textContent=data.employee.name+' · '+data.employee.role;
  $('#location').innerHTML=data.locations.map(l=>`<option value="${esc(l.id)}" ${l.id===locationId?'selected':''}>${esc(l.name)}</option>`).join('');
  $('#location').disabled=busy;$('#shiftButton').disabled=busy||(!live&&!demoMode);$('#shiftButton').textContent=currentShift()?'Закрыть смену':'Открыть смену';
  $('#mode').className='notice'+(live?' live':'');$('#mode').textContent=live?'Рабочий режим · Google Sheets подключены · '+data.products.length+' позиций.':demoMode?'ДЕМОНСТРАЦИЯ · Все товары, цены и остатки здесь тестовые. Действия не записываются в вашу таблицу и сбросятся при перезагрузке.':'Вход в CRM · Подключите свою таблицу. Рабочий каталог появится после проверки доступа.';
  ({sale:renderSale,sales:renderSales,stock:renderStock,products:renderProductAdmin,availability:renderAvailability,shifts:renderShifts,reports:renderReports,orders:renderOrders,settings:renderSettings}[page])();
}
$('#location').onchange=e=>{if(busy)return;locationId=e.target.value;cart={};render();};
function renderSale(){
 $('#content').innerHTML=`<div class="sale-layout"><div><div class="toolbar"><input id="search" placeholder="Поиск по названию" aria-label="Поиск" value="${esc(search)}"><button onclick="refresh()">Обновить</button></div><div id="categories" class="chips"></div><div id="products" class="products"></div></div><div class="cart"><h2>Новая продажа</h2><div class="muted">${currentShift()?'Смена открыта':'Сначала откройте смену'} · внутренний документ</div><div id="cart-lines"></div><div class="total"><span>Итого</span><span id="total"></span></div><select id="payment" aria-label="Способ расчёта"><option value="cash">Наличные</option><option value="card">Терминал</option><option value="transfer">Перевод</option><option value="unpaid">В долг партнёру</option></select><select id="partner" aria-label="Партнёр"><option value="">Без партнёра</option>${data.partners.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('')}</select><button class="primary" id="sell" onclick="sell()">Зарегистрировать продажу</button><p class="key-note">Оплата принимается отдельно. Этот документ не является фискальным чеком.</p></div></div>`;
 $('#search').oninput=e=>{search=e.target.value;renderProducts();};renderProducts();renderCart();
}
function renderProducts(){
 const categories=['',...new Set(data.products.map(p=>p.category))];$('#categories').innerHTML=categories.map(c=>`<button class="${category===c?'active':''}">${esc(c||'Все позиции')}</button>`).join('');$('#categories').querySelectorAll('button').forEach((b,i)=>b.onclick=()=>{category=categories[i];renderProducts();});
 const list=data.products.filter(p=>(!category||p.category===category)&&p.name.toLowerCase().includes(search.toLowerCase()));
 const cards=Object.fromEntries((data.site_cards||[]).map(c=>[c.product_id,c]));
 $('#products').innerHTML=list.length?list.map(p=>{const media=cards[p.id]?.media_id;const photo=/^[a-f0-9]{64}$/.test(media||'')?`https://molinebymonk.ru/api/auth/catalog/media/${media}.webp`:MOLINE_LEGACY_IMAGES[p.id];return `<button class="product" data-id="${esc(p.id)}">${photo?`<img class="sale-product-photo" src="${esc(photo)}" alt="" loading="lazy">`:'<span class="sale-product-photo sale-product-placeholder" aria-hidden="true"></span>'}<span class="cat">${esc(p.category)}</span><strong>${esc(p.name)}</strong><span class="bottom"><span>${rub(p.price)}</span><span class="muted">${p.stock_tracked?available(p)+' '+esc(p.unit):'без склада'}</span></span></button>`;}).join(''):'<div class="empty">Нет товаров. В рабочем режиме каталог заполняется на листе «Товары».</div>';
 $('#products').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,1));
}
function confirmClassic(product,amount,accept){
 const recipe=data.assembly_recipes[product.id],base=data.products.find(p=>p.id===recipe.base_product_id);
 $('#dialog-title').textContent='Использовать классический?';
 $('#fields').innerHTML=`<p>Готовых «${esc(product.name)}» не хватает.</p><p>Использовать ${amount*recipe.base_qty} шт «${esc(base?.name||'Круассан классический')}»?</p><p class="muted">При удалении из корзины основа освободится обратно.</p><button type="button" id="classic-no">Нет</button>`;
 $('#form-error').textContent='';$('#submit').disabled=false;$('#submit').textContent='Да';
 $('#classic-no').onclick=()=>$('#dialog').close();
 $('#form').onsubmit=e=>{e.preventDefault();if(busy||pending)return;$('#dialog').close();accept();};
 $('#dialog').showModal();
}
function add(id,n){
 if(busy||pending)return notify('Сначала завершите или повторите текущую операцию');
 if($('#dialog').open)return;
 const p=data.products.find(x=>x.id===id);if(!p)return;
 const next={...cart},q=(cart[id]||0)+n;if(q<=0)delete next[id];else next[id]=q;
 const commit=()=>{cart=next;renderProducts();renderCart();};
 // Removing an item always releases its temporary use of the classic bank.
 if(n<0){commit();return;}
 try{cartPlan(next);}catch(err){return notify('Недостаточно готовых круассанов или классической основы');}
 const addedBase=fromClassic(id,next)-fromClassic(id,cart);
 if(addedBase>0)return confirmClassic(p,addedBase,commit);
 commit();
}
function renderCart(){
 const lines=Object.entries(cart);let plan=[],problem='';try{plan=cartPlan();}catch(err){problem='Остатки изменились. Уменьшите количество или обновите корзину.';}
 $('#cart-lines').innerHTML=lines.length?lines.map(([id,q])=>{const p=data.products.find(x=>x.id===id);if(!p)return '<p>Товар удалён из каталога</p>';const fromBase=fromClassic(id);return `<div class="cart-row"><div class="line"><span>${esc(p.name)}</span><strong>${rub(p.price*q)}</strong></div>${fromBase?`<p class="muted">${q-fromBase?`${q-fromBase} готовых · `:''}${fromBase} из классического</p>`:''}<div class="stepper"><button data-id="${esc(id)}" data-n="-1">−</button><span>${q} ${esc(p.unit)}</span><button data-id="${esc(id)}" data-n="1">+</button></div></div>`;}).join(''):'<div class="empty">Выберите позиции слева.<br>Здесь появится состав продажи.</div>';
 if(problem)$('#cart-lines').innerHTML+=`<p class="danger">${esc(problem)}</p>`;
 $('#cart-lines').querySelectorAll('button').forEach(b=>b.onclick=()=>add(b.dataset.id,Number(b.dataset.n)));
 $('#total').textContent=rub(lines.reduce((a,[id,q])=>a+(data.products.find(x=>x.id===id)?.price||0)*q,0));$('#sell').disabled=busy||!lines.length||!currentShift()||!!problem;
}
async function sell(){if(busy)return;let usage;try{usage=cartPlan();}catch{return notify('Остатки изменились. Проверьте корзину');}const d={location_id:locationId,lines:Object.entries(cart).map(([product_id,qty])=>({product_id,qty})),expected_stock_usage:usage,method:$('#payment').value,partner_id:$('#partner').value};if(!d.lines.length)return;if(d.method==='unpaid'&&!d.partner_id)return notify('Выберите партнёра');try{await mutate('sale.create',d);cart={};render();notify('Продажа сохранена');}catch(e){notify(e.message);}}
function table(headers,rows){return `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(r=>`<tr>${r.map(c=>`<td>${c}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${headers.length}">Пока нет записей</td></tr>`}</tbody></table></div>`;}
function short(id){return esc(String(id).slice(0,8));}function date(s){return new Date(s).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});}
function renderSales(){const sales=data.sales.filter(s=>s.location_id===locationId);$('#content').innerHTML=`<div class="toolbar"><span class="muted">Последние 300 документов · время Москвы</span><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Документ','Время','Состав','Сумма','Оплачено','Статус','Действия'],sales.map(s=>[short(s.id),date(s.created_at),esc(s.lines.map(l=>l.name+' × '+l.qty).join(', ')),rub(s.total),rub(s.paid),s.status==='refunded'?'Возвращён':s.paid<s.total?'Есть долг':'Продан',s.status==='sold'?`<button data-refund="${esc(s.id)}">Возврат</button>${s.total>s.paid?`<button data-pay="${esc(s.id)}">Принять оплату</button>`:''}`:'—']))}</div>`;$('#content').querySelectorAll('[data-refund]').forEach(b=>b.onclick=()=>refundDialog(b.dataset.refund));$('#content').querySelectorAll('[data-pay]').forEach(b=>b.onclick=()=>paymentDialog(b.dataset.pay));}
function input(name,label,type='text',value='',extra=''){return `<label for="f-${name}">${label}</label><input id="f-${name}" name="${name}" type="${type}" value="${esc(value)}" ${extra} required>`;}
function select(name,label,options){return `<label for="f-${name}">${label}</label><select id="f-${name}" name="${name}">${options.map(([v,l])=>`<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select>`;}
function dialog(title,fields,save){$('#submit').textContent='Сохранить';if(busy||pending)return notify('Есть незавершённая операция. Откройте настройки для повторной отправки.');$('#dialog-title').textContent=title;$('#fields').innerHTML=fields;$('#form-error').textContent='';$('#submit').disabled=false;$('#form').onsubmit=async e=>{e.preventDefault();if(busy)return;$('#submit').disabled=true;try{await save(Object.fromEntries(new FormData(e.target)));$('#dialog').close();render();notify('Сохранено');}catch(err){const node=$('#form-error');node.textContent=err.name==='AbortError'?'CRM не ответила за 40 секунд. Операция могла сохраниться. Проверьте список товаров или повторите неподтвержденную операцию в настройках.':err.message;node.scrollIntoView({block:'nearest'});}finally{$('#submit').disabled=false;$('#submit').textContent='Сохранить';}};$('#dialog').showModal();}
function shiftDialog(){const shift=currentShift();if(shift)dialog('Закрытие смены',`<p class="muted">Ожидаемые наличные: ${rub(shift.expected_cash)}</p>`+input('actual_cash','Наличные по факту, ₽','number','', 'min="0" step="0.01"')+input('reason','Комментарий / причина расхождения','text','Без расхождений'),v=>mutate('shift.close',{location_id:locationId,...v}));else dialog('Открытие смены',input('opening_cash','Разменные наличные, ₽','number','0','min="0" step="0.01"'),v=>mutate('shift.open',{location_id:locationId,...v}));}
function refundDialog(id){const order=(data.orders||[]).find(o=>o.sale_id===id&&o.source==='site-paid');if(order)return notify('Онлайн-возврат оформляется через банк');dialog('Полный возврат продажи',input('reason','Причина')+select('restock','Возвращать товар в остаток?',[['false','Нет — товар не возвращён в продажу'],['true','Да — товар можно снова продавать']]),v=>mutate('sale.refund',{location_id:locationId,sale_id:id,reason:v.reason,restock:v.restock==='true'}));}
function paymentDialog(id){const s=data.sales.find(x=>x.id===id);dialog('Погашение долга',input('amount','Сумма, ₽','number',(s.total-s.paid)/100,'min="0.01" step="0.01"')+select('method','Способ',[['cash','Наличные'],['card','Терминал'],['transfer','Перевод']]),v=>mutate('payment.add',{location_id:locationId,sale_id:id,...v}));}
function renderStock(){const list=data.products.filter(p=>p.stock_tracked);$('#content').innerHTML=`<div class="toolbar"><button onclick="stockDialog('stock.receive')">+ Приход</button><button onclick="stockDialog('stock.writeoff')">Списание</button><button onclick="stockDialog('stock.count')">Инвентаризация</button><button onclick="stockDialog('stock.transfer')">Перемещение</button><button onclick="refresh()">Обновить</button></div><div class="panel">${table(['Позиция','Категория','Готовых свободно','Минимум','Состояние'],list.map(p=>[esc(p.name),esc(p.category),physicalAvailable(p)+' '+esc(p.unit),p.min_stock||0,physicalAvailable(p)<Number(p.min_stock)?'<span class="badge low">Мало</span>':'<span class="badge">Достаточно</span>']))}</div>`;}
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
  return `<article class="product-admin-row">${image}<div class="product-admin-main"><strong>${esc(p.name)}</strong><div class="product-admin-meta"><span>${rub(shown)}</span><span class="product-admin-status">${state}</span></div>${publish}</div>${edit}</article>`;
 }).join('')}</div></div>`;
 $('#new-product').onclick=()=>productDialog();
 $('#content').querySelectorAll('[data-site-edit]').forEach(b=>b.onclick=()=>productDialog(b.dataset.siteEdit));
 $('#content').querySelectorAll('[data-site-publish]').forEach(b=>b.onclick=()=>publishSiteProduct(b.dataset.sitePublish));
 $('#content').querySelectorAll('[data-site-unpublish]').forEach(b=>b.onclick=()=>unpublishSiteProduct(b.dataset.siteUnpublish));
}
async function imageData(file){
 if(!(file instanceof File)||!file.size)return '';
 if(!['image/png','image/jpeg','image/webp'].includes(file.type))throw Error('Нужен PNG, JPEG или WebP');
 if(file.size>50_000_000)throw Error('Исходное фото больше 50 МБ. Выберите файл меньшего размера.');
 const bitmap=await createImageBitmap(file),scale=Math.min(1,1200/Math.max(bitmap.width,bitmap.height));
 const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
 canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
 let blob;
 for(const quality of [.88,.75,.62]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',quality));if(blob?.size<=750000)break;}
 if(!blob||blob.type!=='image/webp'||blob.size>750000)throw Error('Фото слишком большое. Выберите изображение меньшего размера');
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
 if(!confirm('Проверили фото, описание, состав и правило склада? Товар появится на сайте после публикации.'))return;
 try{if(data.capabilities?.site_contract!=='products-20261113-v2')throw Error('Обновите опубликованное развертывание Apps Script и переподключите CRM.');await mutate('catalog.site.publish',{product_id:id});render();notify('Товар опубликован на сайте');}catch(e){notify(e.message);}
}
async function unpublishSiteProduct(id){
 if(!confirm('Снять товар с сайта? Оформленные заказы сохранятся.'))return;
 try{if(data.capabilities?.site_contract!=='products-20261113-v2')throw Error('Обновите опубликованное развертывание Apps Script и переподключите CRM.');await mutate('catalog.site.unpublish',{product_id:id});render();notify('Товар снят с сайта');}catch(e){notify(e.message);}
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
  `<div class="site-preview" id="site-preview">${imageUrl?`<img class="site-photo" src="${imageUrl}" alt="Фото товара">`:'<span>Фото пока не выбрано</span>'}</div><label for="site-photo">${imageUrl?'Заменить фото':'Фото товара'}</label><input id="site-photo" name="image" type="file" accept="image/png,image/jpeg,image/webp">`+
  `<label for="site-description">Описание</label><textarea id="site-description" name="description" maxlength="2000">${esc(card?.description||'')}</textarea>`+
  `<label for="site-ingredients">Состав и аллергены</label><textarea id="site-ingredients" name="ingredients" maxlength="2000">${esc(card?.ingredients||'')}</textarea>`+
  (legacy?'':select('stock_mode','Правило наличия на сайте',[['manual','Включать вручную'],['finished','Готовый остаток'],['recipe','По рецепту сборки'],['made_to_order','Готовим под заказ (лимит дня)']]))+
  `<label for="site-next-price">Новая цена, ₽ (необязательно)</label><input id="site-next-price" name="next_price" type="number" min="0.01" step="0.01" value="${esc(card?.next_price||'')}"><label for="site-next-date">Дата новой цены (по Москве)</label><input id="site-next-date" name="next_price_on" type="date" value="${esc(card?.next_price_on||'')}">`+
  `<label class="product-publish-choice"><input name="publish" type="checkbox" ${published||!p?'checked':''}> Показывать на сайте после сохранения</label><p class="muted">Можно сохранить черновик без публикации. Единица и учет остатков после создания фиксируются, история заказов сохраняется.</p>`;
 let savedId=id;
 dialog(p?'Редактировать товар':'Новый товар',fields+'<p id="form-progress" role="status" aria-live="polite"></p>',async v=>{
  const nextCategory=(v.category_new||v.category).trim();
  if(!/^[а-яёa-z0-9][а-яёa-z0-9 -]{1,38}[а-яёa-z0-9]$/i.test(nextCategory))throw Error('Категория: 3–40 символов, буквы, цифры, пробел и дефис.');
  if(p&&v.unit!==p.unit)throw Error('Единицу существующего товара изменить нельзя.');
  if(p&&(v.stock_tracked==='true')!==p.stock_tracked)throw Error('Учёт остатков существующего товара изменить нельзя.');
  if(data.capabilities?.site_contract!=='products-20261113-v2')throw Error('Опубликованная версия Apps Script устарела. В редакторе нажмите «Развернуть → Управление развертываниями → Изменить → Новая версия → Развернуть», затем переподключите CRM. Товар не изменён.');
  const wantsSite=v.publish==='on';
  await productSaveStage('Проверяем данные и обрабатываем фото…');
  const photo=await imageData(v.image);let media_id=card?.media_id||'';
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
  const siteDetails={product_id:savedId,site_name:v.site_name,description:v.description,ingredients:v.ingredients,media_id,stock_mode:legacy?'legacy':v.stock_mode,next_price:v.next_price,next_price_on:v.next_price_on};
  const siteChanged=!card||card.site_name!==siteDetails.site_name||card.description!==siteDetails.description||card.ingredients!==siteDetails.ingredients||card.media_id!==siteDetails.media_id||card.stock_mode!==siteDetails.stock_mode||String(card.next_price||'')!==String(siteDetails.next_price||'')||String(card.next_price_on||'')!==String(siteDetails.next_price_on||'');
  if(siteChanged){await productSaveStage('Сохраняем карточку сайта…');await mutate('catalog.site.save',siteDetails);}
  const currently=legacy?(!card||card.published===true):card?.published===true;
  if(wantsSite&&!currently){await productSaveStage('Публикуем товар на сайте…');await mutate('catalog.site.publish',{product_id:savedId});}
  if(!wantsSite&&currently){await productSaveStage('Снимаем товар с сайта…');await mutate('catalog.site.unpublish',{product_id:savedId});}
 });
 $('#f-category').value=p?.category||categories[0];$('#f-unit').value=p?.unit||'шт';
 $('#f-stock_tracked').value=stock;
 if(p){for(const name of ['unit','stock_tracked']){const select=$('#f-'+name);select.disabled=true;const hidden=document.createElement('input');hidden.type='hidden';hidden.name=name;hidden.value=select.value;select.after(hidden);}}
 if(!legacy)$('#f-stock_mode').value=card?.stock_mode||((p?.stock_tracked)?'finished':'manual');
 $('#site-photo').onchange=e=>{const file=e.target.files?.[0];if(!file)return;const preview=$('#site-preview');preview.replaceChildren();const img=document.createElement('img');img.className='site-photo';img.alt='Предпросмотр';const url=URL.createObjectURL(file);img.src=url;img.onload=()=>URL.revokeObjectURL(url);preview.append(img);};
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
async function loadReport(){const from=$('#from').value,to=$('#to').value;if(!from||!to||from>to)return notify('Проверьте даты');try{const r=live?await api('report',{location_id:locationId,from,to}):CRMCore.report(CRMCore.reduce(demoEvents),locationId,from,to);if(page!=='reports')return;$('#report').innerHTML=`<div class="metrics">${[['Выручка за период',rub(r.revenue)],['Поступления − возвраты',rub(r.receipts)],['Продаж / возвратов',r.sale_count+' / '+r.refund_count],['Текущий долг партнёров',rub(r.debt)]].map(([l,v])=>`<div class="metric"><span class="muted">${l}</span><strong>${v}</strong></div>`).join('')}</div><div class="panel"><h2>Что входит в отчёт</h2><p>Продажи до возвратов: ${rub(r.gross)}. Возвраты: ${rub(r.refunds)}. Наличными принято за вычетом возвратов: ${rub(r.cash)}. Списаний: ${r.writeoffs}.</p><p>Прибыль пока не рассчитывается: для неё нужны подтверждённая себестоимость, расходы и правила списания ингредиентов.</p></div>`;}catch(e){notify(e.message);}}
const orderLabels={new:'Новый',accepted:'Принят · резерв',ready:'Готов',fulfilled:'Выдан',cancelled:'Отменён'};
function renderOrders(){
 const orders=(data.orders||[]).filter(o=>o.location_id===locationId);
 $('#content').innerHTML=`<div class="toolbar"><button onclick="refresh()">Обновить заказы</button></div>`+orders.map(o=>{
  const online=o.source==='site-paid',paid=o.payment_status==='paid',refunded=o.payment_status==='refunded';
  return `<article class="panel"><h2>Заказ ${o.source==='site-paid'?esc(o.external_id.slice(-6).toUpperCase()):short(o.id)} · ${esc(orderLabels[o.status]||o.status)}</h2>${online?`<p class="badge">${refunded?'Оплата возвращена':paid?'Оплачен онлайн':'Проверяем оплату'}</p>`:''}${o.pilot?'<p class="muted">Тест оплаты · без приготовления</p>':''}<p>${date(o.created_at)} · ${esc(o.due_at)} · ${o.mode==='delivery'?'Доставка':'Самовывоз'}</p><p>${esc(o.customer.name)} · ${esc(o.customer.phone)}<br>${esc(o.customer.address||'')}</p><p>${o.lines.map(l=>esc(l.name)+' × '+l.qty).join('<br>')}</p><p>${esc(o.comment||'')}</p><strong>${rub(o.total)}</strong><div class="toolbar">${o.status==='new'&&(!online||paid)?`<button data-order="${esc(o.id)}" data-status="accepted">${o.pilot?'Принять тест':'Принять и зарезервировать'}</button>`:''}${o.status==='accepted'&&(!online||paid)?`<button data-order="${esc(o.id)}" data-status="ready">Готов</button>`:''}${o.status==='ready'&&(!online||paid)?`<button data-fulfill="${esc(o.id)}">${online?'Подтвердить выдачу':'Выдать и учесть оплату'}</button>`:''}${['new','accepted','ready'].includes(o.status)?`<button data-order="${esc(o.id)}" data-status="cancelled">Отменить</button>`:''}</div>${online&&o.status==='cancelled'&&paid?'<p class="muted">Заказ отменен. Возврат денег оформляется отдельно в банке.</p>':''}</article>`;
 }).join('');
 if(!orders.length)$('#content').innerHTML+='<div class="panel">Пока нет заказов</div>';
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
function applyResponse(action,response){
 if(action==='catalog.availability'){
  if(!response?.site_availability)throw Error('CRM не подтвердила наличие. Проверьте состояние повторно.');
  data={...data,site_availability:response.site_availability};
 }else data=response;
}
async function mutate(action,d){if(busy)throw Error('Дождитесь завершения операции');if(pending)throw Error('Повторите неподтвержденную операцию в настройках');busy=true;if(!$('#dialog').open)document.body.classList.add('loading');try{if(live){pending={action,data:d,id:crypto.randomUUID()};try{applyResponse(action,await api(action,d,pending.id));pending=null;}catch(e){if(e.confirmed)pending=null;throw e;}}else demoMutate(action,d);}finally{busy=false;document.body.classList.remove('loading');}}
async function retryPending(){if(!pending||busy)return;busy=true;try{applyResponse(pending.action,await api(pending.action,pending.data,pending.id));pending=null;cart={};$('#dialog').close();render();notify('Операция подтверждена');}catch(e){if(e.confirmed)pending=null;notify(e.message);}finally{busy=false;}}
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



let refreshingOrders=false;
setInterval(async()=>{
 if(!live||page!=='orders'||busy||pending||document.hidden||$('#dialog').open||refreshingOrders)return;
 refreshingOrders=true;
 try{const next=await api('bootstrap',{});if(live&&page==='orders'&&!busy&&!pending&&!$('#dialog').open){data=next;renderOrders();}}
 catch{}finally{refreshingOrders=false;}
},20000);


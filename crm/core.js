/* MOLINE CRM. Pure event reducer shared by Apps Script and Node tests.
   Money is stored as integer kopecks. Quantity is rounded to 0.001 units. */
var CRMCore = (function () {
  function check(ok, message) { if (!ok) throw new Error(message); }
  function money(value) { check(value !== '' && value != null && Number.isFinite(Number(value)), 'Некорректная сумма'); return Math.round(Number(value) * 100); }
  function qty(value) { check(value !== '' && value != null && Number.isFinite(Number(value)), 'Некорректное количество'); return Math.round(Number(value) * 1000) / 1000; }
  function initial() { return { orders: {}, sales: {}, shifts: {}, stock: {}, payments: [], movements: [], events: [] }; }
  function key(location, product) { return location + ':' + product; }
  function movement(s, e, product, amount, reason, location) {
    location = location || e.location_id;
    var k = key(location, product); s.stock[k] = qty((s.stock[k] || 0) + amount);
    s.movements.push({event_id:e.event_id,location_id:location,product_id:product,qty:amount,reason:reason,created_at:e.created_at});
  }
  function pay(s, e, sale, shift, method, amount) {
    s.payments.push({event_id:e.event_id,sale_id:sale,shift_id:shift,method:method,amount:amount,created_at:e.created_at});
    if (s.sales[sale]) s.sales[sale].paid += amount;
  }
  function reduce(events) {
    var s = initial(); events.forEach(function(e) {
      var d=e.payload, sale, sh;
      if(e.type==='shift.open') s.shifts[d.id]={id:d.id,location_id:e.location_id,employee_id:e.actor_id,opened_at:e.created_at,closed_at:'',opening_cash:d.opening_cash,status:'open'};
      if(e.type==='shift.close') { sh=s.shifts[d.shift_id]; check(sh,'Смена не найдена'); Object.assign(sh,{closed_at:e.created_at,actual_cash:d.actual_cash,expected_cash:d.expected_cash,difference:d.actual_cash-d.expected_cash,status:'closed'}); }
      if(e.type==='order.create') s.orders[d.id]=Object.assign({},d,{created_at:e.created_at,location_id:e.location_id,status:'new'});
      if(e.type==='order.status') {Object.assign(s.orders[d.order_id],{status:d.status,reason:d.reason||'',updated_at:e.created_at});if(d.stock_usage)s.orders[d.order_id].stock_usage=d.stock_usage;}
      if(e.type==='sale.create') {
        if(d.order_id)Object.assign(s.orders[d.order_id],{status:'fulfilled',sale_id:d.id,updated_at:e.created_at});
        sale={id:d.id,created_at:e.created_at,shift_id:d.shift_id,location_id:e.location_id,employee_id:e.actor_id,partner_id:d.partner_id||'',lines:d.lines,total:d.total,paid:0,status:'sold',fiscal_status:'not_integrated'};
        s.sales[d.id]=sale;
        (d.stock_usage||d.lines.filter(l=>l.stock_tracked).map(l=>({product_id:l.product_id,qty:l.qty}))).forEach(l=>movement(s,e,l.product_id,-l.qty,'sale'));
        if(d.payment)pay(s,e,d.id,d.shift_id,d.payment.method,d.payment.amount);
      }
      if(e.type==='payment.add') pay(s,e,d.sale_id,d.shift_id,d.method,d.amount);
      if(e.type==='sale.refund') {
        sale=s.sales[d.sale_id]; check(sale,'Продажа не найдена'); sale.status='refunded';
        if(d.restock)sale.lines.forEach(function(l){if(l.stock_tracked)movement(s,e,l.product_id,l.qty,'refund');});
        d.payments.forEach(function(p){pay(s,e,d.sale_id,d.shift_id,p.method,-p.amount);});
      }
      if(e.type==='stock.assemble'){movement(s,e,d.base_product_id,-d.base_qty,'assembly: '+d.product_id);movement(s,e,d.product_id,d.qty,'assembly');}
      if(e.type.indexOf('stock.')===0&&e.type!=='stock.assemble') {
        movement(s,e,d.product_id,d.delta,e.type+(d.reason?': '+d.reason:''));
        if(e.type==='stock.transfer')movement(s,e,d.product_id,-d.delta,e.type,d.to_location);
      }
      s.events.push(e);
    }); return s;
  }
  function reserved(s,location,product,except) {
    return qty(Object.values(s.orders||{}).filter(o=>o.id!==except&&o.location_id===location&&['accepted','ready'].includes(o.status)).reduce((a,o)=>a+(o.stock_usage||o.lines.filter(l=>l.stock_tracked).map(l=>({product_id:l.product_id,qty:l.qty}))).filter(l=>l.product_id===product).reduce((n,l)=>n+l.qty,0),0));
  }
  function planStock(s,location,lines,recipes,except) {
    var usage={},left={};
    function remaining(id){if(left[id]===undefined)left[id]=qty((s.stock[key(location,id)]||0)-reserved(s,location,id,except));return left[id];}
    function take(id,n){n=qty(n);check(n>=0&&remaining(id)>=n,'Недостаточно остатка: '+id);left[id]=qty(left[id]-n);usage[id]=qty((usage[id]||0)+n);}
    // Allocate finished products before any recipe consumes their shared base.
    var shortages=[];
    lines.filter(l=>l.stock_tracked).forEach(l=>{
      var r=recipes[l.product_id],mode=l.stock_mode||'auto';
      check(['auto','ready','base'].includes(mode),'Неверный способ сборки');
      check(mode!=='base'||r,'Для товара нет рецепта сборки');
      var ready=mode==='base'?0:Math.min(l.qty,Math.max(0,remaining(l.product_id)));
      if(ready)take(l.product_id,ready);
      var missing=qty(l.qty-ready);
      if(missing){check(r&&mode!=='ready','Недостаточно остатка готового товара: '+l.product_id);shortages.push({recipe:r,qty:missing});}
    });
    shortages.forEach(x=>take(x.recipe.base_product_id,qty(x.qty*x.recipe.base_qty)));
    return Object.keys(usage).map(id=>({product_id:id,qty:usage[id]}));
  }
  function expectedCash(s, shiftId) {
    var shift=s.shifts[shiftId]; check(shift,'Смена не найдена');
    return shift.opening_cash+s.payments.filter(function(p){return p.shift_id===shiftId&&p.method==='cash';}).reduce(function(a,p){return a+p.amount;},0)+s.events.filter(function(e){return (e.type==='cash.in'||e.type==='cash.out')&&e.payload.shift_id===shiftId;}).reduce(function(a,e){return a+e.payload.amount*(e.type==='cash.in'?1:-1);},0);
  }
  function report(s, location, from, to) {
    var inRange=function(date){var day=new Date(new Date(date).getTime()+10800000).toISOString().slice(0,10);return day>=from&&day<=to;};
    var events=s.events.filter(function(e){return (!location||e.location_id===location)&&inRange(e.created_at);});
    var sales=events.filter(function(e){return e.type==='sale.create';});
    var returns=events.filter(function(e){return e.type==='sale.refund';});
    var receipts=s.payments.filter(function(p){var sh=s.shifts[p.shift_id];return sh&&(!location||sh.location_id===location)&&inRange(p.created_at);});
    var gross=sales.reduce(function(a,e){return a+e.payload.total;},0), refunded=returns.reduce(function(a,e){return a+s.sales[e.payload.sale_id].total;},0);
    return {from:from,to:to,gross:gross,refunds:refunded,revenue:gross-refunded,sale_count:sales.length,refund_count:returns.length,receipts:receipts.reduce(function(a,p){return a+p.amount;},0),cash:receipts.filter(function(p){return p.method==='cash';}).reduce(function(a,p){return a+p.amount;},0),debt:Object.values(s.sales).filter(function(x){return x.status==='sold'&&(!location||x.location_id===location);}).reduce(function(a,x){return a+x.total-x.paid;},0),writeoffs:events.filter(function(e){return e.type==='stock.writeoff';}).length};
  }
  return {check:check,money:money,qty:qty,key:key,reduce:reduce,reserved:reserved,planStock:planStock,expectedCash:expectedCash,report:report};
})();
if(typeof module!=='undefined')module.exports=CRMCore;
